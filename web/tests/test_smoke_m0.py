"""M0 smoke validation: the ported service layer runs headless.

Milestone M0 of the port (see ``web/docs/full-port-design.md``) adds no API
endpoints. It proves that the desktop services the port reuses work when driven
directly from a bound engine context -- no ``wx.App``, no event loop:

* ``Port``: auto-detection (DNA / EFT text), saving an imported fit into the
  user's saveddata, and every export format returning text without the GUI
  callback argument (the web layer never passes one).
* ``Price``: the synchronous fetch path writes prices through a stubbed source,
  and ``wx.CallAfter`` round-trips through :mod:`web.events`' Dispatcher with the
  caller's saveddata context intact.
* The profile editors: ``DamagePattern``, ``TargetProfile`` and ``ImplantSets``
  do a full create / list / rename / delete round trip per user.

Known limitation surfaced by this milestone: ``Price.getPrices`` drives the
process-wide ``PriceWorkerThread``, whose thread has no saveddata context bound.
``Price.fetchPrices`` resolves ``Fit.getInstance()`` there and hits the unbound
session guard, so that async path is unusable on the web as-is; the P2 price
work replaces it with a synchronous fetch (or a Dispatcher round trip).
"""

import threading
from contextlib import contextmanager

import pytest

from eos.db import sessionctx
from eos.saveddata.price import PriceStatus
from service.const import PortDnaOptions, PortEftOptions, PortMultiBuyOptions
from web.tests.conftest import AUTOCANNON_ID, EMP_S_ID, RIFTER_ID

#: A Rifter with one 200mm AutoCannon II -- same ship/item the other tests use.
#: DNA spells quantities as ``;n`` (the import detector requires them), so this
#: is ``ship:module;1::``, not ``ship:module::``.
DNA_RIFTER = "587:2889;1::"

#: The same fit as EFT text; the module name must match the gamedata typeName
EFT_RIFTER = "[Rifter, M0 Smoke]\n200mm AutoCannon II"

#: High-grade Talisman Alpha -- an implant with a market group, so the implant
#: set editor can hold it
IMPLANT_ID = 19534


@pytest.fixture
def engine_user(make_user):
    """A signed-in account whose saveddata the smoke tests bind directly."""
    return make_user("M0 Pilot").pyfaUser


@contextmanager
def user_engine(user, app_state):
    """Bind the account's engine context for the duration of the block."""
    with app_state.registry.acquire(user.id) as data:
        with sessionctx.bind_context(data.context):
            yield data


# ---------------------------------------------------------------------------
# Port: import / export
# ---------------------------------------------------------------------------

def test_port_import_auto_detects_dna(app_state, engine_user):
    with user_engine(engine_user, app_state):
        from service.port.port import Port

        import_type, makes_new_fits, fits = Port.importAuto(DNA_RIFTER)
        assert import_type == "DNA"
        assert makes_new_fits is True
        fit = fits[0]
        assert fit.ship.item.typeName == "Rifter"
        # fill() pads every empty rack slot with an EmptyModule, so count the
        # modules that actually carry an item
        real_modules = [m for m in fit.modules if not m.isEmpty]
        assert len(real_modules) == 1
        assert real_modules[0].itemID == AUTOCANNON_ID


def test_port_import_auto_detects_eft_text(app_state, engine_user):
    with user_engine(engine_user, app_state):
        from service.port.port import Port

        import_type, makes_new_fits, fits = Port.importAuto(EFT_RIFTER)
        assert import_type == "EFT"
        assert makes_new_fits is True
        fit = fits[0]
        assert fit.ship.item.typeName == "Rifter"
        assert any(m.itemID == AUTOCANNON_ID for m in fit.modules)


