"""Item search, mirroring the market browser's search rules.

The desktop search runs on a worker thread and hands results back through
``wx.CallAfter``. Here it is a plain function that the request thread calls; the
tokenising, jargon expansion, regex support and "published only" filter are the
same as ``service.market.SearchWorkerThread`` so results match the desktop.
"""

import re

import config
import eos.db
from eos.gamedata import Category as types_Category, Group as types_Group, Item as types_Item
from logbook import Logger
from sqlalchemy import bindparam, text
from sqlalchemy.sql import or_

from service.jargon import JargonLoader
from service.market import Market
from utils.cjk import isStringCjk

pyfalog = Logger(__name__)

SCOPES = ("market", "everything", "implants", "all", "high", "med", "low", "rig", "subsystem", "service")

#: Rack names a ship fit can hold, mapped to the dogma effect that puts an item there
#: (``eos/saveddata/module.py``, ``Module.calculateSlot``). The mobile slot picker
#: searches and browses one of these scopes, so only modules that would go in the
#: tapped slot come up.
SLOT_SCOPES = ("high", "med", "low", "rig", "subsystem", "service")
SLOT_EFFECTS = {
    "high": "hiPower",
    "med": "medPower",
    "low": "loPower",
    "rig": "rigSlot",
    "subsystem": "subSystem",
    "service": "serviceSlot",
}

#: Turret groups carry a ``chargeSize`` attribute that says the weapon's size
#: (1 small, 2 medium, 3 large); Vorton projectors carry it too. Launchers do not:
#: their size lives in the group name (a Rocket Launcher is small, a Heavy Missile
#: Launcher medium, a Cruise Missile Launcher large). Everything else a fit can hold
#: has no size to match against the ship, so it is never filtered on size.
TURRET_GROUPS = frozenset({
    "Energy Weapon", "Hybrid Weapon", "Projectile Weapon", "Precursor Weapon", "Vorton Projector",
})
LAUNCHER_WEAPON_SIZE = {
    "Missile Launcher Rocket": 1,
    "Missile Launcher Light": 1,
    "Missile Launcher Rapid Light": 1,
    "Missile Launcher Defender": 1,
    "Missile Launcher Heavy": 2,
    "Missile Launcher Heavy Assault": 2,
    "Missile Launcher Rapid Heavy": 2,
    "Missile Launcher Cruise": 3,
    "Missile Launcher Torpedo": 3,
    "Missile Launcher Rapid Torpedo": 3,
    "Missile Launcher XL Cruise": 4,
    "Missile Launcher XL Torpedo": 4,
}

#: English ship-group names -> the largest weapon size class the hull can fit.
#: Small weapons go on frigates (and shuttles), medium on destroyers and cruisers,
#: large on battlecruisers and battleships, extra large on capitals. A hull that is
#: not listed (citadels and the like) gets no size filter at all -- those hulls have
#: their own fitting rules, and the engine's ``canFit`` is the authority there.
SHIP_WEAPON_SIZE = {
    # small: frigates, shuttles and their kin
    "Frigate": 1, "Assault Frigate": 1, "Interceptor": 1, "Covert Ops": 1,
    "Electronic Attack Ship": 1, "Stealth Bomber": 1, "Expedition Frigate": 1,
    "Logistics Frigate": 1, "Shuttle": 1, "Corvette": 1, "Prototype Exploration Ship": 1,
    "Special Edition Yachts": 1, "Capsule": 1,
    # medium: destroyers and cruisers
    "Destroyer": 2, "Interdictor": 2, "Command Destroyer": 2, "Tactical Destroyer": 2,
    "Cruiser": 2, "Heavy Assault Cruiser": 2, "Heavy Interdiction Cruiser": 2,
    "Combat Recon Ship": 2, "Force Recon Ship": 2, "Logistics": 2, "Strategic Cruiser": 2,
    "Flag Cruiser": 2, "Command Ship": 2, "Hauler": 2, "Industrial Command Ship": 2,
    "Expedition Command Ship": 2, "Mining Barge": 2, "Exhumer": 2, "Blockade Runner": 2,
    # large: battlecruisers and battleships
    "Battlecruiser": 3, "Combat Battlecruiser": 3, "Attack Battlecruiser": 3,
    "Battleship": 3, "Black Ops": 3, "Marauder": 3, "Deep Space Transport": 3,
    "Freighter": 3, "Jump Freighter": 3, "Capital Industrial Ship": 3,
    # extra large: capitals
    "Dreadnought": 4, "Lancer Dreadnought": 4, "Carrier": 4, "Supercarrier": 4,
    "Titan": 4, "Force Auxiliary": 4, "Command Carrier": 4,
}


