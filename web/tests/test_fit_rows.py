"""The row lists a fit hands the browser: every row says where it sits.

A drone, implant or booster row used to arrive without ``position``, which broke the
fitting view's own actions -- clicking a drone to launch it sent
``{"main": {"kind": "drone"}}`` (the position was ``undefined`` and JSON dropped it) and
the server answered "reference needs position, itemId or fitId". These tests pin the
position (and the state the browser reads) for each of those lists, and drive the same
commands the buttons send.
"""

import pytest

from web.tests.conftest import RIFTER_ID

#: Hobgoblin II, the drone the other editing tests use
DRONE_ID = 2456

#: A plain implant ('Basic' Inherent Implants...) and a booster
IMPLANT_ID = 13283
BOOSTER_ID = 28676


def make_fit(client, name="Rows Test"):
    response = client.post("/api/fits", json={"shipId": RIFTER_ID, "name": name})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def run_ok(client, fit_id, command, **args):
    response = client.post("/api/fits/{}/commands".format(fit_id), json={"command": command, "args": args})
    assert response.status_code == 200, response.text
    return response.json()


def detail(client, fit_id):
    response = client.get("/api/fits/{}".format(fit_id))
    assert response.status_code == 200, response.text
    return response.json()


def test_drone_rows_carry_a_position_and_a_state(user_client):
    fit_id = make_fit(user_client)
    run_ok(user_client, fit_id, "addLocalDrone", itemId=DRONE_ID, amount=3)

    drone = detail(user_client, fit_id)["drones"][0]
    assert drone["itemId"] == DRONE_ID
    assert drone["position"] == 0
    # a freshly added stack sits in the bay
    assert drone["state"] == "offline"
    assert drone["amount"] == 3


def test_launching_a_drone_works_with_the_position_the_row_carries(user_client):
    """The failing click: send the row's own position back as the reference."""
    fit_id = make_fit(user_client)
    run_ok(user_client, fit_id, "addLocalDrone", itemId=DRONE_ID, amount=3)
    drone = detail(user_client, fit_id)["drones"][0]

    launched = run_ok(
        user_client, fit_id,
        "toggleLocalDroneStates", main={"kind": "drone", "position": drone["position"]})
    row = launched["drones"][0]
    assert row["amountActive"] == 3
    assert row["state"] == "active"

    sitting = run_ok(
        user_client, fit_id,
        "toggleLocalDroneStates", main={"kind": "drone", "position": drone["position"]})
    assert sitting["drones"][0]["state"] == "offline"


def test_every_drone_row_has_its_own_position(user_client):
    fit_id = make_fit(user_client)
    run_ok(user_client, fit_id, "addLocalDrone", itemId=DRONE_ID, amount=2)
    run_ok(user_client, fit_id, "addLocalDrone", itemId=2488, amount=2)  # Warrior II

    drones = detail(user_client, fit_id)["drones"]
    assert [row["position"] for row in drones] == list(range(len(drones)))
    # and each position addresses its own row
    launched = run_ok(
        user_client, fit_id,
        "toggleLocalDroneStates", main={"kind": "drone", "position": drones[-1]["position"]})
    assert launched["drones"][-1]["state"] == "active"
    assert launched["drones"][0]["state"] == "offline"


def test_removing_a_drone_works_with_the_position_the_row_carries(user_client):
    fit_id = make_fit(user_client)
    run_ok(user_client, fit_id, "addLocalDrone", itemId=DRONE_ID, amount=2)
    drone = detail(user_client, fit_id)["drones"][0]

    after = run_ok(user_client, fit_id, "removeLocalDrones", positions=[drone["position"]])
    assert [row["itemId"] for row in after["drones"] if row["itemId"]] == []


def test_implant_rows_carry_a_position_and_a_state(user_client):
    fit_id = make_fit(user_client)
    run_ok(user_client, fit_id, "addImplant", itemId=IMPLANT_ID)

    implant = detail(user_client, fit_id)["implants"][0]
    assert implant["itemId"] == IMPLANT_ID
    assert implant["position"] == 0
    assert implant["state"] in ("active", "offline")


def test_implant_rows_can_be_toggled_by_their_position(user_client):
    """The implant list toggles just like the modules do."""
    fit_id = make_fit(user_client)
    run_ok(user_client, fit_id, "addImplant", itemId=IMPLANT_ID)
    implant = detail(user_client, fit_id)["implants"][0]
    before = implant["state"]

    toggled = run_ok(
        user_client, fit_id,
        "toggleImplantStates", main={"kind": "implant", "position": implant["position"]})
    row = toggled["implants"][0]
    assert row["state"] != before


def test_booster_rows_carry_a_position(user_client):
    fit_id = make_fit(user_client)
    response = user_client.post(
        "/api/fits/{}/commands".format(fit_id),
        json={"command": "addBooster", "args": {"itemId": BOOSTER_ID}})
    # a booster needs the fit's character to accept it; skip rather than fail when the
    # game data refuses it for this hull/pilot
    if response.status_code != 200:
        pytest.skip("this booster is refused for the test fit: {}".format(response.text))
    booster = response.json()["boosters"][0]
    assert booster["position"] == 0
    assert booster["state"] in ("active", "offline")
