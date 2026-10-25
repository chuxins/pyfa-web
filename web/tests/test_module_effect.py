"""The module hover card: what one fitted module does, in the fit's own numbers.

The card is built from the same engine calls the statistics column uses
(``Module.getDps``/``getVolley``/``getCycleParameters`` and the modified attributes),
so these tests pin both the shape the browser reads and the handful of findings about
the game data that the implementation depends on: a nosferatu reports its capacitor
under a different attribute than a neutralizer, a web's ``speedFactor`` is already a
percentage (``-60``), and a local repairer carries no range while a remote one does.
"""

from web.tests.conftest import AUTOCANNON_ID, EMP_S_ID, RIFTER_ID

#: Small Energy Neutralizer II and Small Energy Nosferatu II: both move capacitor,
#: through different attributes (``energyNeutralizerAmount`` vs ``powerTransferAmount``).
NEUT_ID = 13003
NOS_ID = 13001

#: Small Armor Repairer II (local) and Medium Remote Armor Repairer II (remote).
LOCAL_REPAIRER_ID = 1183
REMOTE_REPAIRER_ID = 26912

#: Stasis Webifier II: ``speedFactor`` reads -60, i.e. -60% and not -6000%.
WEB_ID = 527
#: 1MN Afterburner II: ``speedFactor`` reads 168.75, i.e. x1.6875.
AFTERBURNER_ID = 438
#: Warp Scrambler II
SCRAM_ID = 448

#: Damage Control II: a module whose effect this card does not model.
DAMAGE_CONTROL_ID = 2048

#: Heavy F-RX Compact Capacitor Booster and the Cap Booster 3200 it swallows: the
#: charge carries the capacitor (``capacitorBonus``), the module the 12.75 s cycle.
CAP_BOOSTER_ID = 5051
CAP_BOOSTER_CHARGE_ID = 41489

#: Tracking Computer II (+ its Optimal Range Script) and Sensor Booster II (+ its Scan
#: Resolution Script): charge-capable modules whose numbers only exist once a script is
#: in, which is the "active module" case.
TRACKING_COMPUTER_ID = 1978
OPTIMAL_RANGE_SCRIPT_ID = 28999
SENSOR_BOOSTER_ID = 1952
SCAN_RESOLUTION_SCRIPT_ID = 29011

#: A battleship, for the modules a frigate cannot carry
DOMINIX_ID = 644


def make_fit(client, name="Effect Test"):
    response = client.post("/api/fits", json={"shipId": RIFTER_ID, "name": name})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def big_fit(client, name="Effect Big"):
    """A battleship fit, so the bigger charge-holding modules fit."""
    response = client.post("/api/fits", json={"shipId": DOMINIX_ID, "name": name})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def fit_module(client, fit_id, item_id):
    """Fit one module and return the position the endpoint is asked about."""
    response = client.post(
        "/api/fits/{}/commands".format(fit_id),
        json={"command": "addLocalModule", "args": {"itemId": item_id}},
    )
    assert response.status_code == 200, response.text
    for rack in response.json()["racks"].values():
        for row in rack:
            if row["itemId"] == item_id and not row["isEmpty"]:
                return row["position"]
    raise AssertionError("module was not fitted")


def load_charge(client, fit_id, position, charge_id):
    response = client.post(
        "/api/fits/{}/commands".format(fit_id),
        json={"command": "changeLocalModuleCharges", "args": {"positions": [position], "chargeItemId": charge_id}},
    )
    assert response.status_code == 200, response.text


def effect_of(client, fit_id, position):
    response = client.get("/api/fits/{}/modules/{}/effect".format(fit_id, position))
    assert response.status_code == 200, response.text
    return response.json()


def row_of(effect, kind):
    return next((row for row in effect["rows"] if row["kind"] == kind), None)


def test_a_turret_reports_its_damage_split_and_range(user_client):
    """The card's headline for a weapon: DPS, the type split, volley, cycle and range."""
    fit_id = make_fit(user_client)
    position = fit_module(user_client, fit_id, AUTOCANNON_ID)
    load_charge(user_client, fit_id, position, EMP_S_ID)

    effect = effect_of(user_client, fit_id, position)
    assert effect["charge"]["itemId"] == EMP_S_ID
    assert effect["charge"]["name"]

    damage = row_of(effect, "damage")
    assert damage is not None, effect["rows"]
    assert damage["dps"] > 0 and damage["volley"] > 0 and damage["cycle"] > 0
    # The split adds up to the total, and EMP ammunition is EM-heavy
    split = damage["em"] + damage["thermal"] + damage["kinetic"] + damage["explosive"]
    assert split == damage["dps"] or abs(split - damage["dps"]) < 0.05
    assert damage["em"] > damage["kinetic"] + damage["explosive"]

    range_row = row_of(effect, "range")
    assert range_row is not None, effect["rows"]
    assert range_row["optimal"] > 0
    assert range_row["falloff"] > 0