def prepare_tokens(request):
    """Turn a search string into regex tokens, honouring ``re:`` and wildcards."""
    if request.strip().lower().startswith("re:"):
        return [t for t in _prepare_regex(request[3:].strip())]
    return _prepare_normal(request)


def _prepare_normal(request):
    request = re.escape(request)
    request = re.sub(r"\\(?P<ws>\s+)", r"\g<ws>", request)
    request = re.sub(r"\\\*", r"\\w*", request)
    request = re.sub(r"\\\?", r"\\w?", request)
    return request.split()


def _prepare_regex(request):
    """Split a user regex into tokens, keeping character classes together."""
    tokens = []
    current = []
    roundLvl = 0
    squareLvl = 0
    nextEscaped = False
    for char in request:
        if not nextEscaped and char == "\\":
            current.append(char)
            nextEscaped = True
            continue
        if not nextEscaped:
            if char == "(":
                roundLvl += 1
            elif char == ")":
                roundLvl = max(0, roundLvl - 1)
            elif char == "[":
                squareLvl += 1
            elif char == "]":
                squareLvl = max(0, squareLvl - 1)
            elif char == " " and not roundLvl and not squareLvl:
                if current:
                    tokens.append("".join(current))
                    current = []
                continue
        nextEscaped = False
        current.append(char)
    if current:
        tokens.append("".join(current))
    return tokens


def _filters_for(scope, market):
    if scope == "market":
        return [or_(
            types_Category.name.in_(market.SEARCH_CATEGORIES),
            types_Group.name.in_(market.SEARCH_GROUPS))]
    if scope == "implants":
        return [types_Category.name == "Implant"]
    if scope == "everything":
        return [
            or_(
                types_Category.name.in_(market.FIT_CATEGORIES),
                types_Group.name.in_(market.FIT_GROUPS)),
            or_(
                types_Category.name.in_(market.SEARCH_CATEGORIES),
                types_Group.name.in_(market.SEARCH_GROUPS))]
    return [None]


def search_items(text, scope="market", limit=50):
    """Published items matching ``text``, best effort ordered by relevance."""
    market = Market.getInstance()
    filters = _filters_for(scope, market)

    tokens = prepare_tokens(text)
    tokens = JargonLoader.instance().get_jargon().apply(tokens)
    joined = " ".join(tokens)
    if not joined:
        return []
    if not (
        (isStringCjk(joined) and len(joined) >= config.minItemSearchLengthCjk)
        or len(joined) >= config.minItemSearchLength
    ):
        return []

    found = set()
    for filter_ in filters:
        try:
            results = eos.db.searchItemsRegex(
                tokens, where=filter_,
                join=(types_Item.group, types_Group.category),
                eager=("group.category", "metaGroup"))
        except Exception:
            pyfalog.exception("Item search failed for {!r}", text)
            continue
        found.update(results)

    published = [item for item in found if market.getPublicityByItem(item)]
    published.sort(key=_relevance(text))
    return published[:limit]


def _relevance(text):
    """Exact name first, then prefix matches, then the rest alphabetically."""
    lowered = text.strip().lower()

    def key(item):
        name = (item.name or "").lower()
        if name == lowered:
            rank = 0
        elif name.startswith(lowered):
            rank = 1
        elif lowered in name:
            rank = 2
        else:
            rank = 3
        return (rank, len(name), name)

    return key


# ---------------------------------------------------------------------------------------
# The mobile slot picker: browse/search one rack, limited to what the fit's ship can take
# ---------------------------------------------------------------------------------------

#: The rack's modules plus the small bit of each one that decides whether it can be
#: fitted, built once per process straight out of the static data. Every module the
#: picker can offer is catalogued here, so a browse or a scoped search is a filter over
#: a fixed set instead of a scan of thousands of items on every picker that opens.
_SLOT_CATALOG = None


