"""Skills that affect a fit: everything the pilot has to train to fly it.

This walks the same objects the desktop client checks when it red-flags a fit
(:meth:`service.character.Character.checkRequirements`) -- the ship, every
fitted module (rigs included), drones, fighters, applied implants, boosters
and the loaded charges -- and collects every skill those items require,
following each skill's own prerequisites recursively. When the same skill is
needed by several items we keep the highest required level and remember the
items that demand it, so the UI can show one row per skill.

The skill names come straight from ``Item.name``, so they follow the game data
language the server booted with (``zh_CN`` on this deployment).
"""

import itertools

from eos.saveddata.fighter import Fighter as es_Fighter

from .serialize import item_image


def _fitted_items(fit):
    """Every game item the fit is built from, as (holder, item) pairs.

    Mirrors ``Character.checkRequirements``' traversal, except rigs are kept:
    rigging skills are a genuine part of flying the fit and change its numbers.
    Empty module slots carry no item and are skipped. Fighters' auto-loaded
    micro bombs have skill requirements in the data that the game does not use,
    so (as on the desktop) their charges are ignored.
    """
    holders = itertools.chain(
        fit.modules,
        fit.drones,
        fit.fighters,
        (fit.ship,),
        fit.appliedImplants,
        fit.boosters,
    )
    for holder in holders:
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


def fit_skills(fit):
    """Aggregate the skills that affect ``fit`` for the skills sidebar.

    Returns ``{"skills": [...], "missing": N}``; each row carries the skill's
    id, localized name and icon, the highest level the fit needs, the current
    character's level, whether the character meets it, whether it is only an
    indirect prerequisite, and the names of the fitted items that require it.
    """
    required = {}
    sources = {}
    for item in _fitted_items(fit):
        _collect(item, required, sources)

    character = fit.character
    rows = []
    for skillId, neededLevel in required.items():
        import eos.db

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
            "sources": names,
        })

    # Unmet skills first (so a pilot sees the training gaps immediately), then
    # the highest requirements, with direct requirements ahead of prerequisites
    # and names as the final tie-breaker.
    rows.sort(key=lambda row: (
        row["met"],
        -row["requiredLevel"],
        row["prerequisiteOnly"],
        row["name"],
    ))
    missing = sum(1 for row in rows if not row["met"])
    return {"skills": rows, "missing": missing, "total": len(rows)}
