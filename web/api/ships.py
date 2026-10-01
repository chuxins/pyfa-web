"""Ship browser: the class tree, ship search, and per-ship detail."""

from fastapi import APIRouter, HTTPException, Query
from logbook import Logger

from web.services.serialize import display_name, item_image, serialize_fit_summary, serialize_item

pyfalog = Logger(__name__)

router = APIRouter(prefix="/ships", tags=["ships"])

#: Slot attributes as they appear on a ship type, in rack order
SLOT_ATTRIBUTES = (
    ("high", "hiSlots"),
    ("med", "medSlots"),
    ("low", "lowSlots"),
    ("rig", "rigSlots"),
    ("subsystem", "maxSubSystems"),
    ("service", "serviceSlots"),
    ("fighterLight", "fighterLightSlots"),
    ("fighterSupport", "fighterSupportSlots"),
    ("fighterHeavy", "fighterHeavySlots"),
    ("standupLight", "fighterStandupLightSlots"),
    ("standupSupport", "fighterStandupSupportSlots"),
    ("standupHeavy", "fighterStandupHeavySlots"),
)


#: Race id (``invtypes.raceID``) -> label, per language. The four empires and Jove are
#: the races ESI lists under ``universe/races``; 128 and 135 are ORE and Triglavian,
#: which the ships' own descriptions say (the Primae is a "重新设计的联合矿业运载舰", the
#: Hydra is built on a "三神裔 ... 护卫舰"). Every other race id -- CCP's internal rows,
#: such as the one the pirate-faction hulls share, and types with no race at all --
#: gets the fallback label rather than a guess at what it stands for.
RACE_LABELS = {
    1: {"en": "Caldari", "zh": "加达里"},
    2: {"en": "Minmatar", "zh": "米玛塔尔"},
    4: {"en": "Amarr", "zh": "艾玛"},
    8: {"en": "Gallente", "zh": "盖伦特"},
    16: {"en": "Jove", "zh": "朱庇特"},
    128: {"en": "ORE", "zh": "ORE"},
    135: {"en": "Triglavian", "zh": "三神裔"},
}

RACE_LABEL_FALLBACK = {"en": "Other", "zh": "其他"}

#: The order a group's race rows are drawn in: the four empires, then the factions that
#: build hulls of their own (Jove, ORE, the Triglavian Collective), then the races this
#: gamedata has no name for. A number rather than the label, because ordering labels only
#: works inside the one language they are written in.
RACE_ORDER = {4: 10, 1: 20, 8: 30, 2: 40, 16: 50, 128: 60, 135: 70}
RACE_ORDER_FALLBACK = 1000


def ship_slots(item):
    """How many slots of each kind a ship has."""
    layout = {}
    for name, attribute in SLOT_ATTRIBUTES:
        value = item.getAttribute(attribute) if hasattr(item, "getAttribute") else None
        layout[name] = int(value or 0)
    for name, attribute in (("turret", "turretSlotsLeft"), ("launcher", "launcherSlotsLeft")):
        value = item.getAttribute(attribute) if hasattr(item, "getAttribute") else None
        layout[name] = int(value or 0)
    return layout


def ship_summary(item, fitCount=None, race=None):
    """One ship as the tree and the search list show it.

    ``fitCount`` and ``race`` are the two things only the tree knows: how many of this
    user's fits use the ship, and the race it is filed under, which the browser draws as
    the level below a group (see :func:`race_row`). Passing neither is what the search
    results do -- they are a flat list of ships.
    """
    summary = {
        "id": item.ID,
        "name": item.name,
        "iconId": getattr(item, "iconID", None),
        "graphicId": getattr(item, "graphicID", None),
        "image": item_image(item),
    }
    if fitCount is not None:
        summary["fitCount"] = fitCount
    if race is not None:
        summary["race"] = race
    return summary


def race_label(raceID):
    """What the race a ship is filed under is called, in the server's language."""
    import eos.config

    labels = RACE_LABELS.get(raceID, RACE_LABEL_FALLBACK)
    language = (eos.config.lang or "").lstrip("_") or "en"
    return labels.get(language, labels["en"])


def race_row(raceID):
    """A ship's race as the browser needs it: what the row says, and where it goes.

    ``id`` is the game's own (``None`` for a type it files no race for) and is only there
    for the client to key its own bookkeeping by; the label is what the row shows and what
    a collapsed row is remembered by, so it is written in the server's language.
    """
    return {
        "id": raceID,
        "name": race_label(raceID),
        "order": RACE_ORDER.get(raceID, RACE_ORDER_FALLBACK),
    }


