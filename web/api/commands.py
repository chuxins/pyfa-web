"""Fit editing endpoints.

One endpoint runs any registered edit command; separate ones undo and redo. Every
response carries the fit and its undo state, so the browser can redraw without a
second round trip.

An edit the engine refuses is a 409 whose ``detail`` is ``{message, code, params}``:
English text for the log, plus the reason and its values so the browser can say the
same thing in the reader's language (see ``web/services/commands.py``).
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from logbook import Logger
from pydantic import BaseModel, Field

from web.deps import UserData, event_channel, get_app_state, get_user_data, user_or_guest
from web.events import publish
from web.services import commands as commandService
from web.services.serialize import serialize_fit
from web.userdb import User

pyfalog = Logger(__name__)

router = APIRouter(tags=["commands"])


class CommandRequest(BaseModel):
    command: str = Field(..., description="Name from GET /api/commands")
    args: dict = Field(default_factory=dict, description="Command arguments")


def _mark_draft(userData: UserData, fitId: int) -> None:
    """把这次编辑标成「未保存」。

    命令内部会调用 ``eos.db.commit()``（pyfa 的 Gui*Command 就是这么写的），只要在这个
    上下文上把 defer_commit 打开，那些 commit 就只剩 flush：引擎看得到新状态、撤销栈
    也正常，但库文件要等用户点保存才更新（见 eos/db/saveddata/queries.py 的 commit）。
    """
    context = getattr(userData, "context", None)
    if context is None:
        return
    context.defer_commit = True
    context.draft_fit_id = fitId


def _clear_draft(userData: UserData) -> None:
    context = getattr(userData, "context", None)
    if context is None:
        return
    context.defer_commit = False
    context.draft_fit_id = None


def _run(userData: UserData, channel: str, fitId: int, action):
    """Execute ``action`` and return the refreshed fit plus its undo state."""
    _mark_draft(userData, fitId)
    try:
        history = action()
    except commandService.CommandError as ex:
        raise HTTPException(status_code=ex.status_code, detail=str(ex))
    except commandService.CommandFailed as ex:
        raise HTTPException(status_code=409, detail=ex.detail())
    except HTTPException:
        raise
    except Exception as ex:
        pyfalog.exception("Edit command failed for fit {}", fitId)
        raise HTTPException(status_code=500, detail="{}: {}".format(type(ex).__name__, ex))

    from service.fit import Fit

    fit = Fit.getInstance().getFit(fitId)
    if fit is None:
        raise HTTPException(status_code=404, detail="fit not found")
    payload = serialize_fit(fit, includeStats=True)
    payload["history"] = history
    payload["dirty"] = True
    return payload


@router.get("/commands")
def list_commands():
    """Every edit command this server accepts, with its arguments. Open to guests."""
    return {"commands": commandService.available_commands()}


@router.post("/fits/{fit_id}/commands")
def run_command(
    fit_id: int,
    payload: CommandRequest,
    user: User | None = Depends(user_or_guest),
    userData: UserData = Depends(get_user_data),
):
    """Run one edit command, e.g. add a module or toggle a state. Open to guests."""
    channel = event_channel(user)
    return _run(userData, channel, fit_id, lambda: commandService.execute(
        userData, channel, fit_id, payload.command, payload.args))


@router.post("/fits/{fit_id}/undo")
def undo(
    fit_id: int,
    user: User | None = Depends(user_or_guest),
    userData: UserData = Depends(get_user_data),
):
    """Undo the last edit of this fit."""
    channel = event_channel(user)
    return _run(userData, channel, fit_id, lambda: commandService.undo(userData, channel, fit_id))


@router.post("/fits/{fit_id}/redo")
def redo(
    fit_id: int,
    user: User | None = Depends(user_or_guest),
    userData: UserData = Depends(get_user_data),
):
    """Redo the last undone edit."""
    channel = event_channel(user)
    return _run(userData, channel, fit_id, lambda: commandService.redo(userData, channel, fit_id))


@router.post("/fits/{fit_id}/save")
def save_fit(
    fit_id: int,
    user: User | None = Depends(user_or_guest),
    userData: UserData = Depends(get_user_data),
):
    """把当前编辑提交到装配方案里（唯一会真正落盘的编辑路径）。

    编辑期间所有 commit 都被降级成 flush，所以这里强制提交一次，然后清掉「未保存」
    标记。找不到装配时仍然是 404，和别的编辑端点一致。
    """
    import eos.db
    from service.fit import Fit

    fit = Fit.getInstance().getFit(fit_id)
    if fit is None:
        raise HTTPException(status_code=404, detail="fit not found")
    eos.db.commit_now()
    _clear_draft(userData)
    payload = serialize_fit(fit, includeStats=True)
    payload["history"] = commandService.history_for(userData, fit_id)
    payload["dirty"] = False
    return payload


@router.post("/fits/{fit_id}/discard")
def discard_fit(
    fit_id: int,
    request: Request,
    user: User | None = Depends(user_or_guest),
    userData: UserData = Depends(get_user_data),
):
    """放弃本次编辑：回滚事务，重建这个用户的会话（缓存与撤销栈一起丢掉）。

    返回的是「已作废」的信号，浏览器随后重新 GET 这个装配即可拿到库里的旧内容。
    """
    import eos.db

    try:
        eos.db.rollback()
    finally:
        _clear_draft(userData)
        # 回滚只退数据库；SQLAlchemy 的身份映射和 pyfa 服务里还留着回滚前的对象，
        # 所以把这个用户的会话整个重建（下次请求就是干净的库里状态）。
        state = get_app_state(request)
        state.registry.reset_user(getattr(userData, "user_id", None))
    return {"fitId": fit_id, "discarded": True}


@router.get("/fits/{fit_id}/history")
def history(
    fit_id: int,
    userData: UserData = Depends(get_user_data),
):
    """Undo/redo state of a fit."""
    return commandService.history_for(userData, fit_id)


@router.delete("/fits/{fit_id}/history", status_code=204, dependencies=[Depends(user_or_guest)])
def clear_history(
    fit_id: int,
    userData: UserData = Depends(get_user_data),
):
    """Forget the undo history (used when the fit is saved/closed)."""
    commandService.clear_history(userData, fit_id)
    return None


@router.get("/fits/{fit_id}/charge-targets")
def charge_targets(
    fit_id: int,
    chargeItemId: int,
):
    """Which fitted modules can load this charge.

    The desktop shows this as the "load ammo into..." menu; the browser needs it
    to decide what clicking a charge in the market should do.
    """
    from service.fit import Fit
    from service.market import Market

    fit = Fit.getInstance().getFit(fit_id)
    if fit is None:
        raise HTTPException(status_code=404, detail="fit not found")

    charge = Market.getInstance().getItem(chargeItemId)
    if charge is None:
        raise HTTPException(status_code=404, detail="charge not found")

    targets = []
    for position, module in enumerate(fit.modules):
        if module.isEmpty:
            continue
        try:
            if module.isValidCharge(charge):
                targets.append({
                    "position": position,
                    "itemId": module.itemID,
                    "name": module.item.name if module.item else None,
                    "item": None if module.item is None else {
                        "id": module.item.ID,
                        "name": module.item.name,
                        "image": None,
                    },
                })
        except Exception:
            pyfalog.exception("Failed to check charge validity for position {}", position)
    return {"fitId": fit_id, "chargeItemId": chargeItemId, "targets": targets}


@router.post("/fits/{fit_id}/reset", status_code=204)
def reset_fit(
    fit_id: int,
    user: User | None = Depends(user_or_guest),
    userData: UserData = Depends(get_user_data),
):
    """Strip everything off a fit, leaving the hull. One undo step."""
    from web.services.composite import ClearFitCommand

    channel = event_channel(user)
    command = ClearFitCommand(fit_id)
    processor = commandService.processor_for(userData, fit_id)
    from web.events import publishing_as

    with publishing_as(channel):
        success = processor.Submit(command)
    if not success:
        # Nothing to remove is not an error, but the fit must exist
        from service.fit import Fit

        if Fit.getInstance().getFit(fit_id) is None:
            raise HTTPException(status_code=404, detail="fit not found")
    publish(channel, "fit.changed", fitIds=[fit_id], action="reset")
    return None
