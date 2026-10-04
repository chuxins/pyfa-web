"""Chart API tests.

The graphs endpoints are thin wrappers over pyfa's own graph data layer
(``graphs/data/``), which the desktop renders with matplotlib. These tests pin
down that the headless service can drive it end to end: the graph list, one
plain curve, the ammo-segmented Application Profile curve, the hover point
readout, and the usual not-found answers.
"""

import pytest

from web.tests.conftest import AUTOCANNON_ID, RIFTER_ID


def make_fit(client, name="Graph Test"):
    response = client.post("/api/fits", json={"shipId": RIFTER_ID, "name": name})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def run_command(client, fit_id, command, **args):
    response = client.post("/api/fits/{}/commands".format(fit_id),
                           json={"command": command, "args": args})
    assert response.status_code == 200, response.text
    return response.json()


def test_graph_list_lists_visible_graphs_and_targets(user_client):
    fit_id = make_fit(user_client)
    payload = user_client.get("/api/fits/{}/graphs".format(fit_id)).json()

    ids = [graph["id"] for graph in payload["graphs"]]
    for expected in ("dmgStatsGraph", "capacitorGraph", "shieldRegenGraph",
                     "ammoOptimalDpsGraph", "lockTimeGraph"):
        assert expected in ids
    # The hidden ECM burst graph stays out of the public list
    assert "ecmBurstScanresDamps" not in ids

    dmg = next(g for g in payload["graphs"] if g["id"] == "dmgStatsGraph")
    assert dmg["hasTargets"] is True
    assert dmg["hasSegments"] is False
    assert any(d["handle"] == "distance" for d in dmg["xDefs"])
    assert any(d["handle"] == "dps" for d in dmg["yDefs"])
    assert any(i["handle"] == "distance" for i in dmg["inputs"])
    assert dmg["srcVector"] is not None and dmg["tgtVector"] is not None

    app = next(g for g in payload["graphs"] if g["id"] == "ammoOptimalDpsGraph")
    assert app["hasSegments"] is True

    # Built-in target profiles are offered for the target selector
    assert any(t["type"] == "profile" for t in payload["targets"])
    assert payload["defaultTarget"]["type"] == "profile"


def test_plot_returns_curve_for_capacitor(user_client):
    fit_id = make_fit(user_client)
    payload = user_client.get(
        "/api/fits/{}/graphs/capacitorGraph/plot?x=time:s&y=capAmount:GJ".format(fit_id)
    ).json()
    assert payload["x"]["handle"] == "time"
    assert payload["y"]["handle"] == "capAmount"
    assert payload["range"] == [0, 300]
    assert payload["series"], "a capacitor graph should draw at least one curve"
    series = payload["series"][0]
    assert series["points"]
    assert series["color"].startswith("#")
    assert all(len(point) == 2 for point in series["points"])


def test_plot_with_range_and_misc_inputs(user_client):
    fit_id = make_fit(user_client)
    payload = user_client.get(
        "/api/fits/{}/graphs/capacitorGraph/plot"
        "?x=time:s&y=capRegen:GJ/s&range=0,60&inputs={{\"capAmountT0\":50}}".format(fit_id)
    ).json()
    assert payload["range"] == [0, 60]
    assert payload["series"]


def test_application_profile_draws_ammo_segments(user_client):
    fit_id = make_fit(user_client)
    run_command(user_client, fit_id, "addLocalModule", itemId=AUTOCANNON_ID)
    payload = user_client.get(
        "/api/fits/{}/graphs/ammoOptimalDpsGraph/plot"
        "?x=distance:km&y=dps:&ammoStyle=color&tgt=profile:-5".format(fit_id)
    ).json()
    assert payload["series"], "an autocannon fit should draw ammo segments"
    assert any(series["ammo"] for series in payload["series"])


def test_point_returns_y_at_x(user_client):
    fit_id = make_fit(user_client)
    payload = user_client.get(
        "/api/fits/{}/graphs/capacitorGraph/point?at=10&x=time:s&y=capAmount:GJ".format(fit_id)
    ).json()
    assert payload["x"] == 10
    assert payload["y"] is not None


def test_unknown_graph_and_fit_are_404(user_client, client):
    fit_id = make_fit(user_client)
    assert user_client.get("/api/fits/{}/graphs/nope/plot".format(fit_id)).status_code == 404
    assert client.get("/api/fits/999999/graphs").status_code == 404


@pytest.fixture
def zh_catalog():
    """Point the wx shim at the zh_CN catalogue for one test, then restore it.

    The session app is configured once (en_US), so a test that wants the
    translated names switches the process-wide shim and hands it back.
    """
    from pyfa_compat import wx_headless

    from web.tests.test_i18n import LOCALE_DIR

    previous = (wx_headless._LOCALE_DIR, wx_headless._LANGUAGE, wx_headless._translation)
    wx_headless.configure_i18n(locale_dir=str(LOCALE_DIR), language="zh_CN")
    yield wx_headless
    (wx_headless._LOCALE_DIR, wx_headless._LANGUAGE, wx_headless._translation) = previous


def test_target_names_follow_the_server_language(zh_catalog):
    """Built-in target profiles get Chinese names under zh_CN, user profiles not.

    ``eos`` builds the built-in profiles once with English text (its ``_t`` is a
    no-op), so the graphs service decomposes each ``[category]`` and the tail
    and runs the fragments through the pyfa catalogue; a user profile is shown
    exactly as the user typed it.
    """
    from web.services import graphs as graphs_service

    class FakeProfile:
        def __init__(self, full_name, builtin=True):
            self.fullName = full_name
            self.builtin = builtin

    display_name = graphs_service._target_display_name
    assert display_name(FakeProfile("[NPC][Asteroid]Angel Cartel")) == "[NPC][小行星]天使联合企业"
    assert display_name(FakeProfile("[NPC][Burner][Team]Enyo")) == "[NPC][燃烧者][小队]恩尤"
    assert display_name(FakeProfile("[NPC][Burner]Ashimmu")) == "[NPC][燃烧者]阿什姆级"
    assert display_name(FakeProfile("[T1 Resist]Shield (+T2 DCU)")) == "[T1抗性]护盾（+T2损控）"
    assert display_name(FakeProfile("Ideal Target")) == "理想目标"
    # A user profile is exactly what the user typed
    assert display_name(FakeProfile("My Tank", builtin=False)) == "My Tank"

    # The legend shows the same translated target name (short form, no brackets)
    class FakeSrc:
        shortName = "Rifter"

    class FakeTgt:
        isProfile = True

        def __init__(self, short_name, builtin=True):
            self.shortName = short_name
            self.item = type("Item", (), {"builtin": builtin})()

    series_name = graphs_service._series_name
    assert series_name(FakeSrc(), FakeTgt("Angel Cartel")) == "Rifter vs 天使联合企业"
    assert series_name(FakeSrc(), FakeTgt("My Tank", builtin=False)) == "Rifter vs My Tank"
