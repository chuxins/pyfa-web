"""Drone launching: one drone at a time, and only as many as the ship can fly.

Both limits are the game's own and are checked server-side, so no client can talk its
way past them: the hull's drone **bandwidth** (`droneBandwidth`, Mbit/s, spent per
drone by `droneBandwidthUsed`) and how many drones it may keep in space at once
(`maxActiveDrones`). Putting drones away is never refused.
"""

import pytest

from web.tests.conftest import RIFTER_ID

#: Hobgoblin II: 5 m3, 5 Mbit/s bandwidth
HOBGOBLIN = 2456
#: Warrior II: the second stack the tests use
WARRIOR = 2488
#: Ogre II: a heavy drone, 25 m3 and 25 Mbit/s each. The Vexor hull below has 75 Mbit/s
#: and a 125 m3 bay, so three of them fly and the fourth cannot -- while three is still
#: below the five-drone control limit, which is what isolates the bandwidth check.
OGRE = 2446
VEXOR = 626


def make_fit(client, name="Drone Test"):
    response = client.post("/api/fits", json={"shipId": RIFTER_ID, "name": name})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def add_drones(client, fit_id, item_id, amount):
    response = client.post(
        "/api/fits/{}/commands".format(fit_id),
        json={"command": "addLocalDrone", "args": {"itemId": item_id, "amount": amount}})
    assert response.status_code == 200, response.text
    return response.json()


def drone_at(fit, position):
    return next(row for row in fit["drones"] if row["position"] == position)


def active_of(fit_id, client):
    detail = client.get("/api/fits/{}".format(fit_id)).json()
    return sum(row["amountActive"] for row in detail["drones"])


def set_active(client, fit_id, position, amount):
    return client.post(
        "/api/fits/{}/commands".format(fit_id),
        json={"command": "toggleLocalDroneStates",
              "args": {"main": {"kind": "drone", "position": position}, "amount": amount}})


def test_a_stack_can_be_launched_one_drone_at_a_time(user_client):
    fit_id = make_fit(user_client)
    add_drones(user_client, fit_id, HOBGOBLIN, 3)

    for wanted in (1, 2, 3):
        response = set_active(user_client, fit_id, 0, wanted)
        assert response.status_code == 200, response.text
        row = drone_at(response.json(), 0)
        assert row["amountActive"] == wanted
        assert row["amount"] == 3

    # and back down, one at a time
    for wanted in (2, 1, 0):
        response = set_active(user_client, fit_id, 0, wanted)
        assert response.status_code == 200, response.text
        assert drone_at(response.json(), 0)["amountActive"] == wanted


def test_launching_one_more_drone_is_undone_like_any_edit(user_client):
    fit_id = make_fit(user_client)
    add_drones(user_client, fit_id, HOBGOBLIN, 3)
    set_active(user_client, fit_id, 0, 2)

    undone = user_client.post("/api/fits/{}/undo".format(fit_id))
    assert undone.status_code == 200, undone.text
    assert drone_at(undone.json(), 0)["amountActive"] == 0

    redone = user_client.post("/api/fits/{}/redo".format(fit_id))
    assert redone.status_code == 200, redone.text
    assert drone_at(redone.json(), 0)["amountActive"] == 2


def vexor_fit(client, name="Bandwidth Test"):
    response = client.post("/api/fits", json={"shipId": VEXOR, "name": name})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def test_bandwidth_stops_a_stack_at_what_the_hull_can_fly(user_client):
    """A Vexor has 75 Mbit/s: three Ogre II (25 each) fly, the fourth cannot."""
    fit_id = vexor_fit(user_client)
    add_drones(user_client, fit_id, OGRE, 4)
    assert set_active(user_client, fit_id, 0, 3).status_code == 200

    resources = user_client.get("/api/fits/{}".format(fit_id)).json()["stats"]["resources"]["drones"]
    assert resources["bandwidthUsed"] == 75
    assert resources["bandwidthTotal"] == 75
    # four is still under the five-drone control limit, so only bandwidth can refuse it
    assert resources["maxActive"] >= 4

    refused = set_active(user_client, fit_id, 0, 4)
    assert refused.status_code == 409, refused.text
    detail_body = refused.json()["detail"]
    assert detail_body["code"] == "droneBandwidthExceeded"
    assert detail_body["params"]["needed"] == 25
    assert detail_body["params"]["available"] == 0
    # nothing was launched
    assert active_of(fit_id, user_client) == 3


