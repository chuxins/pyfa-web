"""The level-1 simulation floor for untrained *ship* skills.

The in-game fitting window assembles a fit without checking prerequisites and
applies a ship's bonuses at level 1 for a ship skill the pilot has not trained;
pyfa's engine uses the real level (0), so e.g. a Widow fit on a pilot still
training Caldari Battleship read 90% of the in-game DPS. The engine now mirrors
the game for ship bonuses (``eos/modifiedAttributeDict.__handleSkill``).

Module skill effects are *not* floored -- the game does not floor those, and
flooring them would wrongly discount a shield booster's capacitor use by the
Shield Compensation bonus (see `test_untrained_module_skill_is_not_floored`).
The All 0 / All 5 presets keep their fixed levels.
"""

import datetime

import pytest

from eos.db import sessionctx

WIDOW_ID = 22436
CRUISE_L2 = 19739            # Cruise Missile Launcher II
MJOLNIR_FURY_CRUISE = 24535  # base 525 EM damage
GIST_XL_SHIELD_BOOSTER = 19198  # capacitorNeed 204, duration 4000 ms

#: The pilot's sheet: everything relevant trained, Caldari Battleship missing.
SHEET = [
    {"typeID": 3326, "level": 5},   # Cruise Missiles
    {"typeID": 20315, "level": 4},  # Warhead Upgrades
    {"typeID": 3319, "level": 5},   # Missile Launcher Operation
    {"typeID": 21071, "level": 4},  # Rapid Launch
    {"typeID": 20212, "level": 3},  # Cruise Missile Specialization
]

_counter = {"value": 0}


def make_pilot(user_client, app_state):
    """A fresh SSO-bound pilot in the test account's database, with SHEET.

    The SSO binding makes it appear in the character strip, which is where the
    abandoned ``defaultLevel`` cleanup runs on every page load.
    """
    import config as pyfaConfig
    import eos.db
    from eos.saveddata.character import Character as es_Character
    from eos.saveddata.ssocharacter import SsoCharacter

    _counter["value"] += 1
    name = "Skill Floor Pilot {}".format(_counter["value"])
    context = app_state.registry.get(user_client.pyfaUser.id).context
    with sessionctx.bind_context(context):
        char = es_Character(name, initSkills=False)
        char.apiUpdateCharSheet(SHEET)
        eos.db.save(char)
        sso = SsoCharacter(91000000 + _counter["value"], name, pyfaConfig.getClientSecret(), "Tranquility")
        sso.accessToken = "test-token"
        sso.refreshToken = "test-refresh-token"
        sso.accessTokenExpires = datetime.datetime.now() + datetime.timedelta(hours=1)
        eos.db.saveddata_session.add(sso)
        eos.db.saveddata_session.flush()
        char.setSsoCharacter(sso, pyfaConfig.getClientSecret())
        eos.db.commit()
        return char.ID


def make_fit(client, ship_id, char_id):
    resp = client.post("/api/fits", json={"shipId": ship_id, "name": "floor"})
    assert resp.status_code == 201, resp.text
    fit_id = resp.json()["id"]
    r = client.post("/api/fits/{}/commands".format(fit_id),
                    json={"command": "changeChar", "args": {"characterId": char_id}})
    assert r.status_code == 200, r.text
    return fit_id


def widow_cruise_fit(client, char_id):
    """A Widow with 5x Cruise Missile Launcher II loaded with Mjolnir Fury Cruise."""
    fit_id = make_fit(client, WIDOW_ID, char_id)
    last = None
    for _ in range(5):
        r = client.post("/api/fits/{}/commands".format(fit_id),
                        json={"command": "addLocalModule", "args": {"itemId": CRUISE_L2}})
        assert r.status_code == 200, r.text
        last = r.json()
    positions = [m["position"] for m in last["racks"]["high"] if m["itemId"] == CRUISE_L2]
    r = client.post("/api/fits/{}/commands".format(fit_id),
                    json={"command": "changeLocalModuleCharges",
                          "args": {"positions": positions, "chargeItemId": MJOLNIR_FURY_CRUISE}})
    assert r.status_code == 200, r.text
    return fit_id, r.json()


def firepower(payload):
    return payload["stats"]["firepower"]