def test_port_import_fit_from_buffer_saves_fit(app_state, engine_user):
    """The paste path stores the fit in the caller's saveddata."""
    with user_engine(engine_user, app_state):
        from service.fit import Fit as svcFit
        from service.port.port import Port

        import_type, import_data = Port.importFitFromBuffer(DNA_RIFTER)
        assert import_type == "DNA"
        fit = import_data[0]

        saved = svcFit.getInstance().getFit(fit.ID)
        assert saved is not None
        assert saved.ship.item.typeName == "Rifter"
        assert saved.character is not None, "the saved fit must carry a character"


def test_port_exports_return_text_without_gui_callback(app_state, engine_user):
    """Every export defaults ``callback=None``; the web calls them synchronously.

    This pins down port risk #2 from the design doc: none of the exports
    unconditionally call ``callback(...)``, so no noop wrapper is needed.

    The fit is exported the way the desktop does it -- saved first, then reloaded
    with ``getFit``, so the in-memory ``EmptyModule`` rack padding from ``fill()``
    is gone and the stats export does not walk it.
    """
    with user_engine(engine_user, app_state):
        from service.fit import Fit as svcFit
        from service.port.port import Port

        import_type, import_data = Port.importFitFromBuffer(DNA_RIFTER)
        assert import_type == "DNA"
        fit = svcFit.getInstance().getFit(import_data[0].ID)
        assert fit is not None

        eft = Port.exportEft(fit, {
            PortEftOptions.IMPLANTS: True,
            PortEftOptions.MUTATIONS: True,
            PortEftOptions.LOADED_CHARGES: True,
            PortEftOptions.CARGO: True,
            PortEftOptions.BOOSTERS: True,
        })
        assert eft.startswith("[Rifter,")
        assert "200mm AutoCannon II" in eft

        dna = Port.exportDna(fit, {PortDnaOptions.FORMATTING: False})
        assert dna.startswith("587:")
        assert dna.endswith("::")

        # OPTIMIZE_PRICES would route through the price worker thread, which has
        # no saveddata context on the web (see module docstring): keep it off.
        multibuy = Port.exportMultiBuy(fit, {
            PortMultiBuyOptions.LOADED_CHARGES: True,
            PortMultiBuyOptions.CARGO: True,
            PortMultiBuyOptions.IMPLANTS: True,
            PortMultiBuyOptions.BOOSTERS: True,
            PortMultiBuyOptions.OPTIMIZE_PRICES: False,
        })
        assert "200mm AutoCannon II" in multibuy

        stats = Port.exportFitStats(fit)
        assert "Rifter" in stats


def test_port_export_callback_is_optional_and_still_works(app_state, engine_user):
    """A caller that does pass a callback gets it invoked, desktop style."""
    with user_engine(engine_user, app_state):
        from service.port.port import Port

        _, _, fits = Port.importAuto(DNA_RIFTER)
        fit = fits[0]
        captured = []
        Port.exportDna(fit, {PortDnaOptions.FORMATTING: True}, callback=captured.append)
        assert len(captured) == 1
        assert captured[0].startswith("<url=fitting:587:")


# ---------------------------------------------------------------------------
# Price: synchronous fetch, and the wx.CallAfter -> Dispatcher bridge
# ---------------------------------------------------------------------------

class StubPriceSource:
    """A price source that never touches the network."""

    name = "smoke"
    group = "tranquility"

    def __call__(self, priceMap, systemID, fetchTimeout):
        for price in priceMap.values():
            price.update(PriceStatus.fetchSuccess, 12.34)
        priceMap.clear()


def _stub_prices(monkeypatch):
    """Point the price service at the stub source and the stub price system."""
    from service.fit import Fit as svcFit
    from service.price import Price

    monkeypatch.setattr(Price, "sources", {"smoke": StubPriceSource()})
    fit_svc = svcFit.getInstance()
    monkeypatch.setattr(
        fit_svc, "serviceFittingOptions",
        {**fit_svc.serviceFittingOptions, "priceSource": "smoke", "priceSystem": "Jita"})
    return Price