def test_bandwidth_is_not_spent_by_drones_sitting_in_the_bay(user_client):
    fit_id = vexor_fit(user_client)
    add_drones(user_client, fit_id, OGRE, 3)
    assert active_of(fit_id, user_client) == 0
    # the whole stack still fits the hull's bandwidth when launched at once
    assert set_active(user_client, fit_id, 0, 3).status_code == 200


def test_the_drone_control_limit_is_enforced_too(user_client):
    """Five light drones are also the most a frigate may keep in space."""
    fit_id = make_fit(user_client)
    add_drones(user_client, fit_id, HOBGOBLIN, 5)
    add_drones(user_client, fit_id, WARRIOR, 3)
    detail = user_client.get("/api/fits/{}".format(fit_id)).json()
    warrior_position = next(row["position"] for row in detail["drones"] if row["itemId"] == WARRIOR)

    # free the bandwidth by not launching the Hobgoblins, but the count still binds
    assert set_active(user_client, fit_id, 0, 4).status_code == 200
    over = set_active(user_client, fit_id, warrior_position, 2)
    assert over.status_code == 409, over.text
    assert over.json()["detail"]["code"] == "droneControlLimitExceeded"


def test_putting_drones_away_is_never_refused(user_client):
    fit_id = make_fit(user_client)
    add_drones(user_client, fit_id, HOBGOBLIN, 5)
    assert set_active(user_client, fit_id, 0, 5).status_code == 200
    assert set_active(user_client, fit_id, 0, 0).status_code == 200
    assert active_of(fit_id, user_client) == 0


def test_an_active_amount_beyond_the_stack_is_a_client_error(user_client):
    fit_id = make_fit(user_client)
    add_drones(user_client, fit_id, HOBGOBLIN, 2)
    response = set_active(user_client, fit_id, 0, 3)
    assert response.status_code == 400, response.text
    assert "between 0 and 2" in response.json()["detail"]


def test_a_non_integer_amount_is_a_client_error(user_client):
    fit_id = make_fit(user_client)
    add_drones(user_client, fit_id, HOBGOBLIN, 2)
    response = set_active(user_client, fit_id, 0, 1.5)
    assert response.status_code == 400, response.text


def test_the_plain_toggle_still_launches_and_recalls_a_whole_stack(user_client):
    """The bay's old whole-stack behaviour stays available (no ``amount`` in the payload)."""
    fit_id = make_fit(user_client)
    add_drones(user_client, fit_id, HOBGOBLIN, 3)

    launched = user_client.post(
        "/api/fits/{}/commands".format(fit_id),
        json={"command": "toggleLocalDroneStates", "args": {"main": {"kind": "drone", "position": 0}}})
    assert launched.status_code == 200, launched.text
    assert drone_at(launched.json(), 0)["amountActive"] == 3

    recalled = user_client.post(
        "/api/fits/{}/commands".format(fit_id),
        json={"command": "toggleLocalDroneStates", "args": {"main": {"kind": "drone", "position": 0}}})
    assert recalled.status_code == 200, recalled.text
    assert drone_at(recalled.json(), 0)["amountActive"] == 0


def test_drone_rows_say_what_one_drone_costs_in_bandwidth(user_client):
    fit_id = make_fit(user_client)
    add_drones(user_client, fit_id, HOBGOBLIN, 2)
    row = drone_at(user_client.get("/api/fits/{}".format(fit_id)).json(), 0)
    assert row["bandwidthUsed"] == pytest.approx(5)
