"""The level-1 simulation floor for untrained skills.

The in-game fitting window applies skill-keyed bonuses at level 1 for skills the
pilot has not trained (a fit can be assembled without the prerequisites, and the
numbers are shown as if each skill were at least level 1). pyfa's engine uses the
real level (0), so a fit leaning on a missing skill reads 90% of what the game
shows -- e.g. a Widow fit on a pilot still training Caldari Battleship shows
90% of the in-game DPS. This web mirrors the game: an SSO pilot's ``defaultLevel``
is set to 1 (``web.services.character.ensure_simulation_floor``), which is exactly
the level the engine gives skills missing from the sheet.

The All 5 / All 0 presets keep their fixed levels (the engine special-cases their
names), and a skill the pilot has trained still reads its real level.
"""

import datetime

import pytest

from eos.db import sessionctx

WIDOW_ID = 22436
CRUISE_L2 = 19739          # Cruise Missile Launcher II
MJOLNIR_FURY_CRUISE = 24535  # base 525 EM damage

#: The pilot's sheet: everything relevant trained, Caldari Battleship missing.
SHEET = [
    {"typeID": 3326, "level": 5},   # Cruise Missiles
    {"typeID": 20315, "level": 4},  # Warhead Upgrades
    {"typeID": 3319, "level": 5},   # Missile Launcher Operation
    {"typeID": 21071, "level": 4},  # Rapid Launch
    {"typeID": 20212, "level": 3},  # Cruise Missile Specialization
]

_counter = {"value": 0}


def make_sso_pilot(user_client, app_state):
    """A fresh SSO-bound pilot whose sheet has only the listed skills (synced style)."""
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
        return char.ID, name


def widow_cruise_fit(client, char_id):
    """A Widow with 5x Cruise Missile Launcher II loaded with Mjolnir Fury Cruise."""
    resp = client.post("/api/fits", json={"shipId": WIDOW_ID, "name": "floor"})
    assert resp.status_code == 201, resp.text
    fit_id = resp.json()["id"]
    r = client.post("/api/fits/{}/commands".format(fit_id),
                    json={"command": "changeChar", "args": {"characterId": char_id}})
    assert r.status_code == 200, r.text
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
    the in-game fitting window does: cycle 16540 * .85 * .92 * .94 * .90 ms,
    volley 525 * 1.25 * 1.08 per launcher.
    """
    import eos.db

    pilot_id, _ = make_sso_pilot(user_client, app_state)
    # The character strip (meta) is where the floor is backfilled on every page load
    meta = user_client.get("/api/meta")
    assert meta.status_code == 200, meta.text

    # the floor has to be persisted for the pilot before the fit is evaluated
    with sessionctx.bind_context(app_state.registry.get(user_client.pyfaUser.id).context):
        char = eos.db.getCharacter(pilot_id)
        assert char.defaultLevel == 1, char.defaultLevel
        assert char.getSkill(eos.db.getItem(3338)).level == 1  # Caldari Battleship
        assert char.getSkill(eos.db.getItem(3338)).level == 1  # Caldari Battleship

    fit_id, payload = widow_cruise_fit(user_client, pilot_id)
    fp = firepower(payload)
    n = max(1, fp["weaponCount"])
    volley_per = fp["volley"]["value"]["total"] / n
    dps_per = fp["dps"]["value"]["total"] / n

    # volley 525 * Cruise V (1.25) * Warhead IV (1.08); the floor does not touch damage
    assert volley_per == pytest.approx(525 * 1.25 * 1.08, rel=1e-6)
    # cycle 16540 * MLO V (-2%/lvl) * Rapid Launch IV (-3%/lvl) * Spec III (-2%/lvl)
    #        * Caldari Battleship I (-10%, the game's level-1 floor for an untrained skill)
    cycle_ms = 16540 * (1 - 0.02 * 5) * (1 - 0.03 * 4) * (1 - 0.02 * 3) * (1 - 0.10 * 1)
    assert dps_per == pytest.approx(volley_per / (cycle_ms / 1000), rel=1e-4)


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


def test_floor_backfills_via_the_character_strip(user_client, app_state):
    """A pilot whose sheet predates the floor gets defaultLevel=1 on the next /api/meta."""
    import eos.db

    pilot_id, _ = make_sso_pilot(user_client, app_state)
    with sessionctx.bind_context(app_state.registry.get(user_client.pyfaUser.id).context):
        assert eos.db.getCharacter(pilot_id).defaultLevel is None

    meta = user_client.get("/api/meta")
    assert meta.status_code == 200, meta.text

    with sessionctx.bind_context(app_state.registry.get(user_client.pyfaUser.id).context):
        assert eos.db.getCharacter(pilot_id).defaultLevel == 1