def test_untrained_ship_skill_simulates_at_level_one(user_client, app_state):
    """A Widow fit on a pilot without Caldari Battleship shows the game's numbers.

    The Widow's 10% launcher rate-of-fire bonus per Caldari Battleship level is
    applied at level 1 although the pilot has not trained the skill, exactly as
    the in-game fitting window does: cycle 16540 * MLO V * Rapid Launch IV *
    Spec III * CB I, volley 525 * 1.25 * 1.08 per launcher.
    """
    pilot_id = make_pilot(user_client, app_state)
    fit_id, payload = widow_cruise_fit(user_client, pilot_id)
    fp = firepower(payload)
    n = max(1, fp["weaponCount"])
    volley_per = fp["volley"]["value"]["total"] / n
    dps_per = fp["dps"]["value"]["total"] / n

    # volley 525 * Cruise V (1.25) * Warhead IV (1.08); the floor does not touch damage
    assert volley_per == pytest.approx(525 * 1.25 * 1.08, rel=1e-6)
    # cycle 16540 * MLO V (-2%/lvl) * Rapid Launch IV (-3%/lvl) * Spec III (-2%/lvl)
    #        * Caldari Battleship I (-10%, the game's level-1 floor for a ship skill)
    cycle_ms = 16540 * (1 - 0.02 * 5) * (1 - 0.03 * 4) * (1 - 0.02 * 3) * (1 - 0.10 * 1)
    assert dps_per == pytest.approx(volley_per / (cycle_ms / 1000), rel=1e-4)


def test_untrained_module_skill_is_not_floored(user_client, app_state):
    """The floor covers ship bonuses only: Shield Compensation keeps level 0.

    Shield Compensation (-2% shield-booster capacitor need per level) is a
    module skill; the game's fitting window uses the real level (0 here), so the
    Gist X-Type XL Shield Booster must consume its raw 204 GJ / 4 s = 51 GJ/s.
    Flooring it to level 1 would wrongly show 49.98 GJ/s (the reported 1.1 GJ/s
    capacitor-delta difference against the game).
    """
    pilot_id = make_pilot(user_client, app_state)
    fit_id = make_fit(user_client, WIDOW_ID, pilot_id)
    r = user_client.post("/api/fits/{}/commands".format(fit_id),
                         json={"command": "addLocalModule", "args": {"itemId": GIST_XL_SHIELD_BOOSTER}})
    assert r.status_code == 200, r.text
    detail = r.json()
    pos = next(m["position"] for m in detail["racks"]["med"] if m["itemId"] == GIST_XL_SHIELD_BOOSTER)
    if next(m for m in detail["racks"]["med"] if m["position"] == pos)["state"] != "active":
        # newly fitted modules start online; cycle the state to active
        r = user_client.post("/api/fits/{}/commands".format(fit_id),
                             json={"command": "changeLocalModuleStates",
                                   "args": {"main": {"position": pos}, "positions": [], "click": "cycle"}})
        assert r.status_code == 200, r.text
    else:
        r = user_client.get("/api/fits/{}/stats".format(fit_id))
        assert r.status_code == 200, r.text
    used = r.json()["stats"]["capacitor"]["used"]
    assert used == pytest.approx(204 / 4.0, rel=1e-6)


def test_all_zero_preset_is_unaffected(user_client):
    """The All 0 preset keeps its fixed zero levels: no level-1 floor applies."""
    meta = user_client.get("/api/meta").json()
    all0 = next(c for c in meta["characters"] if c["kind"] == "preset" and "All 0" in c["name"])
    fit_id, payload = widow_cruise_fit(user_client, all0["id"])
    fp = firepower(payload)
    n = max(1, fp["weaponCount"])
    volley_per = fp["volley"]["value"]["total"] / n
    dps_per = fp["dps"]["value"]["total"] / n
    # no damage skills, no ROF skills, no Caldari Battleship: raw 525 / 16540ms
    assert volley_per == pytest.approx(525, rel=1e-6)
    assert dps_per == pytest.approx(525 / (16540 / 1000), rel=1e-4)


def test_cleanup_resets_the_previous_default_level(user_client, app_state):
    """The abandoned level-1 ``defaultLevel`` is cleared and the sheet re-read.

    An earlier release persisted ``defaultLevel=1`` on SSO pilots. The character
    strip resets it to ``None`` and rebuilds the skill collection, so untrained
    skills read 0 again (module skills are no longer floored).
    """
    import eos.db

    pilot_id = make_pilot(user_client, app_state)
    with sessionctx.bind_context(app_state.registry.get(user_client.pyfaUser.id).context):
        char = eos.db.getCharacter(pilot_id)
        char.defaultLevel = 1
        eos.db.commit()

    meta = user_client.get("/api/meta")
    assert meta.status_code == 200, meta.text

    with sessionctx.bind_context(app_state.registry.get(user_client.pyfaUser.id).context):
        char = eos.db.getCharacter(pilot_id)
        assert char.defaultLevel is None
        assert char.getSkill(eos.db.getItem(3338)).level == 0  # Caldari Battleship
        assert char.getSkill(eos.db.getItem(21059)).level == 0  # Shield Compensation