def test_price_fetch_prices_synchronous_with_stub_source(app_state, engine_user, monkeypatch):
    with user_engine(engine_user, app_state):
        Price = _stub_prices(monkeypatch)
        from service.market import Market

        mkt = Market.getInstance()
        price = mkt.getItem(AUTOCANNON_ID).price
        assert price.status == PriceStatus.initialized

        Price.fetchPrices([price], fetchTimeout=10, validityOverride=None)

        assert price.status == PriceStatus.fetchSuccess
        assert price.price == 12.34
        assert price.isValid()


def test_price_get_price_now_reads_stored_value(app_state, engine_user, monkeypatch):
    with user_engine(engine_user, app_state):
        Price = _stub_prices(monkeypatch)
        from service.market import Market

        mkt = Market.getInstance()
        price = mkt.getItem(AUTOCANNON_ID).price
        Price.fetchPrices([price], fetchTimeout=10, validityOverride=None)

        assert Price.getInstance().getPriceNow(AUTOCANNON_ID) == 12.34


def test_wx_call_after_round_trips_through_dispatcher_with_context(app_state, engine_user):
    """``wx.CallAfter`` lands on web.events' dispatcher, context intact.

    This is the bridge pyfa's background threads rely on: a callback queued
    inside a request still sees that request's saveddata session.
    """
    import wx

    done = threading.Event()
    observed = []

    def cb():
        observed.append(sessionctx.current_context().name)
        done.set()

    with user_engine(engine_user, app_state) as data:
        expected = data.context.name
        wx.CallAfter(cb)
        assert done.wait(10), "wx.CallAfter never reached the dispatcher thread"

    assert observed == [expected]


# ---------------------------------------------------------------------------
# Damage patterns / target profiles / implant sets
# ---------------------------------------------------------------------------

def test_damage_pattern_crud(app_state, engine_user):
    with user_engine(engine_user, app_state):
        from service.damagePattern import DamagePattern

        svc = DamagePattern.getInstance()
        pattern = svc.newPattern("M0 Pattern")
        assert pattern.name == "M0 Pattern"
        assert any(x.name == "M0 Pattern" for x in svc.getUserDamagePatternList())

        svc.renamePattern(pattern, "M0 Pattern Renamed")
        assert pattern.name == "M0 Pattern Renamed"

        svc.deletePattern(pattern)
        assert all(x.name != "M0 Pattern Renamed" for x in svc.getUserDamagePatternList())


def test_target_profile_crud(app_state, engine_user):
    with user_engine(engine_user, app_state):
        from service.targetProfile import TargetProfile

        svc = TargetProfile.getInstance()
        profile = svc.newPattern("M0 Profile")
        assert profile.name == "M0 Profile"
        assert any(x.name == "M0 Profile" for x in svc.getUserTargetProfileList())

        svc.renamePattern(profile, "M0 Profile Renamed")
        assert profile.name == "M0 Profile Renamed"

        svc.deletePattern(profile)
        assert all(x.name != "M0 Profile Renamed" for x in svc.getUserTargetProfileList())


def test_implant_set_crud(app_state, engine_user):
    with user_engine(engine_user, app_state):
        from service.implantSet import ImplantSets

        svc = ImplantSets.getInstance()
        implant_set = svc.newSet("M0 Set")
        assert implant_set.name == "M0 Set"
        assert any(x.name == "M0 Set" for x in svc.getImplantSetList())

        svc.addImplants(implant_set.ID, IMPLANT_ID)
        implants = svc.getImplants(implant_set.ID)
        assert len(implants) == 1
        assert implants[0].item.ID == IMPLANT_ID

        svc.renameSet(implant_set, "M0 Set Renamed")
        assert implant_set.name == "M0 Set Renamed"

        svc.deleteSet(implant_set)
        assert all(x.name != "M0 Set Renamed" for x in svc.getImplantSetList())
