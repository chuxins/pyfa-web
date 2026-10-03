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
    if scope in SLOT_SCOPES:
        # Modules and subsystems both carry the slot effects; the slot itself is
        # decided by the post-filter below (``_search_slot``), not by the category.
        return [types_Category.name.in_(("Module", "Subsystem"))]
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
    """Published items matching ``text``, best effort ordered by relevance.

    A slot scope (`high`, `med`, `low`, `rig`, `subsystem`, `service`) searches only
    the modules that go in that rack, and with an empty query lists them all
    alphabetically -- that is the mobile slot picker's "pick a module for this slot"
    view. Every other scope keeps the desktop behaviour: an empty query finds nothing.
    """
    market = Market.getInstance()
    filters = _filters_for(scope, market)

    tokens = prepare_tokens(text)
    tokens = JargonLoader.instance().get_jargon().apply(tokens)
    joined = " ".join(tokens)
    if scope in SLOT_SCOPES:
        return _search_slot(scope, joined, tokens, market, limit)
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


#: Item ids of each slot's published modules, computed once per process. Scanning the
#: game data for slot effects is the slow part; keeping the ids makes a browse or a
#: scoped search a query over a fixed set instead of a scan of thousands of items on
#: every picker that opens.
_SLOT_IDS = None


def _slot_item_ids():
    global _SLOT_IDS
    if _SLOT_IDS is not None:
        return _SLOT_IDS
    market = Market.getInstance()
    cache = {slot: [] for slot in SLOT_EFFECTS}
    for category in ("Module", "Subsystem"):
        try:
            items = eos.db.getItemsByCategory(category, eager=("group.category", "metaGroup"))
        except Exception:
            pyfalog.exception("Could not list {} items for the slot picker", category)
            continue
        for item in items:
            for slot, effect in SLOT_EFFECTS.items():
                if effect in item.effects:
                    if market.getPublicityByItem(item):
                        cache[slot].append(item.ID)
                    break
    _SLOT_IDS = {slot: tuple(ids) for slot, ids in cache.items()}
    return _SLOT_IDS


def _slot_items(slot, limit):
    """Published modules of one rack, sorted by name; at most ``limit`` of them."""
    ids = _slot_item_ids().get(slot) or ()
    if not ids:
        return []
    items = eos.db.getItems(ids, eager=("group.category", "metaGroup"))
    items = [item for item in items if item is not None]
    items.sort(key=lambda item: (item.name or "").lower())
    return items[:limit]


def _search_slot(slot, joined, tokens, market, limit):
    """A browse (empty query) or a name search restricted to one rack's modules."""
    ids = _slot_item_ids().get(slot) or ()
    if not ids:
        return []
    if not joined:
        return _slot_items(slot, limit)
    if not (
        (isStringCjk(joined) and len(joined) >= config.minItemSearchLengthCjk)
        or len(joined) >= config.minItemSearchLength
    ):
        return []

    found = set()
    try:
        results = eos.db.searchItemsRegex(
            tokens,
            where=types_Item.ID.in_(ids),
            join=(types_Item.group, types_Group.category),
            eager=("group.category", "metaGroup"))
    except Exception:
        pyfalog.exception("Slot search failed for {!r}", joined)
        return []
    found.update(results)

    published = [item for item in found if market.getPublicityByItem(item)]
    published.sort(key=_relevance(joined))
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
