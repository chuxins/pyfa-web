"""Fittings and the EVE client, both ways.

Import brings the fittings a pilot has saved in game into pyfa; export saves one of
their pyfa fits into the in-game client of their login. Neither endpoint is a plain
database read: both talk to EVE over the network. Nothing is imported when ESI cannot
be reached, and a fitting that cannot be built is reported in the answer instead of
failing the batch.

An ESI failure is answered with the code vocabulary of ``web/frontend/src/errors.ts``
plus the status the situation deserves: EVE being unreachable is a gateway error, a
login that EVE no longer accepts (or none at all) is the client's to fix by signing in
again, and anything unforeseen is the server's.
"""

from fastapi import APIRouter, Depends, HTTPException
from logbook import Logger
from pydantic import BaseModel

from web.deps import get_app_state, require_user
from web.events import publish
from web.services import esiFittings

pyfalog = Logger(__name__)

router = APIRouter(prefix="/esi", tags=["esi"])


@router.post("/fittings/import")
def import_fittings(user=Depends(require_user), state=Depends(get_app_state)):
    """Fetch the fittings this pilot saved in game and save them under their ships."""
    try:
        result = esiFittings.import_character_fittings(user, state.config.sso.server)
    except esiFittings.EsiError as ex:
        pyfalog.warning("ESI fittings import failed ({}): {}", ex.code, ex)
        raise HTTPException(
            status_code=ex.status,
            detail={"message": str(ex), "code": ex.code, "params": ex.params},
        ) from ex
    except Exception as ex:
        pyfalog.exception("ESI fittings import failed for user {}", user.id)
        raise HTTPException(
            status_code=500,
            detail={
                "message": "the fittings could not be imported: {}".format(ex),
                "code": "esiFailed",
                "params": {},
            },
        ) from ex

    # The set of fits changed, which is both a new fit list and a new tree: the pilot's
    # ships gained fits (see `fits.imported` in the browser store).
    publish(
        user.id, "fits.imported",
        count=len(result["imported"]),
        shipIds=sorted({fit["shipId"] for fit in result["imported"]}),
    )
    return result


class EsiExportRequest(BaseModel):
    fitId: int


@router.post("/fittings/export")
def export_fitting(
    payload: EsiExportRequest,
    user=Depends(require_user),
    state=Depends(get_app_state),
):
    """Save one of this pilot's pyfa fits into the EVE client of their login.

    Login-only because the fit is saved *as* the pilot: the tokens come from the SSO
    login stored in their database, so there is nothing to export with otherwise.
    """
    try:
        result = esiFittings.export_fitting_to_game(user, state.config.sso.server, payload.fitId)
    except esiFittings.EsiError as ex:
        pyfalog.warning("ESI fitting export failed ({}): {}", ex.code, ex)
        raise HTTPException(
            status_code=ex.status,
            detail={"message": str(ex), "code": ex.code, "params": ex.params},
        ) from ex
    except Exception as ex:
        pyfalog.exception("ESI fitting export failed for user {}", user.id)
        raise HTTPException(
            status_code=500,
            detail={
                "message": "the fitting could not be exported: {}".format(ex),
                "code": "esiExportFailed",
                "params": {},
            },
        ) from ex
    return result
