"""Request plumbing: who is asking, and which database they get.

Cookie -> account -> ``UserData`` -> bound engine context. The binding has to
happen in the event loop (so the contextvar is visible to the endpoint, which
FastAPI runs in a worker thread) but must not block the loop while waiting for
the user's lock, so the lock is acquired through ``anyio.to_thread``.
"""

from contextlib import asynccontextmanager
from http.cookies import SimpleCookie

import anyio
from fastapi import Depends, HTTPException, Request, status
from logbook import Logger

from eos.db import sessionctx
from web.auth import LoginStateStore, SessionTokens, SsoClient
from web.config import WebConfig
from web.userdata import UserData, UserDataRegistry
from web.userdb import User, UserStore

pyfalog = Logger(__name__)

APP_STATE_KEY = "pyfaAppState"
USER_KEY = "pyfaUser"
USER_DATA_KEY = "pyfaUserData"
#: Set when a session cookie named an account that was locked out (disabled), so
#: writes can refuse it instead of demoting the pilot to a guest.
USER_LOCKED_OUT_KEY = "pyfaUserLockedOut"


def route_path(scope):
    """``scope["path"]`` the way the router sees it, i.e. with ``root_path`` removed.

    A sub-path deployment sets ``root_path`` (see ``web.yml``: the browser talks to
    ``/eveskillplanner/``, nginx strips the prefix). uvicorn then hands the app a
    ``scope["path"]`` that *still carries that prefix* -- which is why Starlette's own
    router strips it again before matching routes. Anything that inspects the path
    outside the router has to do the same: with the prefix left on, ``/api/auth/me``
    arrives as ``/eveskillplanner/api/auth/me``, the ``/api`` tests below never match,
    and a signed-in browser is treated as an anonymous one (no session cookie is ever
    resolved, ``/api/meta`` reports ``user: null`` and the UI keeps asking for a login).

    Same rules as ``starlette.routing.get_route_path`` (a private helper, so this keeps
    a local copy): the prefix is only removed on a path-segment boundary, the mount root
    itself becomes ``""``, and a path that merely starts with the same characters is a
    different mount and is left alone.
    """
    path = scope.get("path", "")
    root_path = scope.get("root_path", "")
    if not root_path or not path.startswith(root_path):
        return path
    if path == root_path:
        return ""
    if path[len(root_path)] == "/":
        return path[len(root_path):]
    return path


class AppState:
    """Process-wide server objects, created once at startup."""

    def __init__(self, config: WebConfig):
        self.config = config
        self.users = UserStore(config.app_db_path)
        self.registry = UserDataRegistry(config)
        self.tokens = SessionTokens(config.secret_key, config.session_max_age)
        self.login_states = LoginStateStore()
        self.sso = SsoClient(config.sso)

    def close(self):
        self.registry.close_all()


def get_app_state(request: Request) -> AppState:
    return request.app.state.pyfaAppState


class UserContextMiddleware:
    """Resolves the session cookie into an account and stashes it on the scope.

    Deliberately does no database work beyond the tiny account lookup, so
    requests for images and static assets stay cheap.
    """

    def __init__(self, app, state: AppState):
        self.app = app
        self.state = state

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        scope.setdefault("state", {})
        user, locked_out = self._resolve_user(scope)
        scope["state"][USER_KEY] = user
        if locked_out:
            scope["state"][USER_LOCKED_OUT_KEY] = True
        await self.app(scope, receive, send)

    def _resolve_user(self, scope):
        """The account behind this request, and whether a cookie named one that was locked out.

        Returns ``(user, locked_out)``: a guest is ``(None, False)``, and a session
        cookie that named a disabled account is ``(None, True)``, so a write can refuse
        it instead of quietly demoting the pilot to a guest with write access.
        """
        path = route_path(scope)
        if not path.startswith("/api"):
            return None, False
        header = None
        for key, value in scope.get("headers") or ():
            if key == b"cookie":
                header = value.decode("latin-1")
                break
        if not header:
            return None, False
        cookies = SimpleCookie()
        try:
            cookies.load(header)
        except Exception:
            return None, False
        morsel = cookies.get(self.state.config.cookie_name)
        if morsel is None:
            return None, False
        user_id = self.state.tokens.read(morsel.value)
        if user_id is None:
            return None, False
        try:
            user = self.state.users.get(user_id)
        except Exception:
            pyfalog.exception("Failed to load account {}", user_id)
            return None, False
        if user is None:
            return None, False
        if user.is_disabled:
            return None, True
        return user, False


@asynccontextmanager
async def bind_user_context(user: User | None, state: AppState):
    """Serialise this user's requests and point the engine at their database.

    The lock is an ``asyncio.Lock`` because a ``threading`` lock cannot be
    released by a different thread than the one that acquired it, and request
    handling moves between the event loop and the thread pool.
    """
    if user is not None:
        data = await anyio.to_thread.run_sync(state.registry.get, user.id)
    else:
        data = await anyio.to_thread.run_sync(state.registry.get_guest)

    async with data.async_lock:
        # The engine's own calls happen in whichever thread runs the endpoint, so
        # the context (and with it eos.db's per-user threading lock) is bound for
        # the duration; nothing else touches this user's session meanwhile.
        #
        # Only ``async_lock`` is taken to get here: ``data.lock`` is a threading
        # lock that eos.db acquires and releases around each saveddata operation,
        # and a threading lock cannot be handed from a worker thread back to the
        # event loop. Mutual exclusion between requests therefore comes from the
        # asyncio lock above.
        with sessionctx.bind_context(data.context):
            data.touch()
            yield data


async def user_context(request: Request, state: AppState = Depends(get_app_state)):
    """Router-level dependency: every API request gets a bound engine context."""
    user = current_user(request)
    async with bind_user_context(user, state) as data:
        setattr(request.state, USER_DATA_KEY, data)
        yield data


def current_user(request: Request) -> User | None:
    """The account for this request, resolved from the session cookie.

    ``request.state`` proxies ``scope["state"]``, which is where the middleware
    puts the account; it supports attribute access only.
    """
    return getattr(request.state, USER_KEY, None)


def require_user(request: Request) -> User:
    user = current_user(request)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sign in with EVE to continue")
    return user


def user_or_guest(request: Request) -> User | None:
    """The account behind a write, or ``None`` for an anonymous guest.

    Writes are open to guests, but a session cookie that named a locked-out account is
    a refusal, not a demotion: a pilot whose account was disabled must not be quietly
    turned into a guest with write access to the shared database.
    """
    if getattr(request.state, USER_LOCKED_OUT_KEY, False):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sign in with EVE to continue")
    return current_user(request)


#: The SSE channel every anonymous visitor shares. Guests all work in one shared
#: database (see `UserDataRegistry.get_guest`), so they share one event stream too.
GUEST_EVENT_CHANNEL = "guest"


def event_channel(user: User | None) -> str:
    """The SSE channel a request's browsers listen on; guests all share one."""
    return user.id if user is not None else GUEST_EVENT_CHANNEL


def get_user_data(request: Request) -> UserData:
    data = getattr(request.state, USER_DATA_KEY, None)
    if data is None:
        raise HTTPException(status_code=500, detail="Engine context was not bound for this request")
    return data


def set_session_cookie(response, state: AppState, user_id):
    config = state.config
    response.set_cookie(
        config.cookie_name,
        state.tokens.issue(user_id),
        max_age=config.session_max_age,
        httponly=True,
        samesite="lax",
        secure=config.session_cookie_secure,
        path="/",
    )


def clear_session_cookie(response, state: AppState):
    response.delete_cookie(state.config.cookie_name, path="/")
