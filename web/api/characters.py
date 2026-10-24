"""Character skill sheets, for the standalone Fit page.

The web UI computes every fit with the fit's own character, so its numbers need
no skill bookkeeping outside the engine. The Fit page (a self-contained HTML
clone outside this server) reproduces that math locally and therefore needs the
pilot's skill levels: ``/api/meta`` already lists the characters, this endpoint
adds their skill sheets.
"""

from fastapi import APIRouter, HTTPException

from service.character import Character

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
