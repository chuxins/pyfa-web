"""Fitting valuation ("Price" in the desktop client).

The desktop price view (``gui/builtinStatsViews/priceViewFull.py``) asks
``service.price.Price`` for market prices, which the background price worker
fetches from the registered market sources (fuzzwork by default, Jita sell-order
percentile) and stores in the *per-user* ``saveddata.db`` ``prices`` table.

The web server keeps that storage model -- every user already owns the same
database the desktop writes -- but runs the fetch synchronously inside the
request that asks for it, with that user's engine context and lock bound (see
:mod:`web.deps`). The price worker's ``wx.CallAfter`` callback is therefore
never relied upon: :func:`refresh_prices` calls the fetch routine directly and
commits itself, which is the same code path the worker thread runs.
"""

from time import time

from logbook import Logger

from eos.saveddata.price import PriceStatus

pyfalog = Logger(__name__)

#: How long a single market-source round is allowed to take, in seconds. The
#: desktop uses 30 for its refresh; the first open of a fit with no cached rows
#: would otherwise block on the network for up to half a minute.
FETCH_TIMEOUT = 20

#: Price statuses the browser understands.
STATUS_OK = "ok"
STATUS_NO_DATA = "noData"
STATUS_NOT_SUPPORTED = "notSupported"
STATUS_UNAVAILABLE = "unavailable"

_STATUS_MAP = {
    PriceStatus.fetchSuccess: STATUS_OK,
    PriceStatus.notSupported: STATUS_NOT_SUPPORTED,
    PriceStatus.fetchFail: STATUS_UNAVAILABLE,
    PriceStatus.fetchTimeout: STATUS_UNAVAILABLE,
    PriceStatus.initialized: STATUS_NO_DATA,
}


def _row(item, qty):
    """One aggregated price line for one item id."""
    price_obj = item.price
    unit = price_obj.price or 0.0
    status = _STATUS_MAP.get(price_obj.status, STATUS_NO_DATA)
    return {
        "itemId": item.ID,
        "name": item.typeName,
        "qty": qty,
        "unitPrice": unit if status == STATUS_OK else None,
        "total": round(unit * qty, 2) if status == STATUS_OK else None,
        "status": status,
    }


def _collect(fit):
    """Aggregate the fit the same way ``priceViewFull.refreshPanelPrices`` does.

    Returns ``(lines, totals)``: one row per distinct item id for *everything
    the fit uses* (including loaded charges, matching the desktop's
    ``Fit.fitItemIter`` prefetch), and the five subtotals the desktop panel
    shows. Charges ride the fittings bucket -- the panel itself excludes them
    from its manual sum but prefetches them; counting them with fittings is the
    honest "what a full restock costs" answer.
    """
    rows = {}
    kinds = {}

    def add(item, qty, kind):
        if item is None:
            return
        if item.ID not in rows:
            rows[item.ID] = [item, qty]
            kinds[item.ID] = kind
        else:
            rows[item.ID][1] += qty

    if fit.ship is not None:
        add(fit.ship.item, 1, "ship")

    for module in fit.modules:
        if not module.isEmpty:
            add(module.item, 1, "fittings")
            # Module.charge is the gamedata Item itself (not a wrapper)
            if module.charge is not None:
                add(module.charge, module.numCharges or 1, "fittings")

    for drone in fit.drones:
        add(drone.item, drone.amount or 1, "drones")

    for fighter in fit.fighters:
        add(fighter.item, fighter.amount or 1, "drones")

    for cargo in fit.cargo:
        add(cargo.item, cargo.amount or 1, "cargoBay")

    for booster in fit.boosters:
        add(booster.item, 1, "character")

    # priceViewFull iterates applied implants
    for implant in fit.appliedImplants:
        add(implant.item, 1, "character")

    lines = [_row(item, qty) for item, qty in rows.values()]
    lines.sort(key=lambda line: line["itemId"])

    totals = {"ship": 0.0, "fittings": 0.0, "drones": 0.0,
              "cargoBay": 0.0, "character": 0.0}
    for line in lines:
        totals[kinds[line["itemId"]]] += line["total"] or 0.0
    totals = {key: round(value, 2) for key, value in totals.items()}
    totals["total"] = round(sum(value for key, value in totals.items()), 2)
    return lines, totals


def fit_price(fit):
    """The cached valuation of a fit; never touches the network.

    Rows the user has never fetched come back with ``status: noData`` and a
    ``null`` unit price, exactly like the desktop panel before its first fetch.
    """
    from service.fit import Fit as FitService

    lines, totals = _collect(fit)

    items = set(FitService.fitItemIter(fit))
    updating = sum(1 for item in items if not item.price.isValid())
    missing = [line["itemId"] for line in lines if line["status"] != STATUS_OK]
    updated = max((item.price.time or 0 for item in items), default=0)

    options = FitService.getInstance().serviceFittingOptions
    return {
        "fitId": fit.ID,
        "currency": "ISK",
        "totals": totals,
        "lines": lines,
        "missingCount": len(missing),
        "missing": missing,
        "updating": updating > 0,
        "staleCount": updating,
        "source": options["priceSource"],
        "region": options["priceSystem"],
        "updated": updated or None,
    }


def refresh_prices(fit, fetch_timeout=FETCH_TIMEOUT, validity_override=None):
    """Fetch current market prices for every item in the fit, then re-aggregate.

    Runs the registered market sources synchronously (fuzzwork first, then the
    other Tranquility sources) while the caller holds the user's lock, so the
    rows it writes land in the correct per-user database.
    """
    import eos.db
    from service.fit import Fit as FitService
    from service.price import Price

    # Importing the market-source modules registers them on Price.sources; the
    # desktop does this at the bottom of service/price.py but its Price() worker
    # is GUI-bound and is never constructed on the web.
    from service.marketSources import cevemarket, evemarketdata, evetycoon, fuzzwork  # noqa: F401

    items = list(set(FitService.fitItemIter(fit)))
    # Touching item.price creates a per-item Price row (status initialized) for
    # items that have never been priced, which is what fetchPrices expects.
    prices = [item.price for item in items]

    before = time()
    Price.fetchPrices(prices, fetch_timeout, validity_override)
    # fetchPrices only mutates the ORM objects; the worker normally commits in
    # its callback afterwards. Do it explicitly here while the user is bound.
    eos.db.commit()
    pyfalog.debug("Fetched {} prices for fit {} in {:.1f}s", len(prices), fit.ID, time() - before)

    return fit_price(fit)

