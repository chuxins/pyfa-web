"""Skills that a fit cares about: what the pilot must train.

The requirements walk the same objects the desktop client checks when it
red-flags a fit (:meth:`service.character.Character.checkRequirements`) -- the
ship, every fitted module (rigs included), drones, fighters, applied implants,
boosters and the loaded charges -- and collect every skill those items
require, following each skill's own prerequisites recursively. When the same
skill is needed by several items we keep the highest required level and
remember the items that demand it, so the UI can show one row per skill.

Beyond the hard requirements the pilot can pin arbitrary skills to the fit as
"custom skills": they never affect the fit's numbers and never count as
missing, they only display the fit character's current level, so the pilot can
keep an eye on skills they plan to train for this ship. The pinned set lives
in the user's own saveddata database (see :mod:`web.services.customskills`).

The skill names come straight from ``Item.name``, so they follow the game data
language the server booted with (``zh_CN`` on this deployment).
"""

import itertools

import eos.db
from eos.saveddata.fighter import Fighter as es_Fighter

from . import customskills
from .serialize import item_image


def _fitted_items(fit):
    """Every game item the fit is built from, as (holder, item) pairs.

    Mirrors ``Character.checkRequirements``' traversal, except rigs are kept:
    rigging skills are a genuine part of flying the fit and change its numbers.
    Empty module slots carry no item and are skipped. Fighters' auto-loaded
    micro bombs have skill requirements in the data that the game does not use,
    so (as on the desktop) their charges are ignored.
    """
    for holder in itertools.chain(
        fit.modules,
        fit.drones,
        fit.fighters,
        (fit.ship,),
        fit.appliedImplants,
        fit.boosters,
    ):
        item = getattr(holder, "item", None)
        if item is not None:
            yield item
        # Rig slots still live in fit.modules; only real modules carry a charge.
        if not isinstance(holder, es_Fighter):
            charge = getattr(holder, "charge", None)
            if charge is not None:
                yield charge


def _collect(item, required, sources):
    """Add one item's direct skills (plus their prerequisite chain) to the maps.

    ``required[skillId]`` is the highest level seen so far; ``sources[skillId]``
    is the set of *fitted* item names that pull the skill in directly. Skills
    only met through a prerequisite are recorded as required but keep an empty
    source set.
    """
    direct = set()
    stack = [(skill, level) for skill, level in (item.requiredSkills or {}).items()]
    while stack:
        skill, level = stack.pop()
        if skill is None:
            continue
        previous = required.get(skill.ID)
        if previous is None or level > previous:
            required[skill.ID] = level
        sources.setdefault(skill.ID, set())
        if id(skill) in direct:
            continue
        direct.add(id(skill))
        for prereq, prereqLevel in (skill.requiredSkills or {}).items():
            # The prerequisite must be at least the level the skill itself asks
            # for; a fitted item that requires the same skill directly may raise
            # it, which the max() in the parent handles on the next pass.
            stack.append((prereq, max(prereqLevel, 0)))

    for skill in (item.requiredSkills or {}):
        if skill is not None:
            sources.setdefault(skill.ID, set()).add(item.name)


def _custom_row(skillId, character, dirty_ids):
    """One pinned custom skill row, or None when the game data lacks the type."""
    skillItem = eos.db.getItem(skillId)
    if skillItem is None:
        return None
    currentLevel = 0
    if character is not None:
        currentLevel = character.getSkill(skillItem).level
    return {
        "id": skillId,
        "name": skillItem.name,
        "image": item_image(skillItem),
        "requiredLevel": 0,
        "currentLevel": currentLevel,
        "met": True,
        "prerequisiteOnly": False,
        "custom": True,
        "dirty": skillId in dirty_ids,
        "sources": [],
    }


def fit_skills(fit):
    """Aggregate the skills the skills sidebar shows for ``fit``.

    Returns ``{"skills": [...], "custom": [...], "missing": N}``. ``skills``
    are what the pilot must train to board and activate every fitted item (the
    direct requirements plus their recursive prerequisite chain); each row
    carries the highest level the fit needs, the current character's level,
    whether the character meets it, whether the skill is only an indirect
    prerequisite, and the names of the fitted items that require it.

    ``custom`` lists the skills the pilot pinned to this fit by hand. They
    carry no required level and never count as missing; the row only reports
    the fit character's current level so the pilot can track planned training.
    A skill that is also part of the requirement chain is skipped here -- it
    already appears, with its requirement, in the main list.
    """
    required = {}
    sources = {}
    for item in _fitted_items(fit):
        _collect(item, required, sources)

    character = fit.character
    # Skill ids with unsaved "skill simulation" edits (the desktop's dirtySkills):
    # their active level differs from the sheet saved for the character, so the
    # sidebar can mark them and offer a reset back to the trained levels.
    dirty_ids = set()
    editable = False
    if character is not None:
        editable = not character.ro
        if editable:
            dirty_ids = {skill.itemID for skill in character.dirtySkills if skill.isDirty}
    rows = []
    for skillId, neededLevel in required.items():
        skillItem = eos.db.getItem(skillId)
        if skillItem is None:
            continue
        currentLevel = 0
        if character is not None:
            currentLevel = character.getSkill(skillItem).level
        names = sorted(n for n in sources.get(skillId, set()) if n)
        rows.append({
            "id": skillId,
            "name": skillItem.name,
            "image": item_image(skillItem),
            "requiredLevel": neededLevel,
            "currentLevel": currentLevel,
            "met": currentLevel >= neededLevel,
            "prerequisiteOnly": not names,
            "dirty": skillId in dirty_ids,
            "sources": names,
        })

    # Unmet skills first (so a pilot sees the training gaps immediately), then
    # the highest requirements, with direct requirements ahead of prerequisites
    # and names as the final tie-breaker. Custom skills are the pilot's own
    # watch list, so they get their own alphabetically sorted section instead.
    rows.sort(key=lambda row: (
        row["met"],
        -row["requiredLevel"],
        row["prerequisiteOnly"],
        row["name"],
    ))
    missing = sum(1 for row in rows if not row["met"])

    custom_rows = []
    for skillId in customskills.list_custom(fit.ID):
        # A skill needed by the fitted items is already in the main list.
        if skillId in required:
            continue
        row = _custom_row(skillId, character, dirty_ids)
        if row is not None:
            custom_rows.append(row)
    custom_rows.sort(key=lambda row: row["name"])

    return {
        "skills": rows,
        "custom": custom_rows,
        "missing": missing,
        "total": len(rows),
        "customTotal": len(custom_rows),
        # False for the built-in All 0 / All 5 presets: their levels are fixed
        # by the engine, so the sidebar must not offer editing on them.
        "characterEditable": editable,
        "dirtyTotal": len(dirty_ids),
    }