def _slot_catalog():
    global _SLOT_CATALOG
    if _SLOT_CATALOG is not None:
        return _SLOT_CATALOG
    from eos.db import get_gamedata_session

    market = Market.getInstance()
    session = get_gamedata_session()
    forced = list(getattr(market, "ITEMS_FORCEPUBLISHED", {}) or {})
    forced_clause = ""
    if forced:
        quoted = ", ".join("'{}'".format(name.replace("'", "''")) for name in forced)
        forced_clause = " OR i.typeName IN ({})".format(quoted)

    slots = {effect: [] for effect in SLOT_EFFECTS.values()}
    try:
        rows = session.execute(text("""
            SELECT DISTINCT te.typeID, e.effectName
            FROM dgmtypeeffects te
            JOIN dgmeffects e ON e.effectID = te.effectID
            JOIN invtypes i ON i.typeID = te.typeID
            WHERE e.effectName IN (:hi, :med, :lo, :rig, :sub, :serv)
              AND (i.published = 1{forced})
        """.format(forced=forced_clause)), {
            "hi": SLOT_EFFECTS["high"], "med": SLOT_EFFECTS["med"], "lo": SLOT_EFFECTS["low"],
            "rig": SLOT_EFFECTS["rig"], "sub": SLOT_EFFECTS["subsystem"], "serv": SLOT_EFFECTS["service"],
        }).fetchall()
        for type_id, effect in rows:
            slots.setdefault(effect, []).append(type_id)
    except Exception:
        pyfalog.exception("Could not build the slot catalogue")
        _SLOT_CATALOG = {}
        return _SLOT_CATALOG

    type_ids = list({type_id for ids in slots.values() for type_id in ids})
    metas = {type_id: {
        "group": None, "chargeSize": None, "rigSize": None, "volume": 0.0,
        "fitsToShipType": set(), "canFitShipTypes": set(), "canFitShipGroups": set(),
        "isStandup": False,
    } for type_id in type_ids}
    try:
        for type_id, group, category in session.execute(text("""
            SELECT i.typeID, g.name, c.name
            FROM invtypes i
            JOIN invgroups g ON g.groupID = i.groupID
            JOIN invcategories c ON c.categoryID = g.categoryID
            WHERE i.typeID IN :ids
        """).bindparams(bindparam("ids", expanding=True)), {"ids": type_ids}).fetchall():
            metas[type_id]["group"] = group
            metas[type_id]["isStandup"] = category == "Structure Module"
        for type_id, attr, value in session.execute(text("""
            SELECT ta.typeID, a.attributeName, ta.value
            FROM dgmtypeattribs ta
            JOIN dgmattribs a ON a.attributeID = ta.attributeID
            WHERE ta.typeID IN :ids
              AND (a.attributeName = 'chargeSize' OR a.attributeName = 'rigSize'
                   OR a.attributeName = 'volume' OR a.attributeName = 'fitsToShipType'
                   OR a.attributeName LIKE 'canFitShipGroup%'
                   OR a.attributeName LIKE 'canFitShipType%')
        """).bindparams(bindparam("ids", expanding=True)), {"ids": type_ids}).fetchall():
            meta = metas[type_id]
            if attr == "chargeSize":
                meta["chargeSize"] = value
            elif attr == "rigSize":
                meta["rigSize"] = value
            elif attr == "volume":
                meta["volume"] = value
            elif attr == "fitsToShipType":
                meta["fitsToShipType"].add(int(value))
            elif attr.startswith("canFitShipType"):
                meta["canFitShipTypes"].add(int(value))
            elif attr.startswith("canFitShipGroup"):
                meta["canFitShipGroups"].add(int(value))
    except Exception:
        pyfalog.exception("Could not read the slot catalogue metadata")


    catalog = {}
    for slot, effect in SLOT_EFFECTS.items():
        entries = []
        for type_id in slots.get(effect, []):
            meta = metas[type_id]
            meta["slot"] = slot
            meta["size"] = _weapon_size(meta)
            entries.append((type_id, meta))
        catalog[slot] = entries
    _SLOT_CATALOG = catalog
    return _SLOT_CATALOG


