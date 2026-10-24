"""Skills that affect a fit: what the pilot must train, plus optional bonuses.

The requirement side walks the same objects the desktop client checks when it
red-flags a fit (:meth:`service.character.Character.checkRequirements`) -- the
ship, every fitted module (rigs included), drones, fighters, applied implants,
boosters and the loaded charges -- and collects every skill those items
require, following each skill's own prerequisites recursively. When the same
skill is needed by several items we keep the highest required level and
remember the items that demand it, so the UI can show one row per skill.

Beyond the hard requirements, many skills are never demanded by a fitted item
but still change the fit's numbers when trained -- Weapon Upgrades on the
ship's CPU, Gunnery on turret damage, Thermodynamics on overheat and so on.
Those "auxiliary" skills are harvested the same way the desktop client's
"Change Affecting Skills" context menu finds them: after a fit calculation,
every passive skill (level 0 included) registers an affliction against each
item attribute it modifies, so the post-calculation affliction maps reveal the
full set of skills that can touch this fit.

The skill names come straight from ``Item.name``, so they follow the game data
language the server booted with (``zh_CN`` on this deployment).
"""

import itertools

import eos.db
from eos.saveddata.character import Skill as es_Skill
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

    Returns ``{"skills": [...], "auxiliary": [...], "missing": N}``. ``skills``
    are what the pilot must train to board and activate every fitted item (the
    direct requirements plus their recursive prerequisite chain); each row
    carries the highest level the fit needs, the current character's level,
    whether the character meets it, whether the skill is only an indirect
    prerequisite, and the names of the fitted items that require it.

    ``auxiliary`` lists skills the fit never *requires* but whose trained
    bonuses still change its numbers. Auxiliary rows have no required level, so
    they only carry the character's current level and the items they affect.
    """
    required = {}
    sources = {}
    for item in _fitted_items(fit):
        _collect(item, required, sources)

    # Reading afflictions only makes sense after a calculation. Fits fetched
    # for editing have usually just been calculated for their stats, but a
    # direct hit on this endpoint may see a fresh object; the call is a no-op
    # when the fit is already up to date.
    fit.calculateModifiedAttributes()
    auxiliary_ids = _auxiliary_skill_ids(fit, required.keys())

    character = fit.character
    rows = []
    aux_rows = []
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
            "sources": names,
        })

    for skillId, affected in sorted(auxiliary_ids.items()):
        skillItem = eos.db.getItem(skillId)
        if skillItem is None:
            continue
        currentLevel = 0
        if character is not None:
            currentLevel = character.getSkill(skillItem).level
        names = sorted(n for n in affected if n)
        aux_rows.append({
            "id": skillId,
            "name": skillItem.name,
            "image": item_image(skillItem),
            "requiredLevel": 0,
            "currentLevel": currentLevel,
            "met": True,
            "prerequisiteOnly": False,
            "auxiliary": True,
            "sources": names,
        })

    # Unmet skills first (so a pilot sees the training gaps immediately), then
    # the highest requirements, with direct requirements ahead of prerequisites
    # and names as the final tie-breaker. Auxiliary skills are optional bonuses,
    # so they get their own alphabetically sorted section instead.
    rows.sort(key=lambda row: (
        row["met"],
        -row["requiredLevel"],
        row["prerequisiteOnly"],
        row["name"],
    ))
    aux_rows.sort(key=lambda row: row["name"])
    missing = sum(1 for row in rows if not row["met"])
    return {
        "skills": rows,
        "auxiliary": aux_rows,
        "missing": missing,
        "total": len(rows),
        "auxiliaryTotal": len(aux_rows),
    }


def _auxiliary_skill_ids(fit, required_ids):
    """Map ``skillId -> {affected fitted item names}`` for bonus-only skills.

    Walks every fitted holder's post-calculation affliction maps (both the
    holder itself and its loaded charge) and records skills that appear as
    afflictors. Local effects only: afflictions keyed by another fit (projected
    or command fits) are ignored. Skills already in the requirement chain are
    excluded -- they are shown as requirements even when they also carry a
    bonus (Gunnery is a prerequisite of every turret skill).
    """
    required = set(required_ids)
    result = {}

    def scan(attributes, target_name):
        for attrName in attributes.iterAfflictions():
            for originFit, afflictors in attributes.getAfflictions(attrName).items():
                if originFit is not fit:
                    continue
                for afflictor, _operator, _sg, _pre, _post, _used in afflictors:
                    if not isinstance(afflictor, es_Skill):
                        continue
                    skill_id = afflictor.itemID
                    if skill_id in required:
                        continue
                    result.setdefault(skill_id, set()).add(target_name)

    for holder in itertools.chain(
        (fit.ship,),
        fit.modules,
        fit.drones,
        fit.fighters,
        fit.appliedImplants,
        fit.boosters,
    ):
        item = getattr(holder, "item", None)
        if item is None:
            continue
        scan(holder.itemModifiedAttributes, item.name)
        # As in _fitted_items, fighters' auto-loaded micro bombs carry skill
        # requirements the game does not honour; skip their charge map.
        if not isinstance(holder, es_Fighter):
            charge = getattr(holder, "charge", None)
            if charge is not None:
                scan(holder.chargeModifiedAttributes, charge.name)

    return result