def group_ships(market, group):
    """The published ships of one group, however the group holds them.

    ``Market.getShipList`` reads a group's ``addItems``, the list pyfa fills in memory as
    it builds its singleton (``service/market.py``). For every group but one that list is
    just a view of ``invgroups``; the limited-edition group is a ``types_Group()`` with no
    row behind it, so the in-memory list is the only thing holding its ships, and it is
    filed into the Ship category as the Market is built -- a process where a second Market
    was built (``getInstance`` used to be unguarded, and the worker thread that Market
    starts gives it five seconds to finish) can hand us that other copy instead, which
    holds no list at all. The ships are then looked up in the name -> group table they were
    attached from, by group id, which both copies share.
    """
    items = [item for item in market.getShipList(group.ID) if market.getPublicityByItem(item)]
    if items:
        return items

    forced = getattr(market, "ITEMS_FORCEGROUP_R", {})
    names = forced.get(group)
    if names is None:
        names = next(
            (
                value
                for other, value in forced.items()
                if getattr(other, "ID", None) == getattr(group, "ID", None)
            ),
            None,
        )
    if not names:
        return items

    return [
        item
        for item in (market.getItem(name) for name in sorted(names))
        if item is not None and market.getPublicityByItem(item)
    ]


def add_group(byCategory, listed, market, group, fitCounts):
    """File one group's row into the tree's categories, if it has published ships.

    ``listed`` carries the group ids already filed: pyfa's Ship category can hold more than
    one copy of its synthetic limited-edition group (see :func:`group_ships`), and the
    client keys its rows by group id.
    """
    if getattr(group, "ID", None) in listed:
        return

    items = group_ships(market, group)
    if not items:
        return
    listed.add(group.ID)

    category = getattr(group, "category", None)
    key = getattr(category, "name", None) or "Other"
    entry = byCategory.setdefault(key, {
        "key": key,
        "name": display_name(category) or key,
        "groups": [],
    })
    ships = [
        ship_summary(item, fitCounts.get(item.ID, 0), race_row(getattr(item, "raceID", None)))
        for item in items
    ]
    ships.sort(key=lambda ship: ship["name"] or "")
    entry["groups"].append({
        "id": group.ID,
        "name": display_name(group) or key,
        "ships": ships,
    })


@router.get("/tree")
def get_tree():
    """Ships grouped by group, grouped by category.

    Mirrors the desktop ship browser's root: every group in the Ship and
    Structure categories, with the ships that are published.

    ``name`` is whatever the engine calls the category/group in the server's
    language; ``key`` stays English so the client has something stable to sort and
    remember expand/collapse state by.

    The groups are the classes pyfa files a ship under. Each ship also carries the race it
    is filed under (``race``, see :func:`race_row`), which is the level below a group:
    舰船 -> 巡洋舰 -> 艾玛 -> 预言级. That is what tells apart ships pyfa keeps in one
    group anyway -- every limited-edition hull sits in a single synthetic group whatever
    built it (id -1, with no ``invgroups`` row behind it) -- and the client draws a race
    row only for the groups that field more than one race.

    ``fitCount`` is how many fits of this user's own database use the ship, counted in
    one query for the whole tree. It is what lets the browser offer the fits under the
    ship they belong to (see ``ShipBrowser.vue``), and it is the reason the tree is not
    cached per server.
    """
    import eos.db
    from service.market import Market

    market = Market.getInstance()
    groups = market.getShipRoot()
    fitCounts = dict(eos.db.countFitGroupedByShip())

    byCategory = {}
    listed = set()
    # Id order, so which copy of a group is kept does not depend on how a set iterates
    for group in sorted(groups, key=lambda entry: getattr(entry, "ID", 0)):
        add_group(byCategory, listed, market, group, fitCounts)

    # ... and then the one group that is not in the category the tree read: pyfa holds the
    # limited-edition hulls in memory and files their group into the Ship category as the
    # Market is built, so a category that was read from the database (or from a session
    # built before the Market was) has no row for it -- and it is the one group the browser
    # must not lose (see :func:`group_ships`).
    if getattr(market, "les_grp", None) is not None:
        if getattr(market.les_grp, "category", None) is None:
            # A copy from a second Market may not have reached that line of pyfa's own init
            market.les_grp.category = market.getCategory("Ship")
        add_group(byCategory, listed, market, market.les_grp, fitCounts)

    for entry in byCategory.values():
        entry["groups"].sort(key=lambda g: g["name"] or "")

    return {
        # Ships first, then structures and whatever else, all alphabetical
        "categories": [
            byCategory[key] for key in sorted(byCategory, key=lambda k: (k != "Ship", k))
        ]
    }


@router.get("/search")
def search_ships(q: str = Query(..., min_length=1), limit: int = Query(40, ge=1, le=200)):
    from service.market import Market

    market = Market.getInstance()
    ships = market.searchShips(q)
    results = [ship_summary(item) for item in ships]
    results.sort(key=lambda s: s["name"] or "")
    return {"results": results[:limit]}


@router.get("/{ship_id}")
def get_ship(ship_id: int):
    """Ship detail plus the fits this user has for it."""
    import eos.db
    from service.market import Market

    market = Market.getInstance()
    item = market.getItem(ship_id, eager=("group.category", "attributes"))
    if item is None:
        raise HTTPException(status_code=404, detail="ship not found")

    fits = []
    try:
        for fit in eos.db.getFitsWithShip(ship_id):
            fits.append(serialize_fit_summary(fit))
        fits.sort(key=lambda f: (f["modified"] or "", f["name"] or ""), reverse=True)
    except Exception:
        pyfalog.exception("Failed to list fits for ship {}", ship_id)

    return {
        "ship": serialize_item(item, detail=True),
        "slots": ship_slots(item),
        "fits": fits,
    }