def test_an_unloaded_turret_still_has_a_range(user_client):
    """No ammunition means no damage row, but the turret's own range is still worth showing."""
    fit_id = make_fit(user_client)
    position = fit_module(user_client, fit_id, AUTOCANNON_ID)

    effect = effect_of(user_client, fit_id, position)
    assert effect["charge"] is None
    assert row_of(effect, "damage") is None
    range_row = row_of(effect, "range")
    assert range_row is not None, effect["rows"]
    assert range_row["optimal"] > 0


def test_an_offline_turret_promises_no_damage(user_client):
    """A module that is switched off does nothing, and the card must not claim otherwise."""
    fit_id = make_fit(user_client)
    position = fit_module(user_client, fit_id, AUTOCANNON_ID)
    load_charge(user_client, fit_id, position, EMP_S_ID)
    assert row_of(effect_of(user_client, fit_id, position), "damage")["dps"] > 0

    response = user_client.post(
        "/api/fits/{}/commands".format(fit_id),
        json={
            "command": "changeLocalModuleStates",
            "args": {"main": {"kind": "module", "position": position}, "click": "ctrl"},
        },
    )
    assert response.status_code == 200, response.text

    effect = effect_of(user_client, fit_id, position)
    assert effect["state"] == "offline"
    assert row_of(effect, "damage") is None


def test_a_neutralizer_reports_what_it_drains(user_client):
    fit_id = make_fit(user_client)
    position = fit_module(user_client, fit_id, NEUT_ID)

    drain = row_of(effect_of(user_client, fit_id, position), "capDrain")
    assert drain is not None
    assert drain["nosferatu"] is False
    assert drain["amount"] > 0
    assert drain["perSecond"] > 0
    assert drain["optimal"] > 0


def test_a_nosferatu_is_marked_as_such(user_client):
    """A nos reads a different attribute and moves the capacitor instead of burning it."""
    fit_id = make_fit(user_client)
    position = fit_module(user_client, fit_id, NOS_ID)

    drain = row_of(effect_of(user_client, fit_id, position), "capDrain")
    assert drain is not None
    assert drain["nosferatu"] is True
    assert drain["amount"] > 0


def test_a_local_repairer_repairs_without_a_range(user_client):
    fit_id = make_fit(user_client)
    position = fit_module(user_client, fit_id, LOCAL_REPAIRER_ID)

    repair = row_of(effect_of(user_client, fit_id, position), "repair")
    assert repair is not None
    assert repair["target"] == "armor"
    assert repair["remote"] is False
    assert repair["amount"] > 0 and repair["perSecond"] > 0
    # no range at all, rather than the 1 m default the attribute carries
    assert "optimal" not in repair and "falloff" not in repair


def test_a_remote_repairer_is_remote_and_ranged(user_client):
    fit_id = make_fit(user_client)
    position = fit_module(user_client, fit_id, REMOTE_REPAIRER_ID)

    repair = row_of(effect_of(user_client, fit_id, position), "repair")
    assert repair is not None
    assert repair["remote"] is True
    assert repair["optimal"] > 1000


def test_speed_factors_are_percentages_not_multipliers(user_client):
    """A web reads -60 (percent), an afterburner 168.75 (x1.6875), not either x100."""
    web_fit = make_fit(user_client, "web")
    web = row_of(effect_of(user_client, web_fit, fit_module(user_client, web_fit, WEB_ID)), "web")
    assert web is not None
    assert -100 < web["speedFactor"] < 0, web
    assert web["optimal"] > 0

    prop_fit = make_fit(user_client, "prop")
    propulsion = row_of(
        effect_of(user_client, prop_fit, fit_module(user_client, prop_fit, AFTERBURNER_ID)), "propulsion")
    assert propulsion is not None
    assert 100 < propulsion["speedFactor"] < 1000, propulsion


def test_a_warp_scrambler_reports_its_strength(user_client):
    fit_id = make_fit(user_client)
    position = fit_module(user_client, fit_id, SCRAM_ID)

    scrambler = row_of(effect_of(user_client, fit_id, position), "warpScrambler")
    assert scrambler is not None
    assert scrambler["strength"] >= 1
    assert scrambler["optimal"] > 0


