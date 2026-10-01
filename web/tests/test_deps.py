"""Who is asking, when the deployment sits behind a prefix-stripping proxy.

A sub-path deployment sets ``root_path`` (``web.yml``: the browser talks to
``/eveskillplanner/`` and nginx strips that prefix before proxying). uvicorn then hands
the app a ``scope["path"]`` that still carries the prefix -- Starlette's router strips it
again before matching routes, which is exactly why ``web.deps.route_path`` exists. Both
``UserContextMiddleware`` (which resolves the session cookie) and ``OriginCheckMiddleware``
(in ``web.main``) test the path for ``/api`` before they do anything; reading the raw
scope path there means neither ever runs under such a deployment, and a signed-in browser
is served as an anonymous one (``/api/meta`` reports ``user: null`` and the UI keeps
offering the login button).
"""

import pytest

PREFIX = "/eveskillplanner"


@pytest.mark.parametrize(
    "path, root_path, expected",
    [
        (PREFIX + "/api/auth/me", PREFIX, "/api/auth/me"),
        (PREFIX + "/api/commands", PREFIX, "/api/commands"),
        (PREFIX + "/", PREFIX, "/"),
        # The mount root itself: no path left, like the router's own helper
        (PREFIX, PREFIX, ""),
        # No root path (a root deployment, and everything the test session configures)
        ("/api/auth/me", "", "/api/auth/me"),
        # Only the prefix itself is stripped: a path that merely starts with the same
        # characters is a different mount and must be left alone
        ("/eveskillplannerx/api/commands", PREFIX, "/eveskillplannerx/api/commands"),
        # A scope without the keys at all must not raise
        ("", "", ""),
    ],
)
def test_route_path_is_the_path_the_router_sees(path, root_path, expected):
    from web.deps import route_path

    assert route_path({"path": path, "root_path": root_path}) == expected


def _cookie_header(app_state, user_id):
    value = app_state.tokens.issue(user_id)
    header = "{}={}".format(app_state.config.cookie_name, value)
    return [(b"cookie", header.encode("latin-1"))]


def test_session_cookie_resolves_with_the_prefix_on_the_path(app_state, make_user):
    """The uvicorn-under-a-sub-path shape: prefixed path, matching ``root_path``."""
    from web.deps import UserContextMiddleware

    user = make_user("Prefixed Pilot").pyfaUser
    middleware = UserContextMiddleware(None, app_state)

    scope = {
        "type": "http",
        "path": PREFIX + "/api/auth/me",
        "root_path": PREFIX,
        "headers": _cookie_header(app_state, user.id),
    }
    resolved = middleware._resolve_user(scope)

    assert resolved is not None, "a valid session cookie must survive the mount prefix"
    assert resolved.id == user.id


def test_session_cookie_still_resolves_without_a_root_path(app_state, make_user):
    from web.deps import UserContextMiddleware

    user = make_user("Root Pilot").pyfaUser
    middleware = UserContextMiddleware(None, app_state)

    scope = {
        "type": "http",
        "path": "/api/auth/me",
        "root_path": "",
        "headers": _cookie_header(app_state, user.id),
    }

    assert middleware._resolve_user(scope).id == user.id


def test_no_cookie_means_no_user_even_under_a_prefix(app_state):
    from web.deps import UserContextMiddleware

    middleware = UserContextMiddleware(None, app_state)

    assert middleware._resolve_user(
        {"type": "http", "path": PREFIX + "/api/auth/me", "root_path": PREFIX, "headers": []}
    ) is None
    # Pages are not the API: no account lookup there, prefixed or not
    assert middleware._resolve_user(
        {"type": "http", "path": PREFIX + "/", "root_path": PREFIX,
         "headers": _cookie_header(app_state, 1)}
    ) is None