def _weapon_size(meta):
    """1-4 for a weapon, None for anything else (no size concept)."""
    group = meta["group"]
    if group in TURRET_GROUPS:
        return int(meta["chargeSize"]) if meta["chargeSize"] else None
    return LAUNCHER_WEAPON_SIZE.get(group)


def _slot_size(meta):
    """The size class a picker's size chips filter on: a weapon's size when it has one,
    else a rig's rig size, else None (the module has no size concept). Kept separate from
    ``meta["size"]`` so the fit filter keeps judging weapons on weapon size only -- a rig's
    rigSize must never be compared against the hull's weapon size class."""
    return meta["size"] if meta["size"] is not None else meta["rigSize"]


def _entry_fits(fit, entry):
    """Whether the fit's ship can take this catalogue entry: the engine's hull rule
    (``Fit.canFit``, which covers ``fitsToShipType`` / ``canFitShipGroup``), the
    capital-modules-off-subcapital rule, the rig size rule, and the weapon size rule.
    A picker offers only what passes all of them, so tapping a slot never lists a
    module the engine would then refuse for any of these reasons."""
    if fit is None:
        return True
    ship = getattr(fit, "ship", None)
    if ship is None:
        return True
    _, meta = entry
    ship_item = ship.item
    fits_on_type = meta["fitsToShipType"] | meta["canFitShipTypes"]
    fits_on_group = meta["canFitShipGroups"]
    if (fits_on_type or fits_on_group) and ship_item.ID not in fits_on_type \
            and ship_item.group.ID not in fits_on_group:
        return False
    if _is_citadel(ship) is not meta["isStandup"]:
        return False
    # EVE does not let capital modules onto subcapital hulls (a volume check)
    if not _is_citadel(ship) and ship.getModifiedItemAttr("isCapitalSize", 0) != 1 \
            and meta["volume"] >= 4000:
        return False
    # A rig must match the hull's rig size
    if meta["slot"] == "rig" and meta["rigSize"] is not None \
            and meta["rigSize"] != ship.getModifiedItemAttr("rigSize"):
        return False
    # A weapon's size class must fit the hull's
    size = meta["size"]
    if size is not None:
        ship_size = SHIP_WEAPON_SIZE.get(ship_item.group.name)
        if ship_size is not None and size > ship_size:
            return False
    return True


def _is_citadel(ship):
    from eos.saveddata.citadel import Citadel

    return isinstance(ship, Citadel)


def search_slot(scope, text, fit=None, limit=500):
    """Published modules of one rack, browsed (empty ``text``) or searched by name.

    ``fit`` narrows the list to modules the fit's ship can take (see
    :func:`_entry_fits`), which is the mobile slot picker's whole point: a tapped slot
    offers only what would actually fit there. Each result comes back paired with its
    size class (1 small .. 4 extra large, None when the module has no size concept), so
    the picker can offer size chips over the list it drew without a second request.
    """
    catalog = _slot_catalog().get(scope, [])
    if not catalog:
        return []

    tokens = prepare_tokens(text)
    tokens = JargonLoader.instance().get_jargon().apply(tokens)
    joined = " ".join(tokens)
    if joined and not (
        (isStringCjk(joined) and len(joined) >= config.minItemSearchLengthCjk)
        or len(joined) >= config.minItemSearchLength
    ):
        return []

    size_by_id = {type_id: _slot_size(meta) for type_id, meta in catalog}
    ids = [type_id for type_id, meta in catalog if _entry_fits(fit, (type_id, meta))]
    if not ids:
        return []

    def _pair(item):
        return item, size_by_id.get(item.ID)

    if not joined:
        items = [item for item in eos.db.getItems(ids, eager=("group.category", "metaGroup"))
                 if item is not None]
        items.sort(key=lambda item: (item.name or "").lower())
        return [_pair(item) for item in items[:limit]]

    try:
        found = eos.db.searchItemsRegex(
            tokens,
            where=types_Item.ID.in_(ids),
            join=(types_Item.group, types_Group.category),
            eager=("group.category", "metaGroup"))
    except Exception:
        pyfalog.exception("Slot search failed for {!r}", joined)
        return []
    found = [item for item in found if item is not None]
    found.sort(key=_relevance(joined))
    return [_pair(item) for item in found[:limit]]

