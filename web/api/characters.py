"""Character skill sheets and implants.

The web UI computes every fit with the fit's own character, so its numbers need
no skill bookkeeping outside the engine. The Fit page (a self-contained HTML
clone outside this server) reproduces that math locally and therefore needs the
pilot's skill levels: ``/api/meta`` already lists the characters, this endpoint
adds their skill sheets.

The implant simulator (top bar) additionally reads and edits a character's own
implant list. Those implants are the ones a fit applies when its implant
location is "character" (the desktop character editor edits the same list); a
signed-in pilot's list can be prefilled from EVE and kept as simulation data.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from logbook import Logger
from pydantic import BaseModel

from service.character import Character
from web.deps import user_or_guest
from web.services import charimplants
from web.services.serialize import serialize_item

pyfalog = Logger(__name__)

router = APIRouter(tags=["characters"])


@router.get("/characters/{character_id}/skills")
def get_character_skills(character_id: int):
    """A saved character's skill sheet: typeID, English name and level.

    The presets report every skill at 5 (All 5) or 0 (All 0); a pilot's own
    character reports the sheet last synced from EVE, with untrained skills at 0
    and alpha-clone caps applied.

    Names are the English ``typeName`` column on purpose: the Fit page looks
    skills up by the same names ``data.js`` carries (its weapon ``sk`` field and
    the capacitor skill multipliers), which are all English.
    """
    char = Character.getCharacter(character_id)
    if char is None:
        raise HTTPException(status_code=404, detail="Character not found")
    skills = []
    for skill in char.skills:
        item = skill.item
        if item is None:
            continue
        skills.append({"typeID": item.ID, "name": item.typeName or item.name, "level": skill.level})
    return {"id": char.ID, "name": char.name, "skills": skills}


# -- implant simulator --------------------------------------------------------

def _get_character_or_404(character_id):
    char = charimplants.get_character(character_id)
    if char is None:
        raise HTTPException(status_code=404, detail="Character not found")
    return char


@router.get("/implants/search")
def search_implants(
    q: str = Query("", description="Name text; empty lists the whole catalogue"),
    limit: int = Query(50, ge=1, le=200),
    exclude: str = Query("", description="Comma-separated item ids already on the character"),
):
    """Search the implant catalogue for the add-implant picker.

    Open to guests like every game-data read. ``exclude`` keeps the picker from
    suggesting implants already on the character being edited.
    """
    from web.services.search import search_items

    exclude_ids = {int(part) for part in exclude.split(",") if part.strip().isdigit()}
    items = [item for item in search_items(q, scope="implants", limit=limit * 2)
             if item.ID not in exclude_ids][:limit]
    return {"query": q, "results": [serialize_item(item) for item in items]}


@router.get("/characters/{character_id}/implants")
def get_character_implants(character_id: int):
    """The character's own implants: item, slot and whether ESI or locally added.

    These are the implants a fit applies when its implant location is
    ``character`` (``implantLocation == 1``). The two built-in presets report an
    empty list: they are read-only and never carry implants.
    """
    char = _get_character_or_404(character_id)
    payload = charimplants.list_implants(char)
    payload["readOnly"] = bool(char.ro)
    payload["hasSso"] = Character.getSsoCharacter(char.ID) is not None
    return payload


class CharacterImplantBody(BaseModel):
    itemId: int


def _recalc_open_fit(fit_id):
    """Recalculate the fit the browser is editing after a character implant edit.

    Character implants are global to the character, but only a fit set to the
    character implant location (``implantLocation == 1``) actually applies them,
    so recalculation only matters for such a fit. Returns the refreshed fit
    payload when one was given and uses this character's implants, else None.
    """
    if fit_id is None:
        return None
    from eos.const import ImplantLocation
    from service.fit import Fit
    from web.services.serialize import serialize_fit

    fit = Fit.getInstance().getFit(fit_id)
    if fit is None:
        raise HTTPException(status_code=404, detail="fit not found")
    if fit.implantLocation != ImplantLocation.CHARACTER:
        return None
    Fit.getInstance().recalc(fit)
    return serialize_fit(fit, includeStats=True)


@router.post("/characters/{character_id}/implants", status_code=201)
def add_character_implant(
    character_id: int,
    payload: CharacterImplantBody,
    fitId: int | None = Query(None),
    user=Depends(user_or_guest),  # noqa: ARG001 - writes follow the guest policy
):
    """Add one implant to the character's own list (a simulation edit).

    Same-slot implants make room for the newcomer, as in the desktop character
    editor. Refuses the read-only presets and items that are not implants.
    """
    char = _get_character_or_404(character_id)
    try:
        added = charimplants.add_implant(char, payload.itemId)
    except PermissionError as ex:
        raise HTTPException(status_code=403, detail=str(ex)) from ex
    except ValueError as ex:
        raise HTTPException(status_code=400, detail=str(ex)) from ex

    out = charimplants.list_implants(char)
    out["readOnly"] = bool(char.ro)
    out["hasSso"] = Character.getSsoCharacter(char.ID) is not None
    out["added"] = added
    fit_payload = _recalc_open_fit(fitId)
    if fit_payload is not None:
        out["fit"] = fit_payload
    return out


@router.delete("/characters/{character_id}/implants/{item_id}")
def remove_character_implant(
    character_id: int,
    item_id: int,
    fitId: int | None = Query(None),
    user=Depends(user_or_guest),  # noqa: ARG001 - writes follow the guest policy
):
    """Remove one implant from the character's own list.

    An implant that came from ESI is also unmarked so a later refresh does not
    silently re-add an implant the pilot removed on purpose.
    """
    char = _get_character_or_404(character_id)
    try:
        removed = charimplants.remove_implant(char, item_id)
    except PermissionError as ex:
        raise HTTPException(status_code=403, detail=str(ex)) from ex

    out = charimplants.list_implants(char)
    out["readOnly"] = bool(char.ro)
    out["hasSso"] = Character.getSsoCharacter(char.ID) is not None
    out["removed"] = removed
    fit_payload = _recalc_open_fit(fitId)
    if fit_payload is not None:
        out["fit"] = fit_payload
    return out


@router.post("/characters/{character_id}/implants/sync-esi")
def sync_character_implants(
    character_id: int,
    fitId: int | None = Query(None),
    user=Depends(user_or_guest),  # a guest never has stored EVE tokens
):
    """Pull the implants the pilot's clone carries in game and reconcile the list.

    Requires a login whose token includes the clone implants scope; a token
    issued before that scope was requested answers ``missingScope`` so the
    browser can offer a fresh sign-in. Locally added simulation implants are
    left in place.
    """
    char = _get_character_or_404(character_id)
    sso_row = Character.getSsoCharacter(char.ID)
    if sso_row is None:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "This character has no stored EVE login to read implants with.",
                "code": "noCharacter",
                "params": {},
            },
        )

    try:
        out = charimplants.sync_from_esi(char, sso_row)
    except charimplants.EsiImplantError as ex:
        pyfalog.warning("ESI implant sync failed ({}): {}", ex.code, ex)
        raise HTTPException(
            status_code=ex.status,
            detail={"message": str(ex), "code": ex.code, "params": ex.params},
        ) from ex

    out["readOnly"] = bool(char.ro)
    out["hasSso"] = True
    fit_payload = _recalc_open_fit(fitId)
    if fit_payload is not None:
        out["fit"] = fit_payload
    return out