def test_a_module_without_a_modelled_effect_says_nothing(user_client):
    """A damage control is not a weapon, a neutralizer or a repairer: no invented rows."""
    fit_id = make_fit(user_client)
    position = fit_module(user_client, fit_id, DAMAGE_CONTROL_ID)

    effect = effect_of(user_client, fit_id, position)
    assert effect["rows"] == []
    assert effect["name"]


def test_an_empty_slot_is_not_found(user_client):
    fit_id = make_fit(user_client)
    # position 0 of a fresh Rifter fit holds nothing
    response = user_client.get("/api/fits/{}/modules/0/effect".format(fit_id))
    assert response.status_code == 404, response.text


def test_an_unknown_position_is_not_found(user_client):
    fit_id = make_fit(user_client)
    response = user_client.get("/api/fits/{}/modules/9999/effect".format(fit_id))
    assert response.status_code == 404, response.text


def test_the_card_is_per_fit(user_client, second_user_client):
    """The numbers come from the fit, so another account never sees this fit's card."""
    fit_id = make_fit(user_client)
    position = fit_module(user_client, fit_id, AUTOCANNON_ID)

    assert effect_of(user_client, fit_id, position)["itemId"] == AUTOCANNON_ID
    assert second_user_client.get("/api/fits/{}/modules/{}/effect".format(fit_id, position)).status_code == 404


def test_a_charge_capable_module_without_a_charge_is_just_active(user_client):
    """A cap booster holding nothing restores nothing: the card calls it an active module."""
    fit_id = big_fit(user_client)
    position = fit_module(user_client, fit_id, CAP_BOOSTER_ID)

    effect = effect_of(user_client, fit_id, position)
    assert effect["charge"] is None
    assert effect["rows"] == [{"kind": "active"}]


def test_a_loaded_cap_booster_reports_capacitor_and_cycle(user_client):
    """Heavy F-RX + Cap Booster 3200: 3200 GJ every 12.75 s."""
    fit_id = big_fit(user_client)
    position = fit_module(user_client, fit_id, CAP_BOOSTER_ID)
    load_charge(user_client, fit_id, position, CAP_BOOSTER_CHARGE_ID)

    effect = effect_of(user_client, fit_id, position)
    assert effect["charge"]["itemId"] == CAP_BOOSTER_CHARGE_ID

    boost = row_of(effect, "capBoost")
    assert boost is not None, effect["rows"]
    assert boost["amount"] == 3200
    assert boost["cycle"] == 12.75
    assert boost["perSecond"] > 0
    # the "active" marker is gone now that the module has real numbers
    assert row_of(effect, "active") is None


def test_a_script_leaves_the_module_giving_what_the_script_says(user_client):
    """Tracking Computer II + Optimal Range Script: the tracking goes away and the
    range bonuses take its place."""
    fit_id = big_fit(user_client)
    position = fit_module(user_client, fit_id, TRACKING_COMPUTER_ID)
    assert effect_of(user_client, fit_id, position)["rows"] == [{"kind": "active"}]

    load_charge(user_client, fit_id, position, OPTIMAL_RANGE_SCRIPT_ID)
    effect = effect_of(user_client, fit_id, position)
    bonuses = {row["label"]: row["value"] for row in effect["rows"] if row["kind"] == "bonus"}
    assert bonuses.get("Optimal range") == 15
    assert bonuses.get("Falloff range") == 30
    assert "Tracking speed" not in bonuses


def test_a_scan_resolution_script_doubles_the_sensor_boosters_scan_bonus(user_client):
    fit_id = big_fit(user_client)
    position = fit_module(user_client, fit_id, SENSOR_BOOSTER_ID)
    assert effect_of(user_client, fit_id, position)["rows"] == [{"kind": "active"}]

    load_charge(user_client, fit_id, position, SCAN_RESOLUTION_SCRIPT_ID)
    effect = effect_of(user_client, fit_id, position)
    bonuses = {row["label"]: row["value"] for row in effect["rows"] if row["kind"] == "bonus"}
    assert bonuses.get("Scan resolution") == 60


def test_a_module_that_takes_no_charge_never_says_active(user_client):
    """The green "active module" line is for charge-capable modules only."""
    fit_id = make_fit(user_client)
    position = fit_module(user_client, fit_id, DAMAGE_CONTROL_ID)

    effect = effect_of(user_client, fit_id, position)
    assert effect["rows"] == []
    assert row_of(effect, "active") is None
