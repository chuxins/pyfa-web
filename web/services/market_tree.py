"""The market browser tree the Hardware tab draws.

The desktop's market browser walks the market-group tree (``Market.getMarketRoot``
down through ``getMarketGroupChildren``) and lists each group's items with
``getItemsByMarketGroup``; the web port does the same in one shot. The tree is small
enough (roughly 600 market groups and 4.4k fit items) to build once and hand to the
client, which then filters and collapses it locally exactly like the wx tree does
lazily.

Only the roots a fit can hold are walked -- Ship Equipment, Rigs, Subsystems,
Drones, Structure Equipment and Structure Modifications feed the Modules tab and
Ammunition & Charges feeds the Charges tab, mirroring the reference Hardware
listing (modules, charges, drones, subsystems and structures). Implants, deployables
and filaments are fitted elsewhere in pyfa's UI, so they are left out here.

The whole tree is read with two bulk queries (every market group, every item in the
fit roots) and assembled in Python, because walking the SQLAlchemy relationships one
group at a time costs a round-trip per group (~600 lazy loads, seconds on a cold
cache). Each item carries the few fields the tab needs to draw and filter it without
a second request: its own id/name for the leaf, ``kind`` and ``slotType`` for the
slot filter icons, and ``metaGroupId`` so a group's rows can be ordered Tech I,
Tech II, faction, ... the way the reference does.
"""

from functools import lru_cache

from sqlalchemy import bindparam, text

from web.services.serialize import classify_item

#: Market-group roots the Modules / Charges tabs are built from (a subset of
#: ``service.market.ROOT_MARKET_GROUPS``, kept here so the client does not need the
#: service's internals). Charges land in their own tab; everything else in Modules.
ROOT_MARKET_GROUPS = (9, 1111, 1112, 157, 2202, 2203, 11)

#: Slot scopes -> the label the filter icons and the drag preview expect.
SLOT_LABELS = {
    "high": "High",
    "med": "Medium",
    "low": "Low",
    "rig": "Rig",
    "subsystem": "SubSystem",
    "service": "Service",
}


def _slot_of():
    """``type_id -> "Low"/"Medium"/...`` for every module that lives in a rack.

    Reuses the slot catalogue the rack search builds (``web.services.search``),
    which is one query over the dogma effects for the whole game data, so this does
    not construct a Module per item.
    """
    from web.services.search import _slot_catalog

    catalog = _slot_catalog()
    return {
        type_id: SLOT_LABELS[scope]
        for scope, entries in catalog.items()
        for type_id, _meta in entries
    }


@lru_cache(maxsize=1)
def _build():
    """The whole tree, cached per process: the game data is static, and the Market
    service is process-wide, so the same object answers every request."""
    import eos.config
    import eos.db

    from service.market import Market

    market = Market.getInstance()
    session = eos.db.get_gamedata_session()
    lang = eos.config.lang  # "" for English, "_zh" for Chinese, ...

    # Every market group in one query: id, name in the server's language, icon, parent
    rows = session.execute(text(
        "SELECT marketGroupID, marketGroupName{}, iconID, parentGroupID "
        "FROM invmarketgroups".format(lang))).fetchall()
    groups = {row[0]: {"name": row[1], "iconId": row[2], "parent": row[3]} for row in rows}

    # The subtree reachable from the fit roots (walked in Python, no ORM round-trips)
    subtree = set()
    stack = [root for root in ROOT_MARKET_GROUPS if root in groups]
    while stack:
        group_id = stack.pop()
        if group_id in subtree:
            continue
        subtree.add(group_id)
        for other, info in groups.items():
            if info["parent"] == group_id:
                stack.append(other)

    children = {group_id: [] for group_id in subtree}
    for group_id in subtree:
        parent = groups[group_id]["parent"]
        if parent in subtree:
            children[parent].append(group_id)

    # Every item in the subtree in one query, with the English group/category names
    # classify_item compares against and the English name the search box matches
    item_rows = session.execute(
        text("SELECT i.typeID, i.{0}, i.typeName, i.metaGroupID, i.marketGroupID, "
             "g.name, c.name "
             "FROM invtypes i JOIN invgroups g ON i.groupID = g.groupID "
             "JOIN invcategories c ON c.categoryID = g.categoryID "
             "WHERE i.published = 1 AND i.marketGroupID IN :ids".format("typeName" + lang))
        .bindparams(bindparam("ids", expanding=True)),
        {"ids": list(subtree)}).fetchall()

    slot_of = _slot_of()
    items_by_group = {}
    for type_id, name, name_en, meta_group_id, group_id, group_name, category_name in item_rows:
        items_by_group.setdefault(group_id, []).append({
            "id": type_id,
            "name": name,
            "nameEn": name_en,
            "kind": _classify(category_name, group_name),
            "metaGroupId": meta_group_id,
            "slotType": slot_of.get(type_id),
        })

    # pyfa files a handful of items that CCP left without a market group into one
    # (e.g. Civilian Hobgoblin -> Light Scout Drones); honour those overrides.
    for group_id, names in getattr(market, "ITEMS_FORCEDMARKETGROUP_R", {}).items():
        if group_id not in subtree:
            continue
        for name in names:
            item = market.getItem(name)
            if item is None or not market.getPublicityByItem(item):
                continue
            items_by_group.setdefault(group_id, []).append(_item_node(item, slot_of))

    def build(group_id):
        node_items = items_by_group.get(group_id, [])
        node_items.sort(key=lambda entry: (entry["metaGroupId"] or 0, (entry["name"] or "").lower()))
        node_children = []
        for child in sorted(children[group_id], key=lambda gid: (groups[gid]["name"] or "").lower()):
            node = build(child)
            if node is not None:
                node_children.append(node)
        if not node_items and not node_children:
            return None
        return {
            "id": group_id,
            "name": groups[group_id]["name"],
            "groups": node_children,
            "items": node_items,
        }

    roots = []
    for root in sorted(ROOT_MARKET_GROUPS, key=lambda gid: (groups[gid]["name"] or "").lower()):
        if root in subtree:
            node = build(root)
            if node is not None:
                roots.append(node)
    return {"groups": roots}


def market_tree():
    """The market browser tree (root market groups, each with children and items)."""
    return _build()


def _classify(category, group):
    """The same shape as :func:`web.services.serialize.classify_item`, but for the
    raw SQL rows this module reads (it never builds Item objects)."""
    if category == "Drone":
        return "drone"
    if category == "Fighter":
        return "fighter"
    if category == "Charge":
        return "charge"
    if category == "Implant":
        return "booster" if group == "Booster" else "implant"
    if category in ("Module", "Subsystem", "Structure Module"):
        return "module"
    if category in ("Ship", "Structure"):
        return "ship"
    return "cargo"


def _item_node(item, slot_of):
    meta = getattr(item, "metaGroup", None)
    return {
        "id": item.ID,
        "name": item.name,
        "nameEn": item.typeName,
        "kind": classify_item(item),
        "metaGroupId": getattr(meta, "ID", None),
        "slotType": slot_of.get(item.ID),
    }
