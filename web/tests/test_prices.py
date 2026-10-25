"""Fitting valuation tests.

No test here talks to a market source: the fetch routine is monkeypatched to
write prices straight into the user's ``prices`` rows, which is exactly what a
successful fuzzwork round does in real life.
"""

import pytest

from eos.saveddata.price import PriceStatus

from web.tests.conftest import AUTOCANNON_ID, EMP_S_ID, RIFTER_ID


def make_fit(client, name="Price Test"):
    response = client.post("/api/fits", json={"shipId": RIFTER_ID, "name": name})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def seed_prices(prices):
    """``prices`` maps type id -> ISK, applied through the ORM the fetch uses."""

    def fake_fetch(price_objects, fetch_timeout, validity_override):
        # The real method receives the list of Price rows to update
        for obj in price_objects:
            value = prices.get(obj.typeID)
            if value is not None:
                obj.update(PriceStatus.fetchSuccess, value)

    return fake_fetch


def test_price_for_empty_fit_is_all_no_data(user_client, monkeypatch):
    import service.price as price_service

    fit_id = make_fit(user_client)
    monkeypatch.setattr(price_service.Price, "fetchPrices", seed_prices({}))

    payload = user_client.get(f"/api/fits/{fit_id}/price").json()
    assert payload["currency"] == "ISK"
    assert payload["totals"]["total"] == 0
    # The hull alone is present, never fetched
    assert {(line["itemId"], line["qty"]) for line in payload["lines"]} == {(RIFTER_ID, 1)}
    assert payload["missingCount"] == 1
    assert payload["updating"] is True
    assert payload["source"] and payload["region"]


def test_refresh_aggregates_ship_module_and_charges(user_client, monkeypatch):
    import service.price as price_service

    fit_id = make_fit(user_client)
    added = user_client.post(
        f"/api/fits/{fit_id}/commands",
        json={"command": "addLocalModule", "args": {"itemId": AUTOCANNON_ID}},
    )
    assert added.status_code == 200, added.text
    position = next(
        module["position"]
        for module in added.json()["racks"]["high"]
        if module["itemId"] == AUTOCANNON_ID
    )
    loaded = user_client.post(
        f"/api/fits/{fit_id}/commands",
        json={
            "command": "changeLocalModuleCharges",
            "args": {"positions": [position], "chargeItemId": EMP_S_ID},
        },
    )
    assert loaded.status_code == 200, loaded.text

    monkeypatch.setattr(
        price_service.Price,
        "fetchPrices",
        seed_prices({RIFTER_ID: 100_000.0, AUTOCANNON_ID: 50_000.0, EMP_S_ID: 10.0}),
    )

    payload = user_client.post(f"/api/fits/{fit_id}/price/refresh").json()
    totals = payload["totals"]

    by_id = {line["itemId"]: line for line in payload["lines"]}
    assert totals["ship"] == 100_000.0
    assert by_id[RIFTER_ID]["total"] == 100_000.0
    assert by_id[AUTOCANNON_ID]["total"] == 50_000.0
    charge_line = by_id[EMP_S_ID]
    assert charge_line["qty"] > 0
    assert charge_line["unitPrice"] == 10.0
    assert charge_line["total"] == pytest.approx(10.0 * charge_line["qty"])
    assert totals["fittings"] == pytest.approx(50_000.0 + 10.0 * charge_line["qty"])
    assert totals["total"] == pytest.approx(
        100_000.0 + 50_000.0 + 10.0 * charge_line["qty"]
    )
    assert payload["missingCount"] == 0
    assert payload["updating"] is False
    assert payload["updated"]

    # The rows were committed to the user database: a plain GET stays offline
    # and still reports the same valuation.
    cached = user_client.get(f"/api/fits/{fit_id}/price").json()
    assert cached["totals"]["total"] == payload["totals"]["total"]
    assert cached["lines"][0]["unitPrice"] is not None


def test_price_is_per_user(user_client, second_user_client, monkeypatch):
    """A price fetched for one pilot never shows up in another pilot's database."""
    import service.price as price_service

    fit_one = make_fit(user_client, "One")
    monkeypatch.setattr(
        price_service.Price, "fetchPrices", seed_prices({RIFTER_ID: 100_000.0})
    )
    refreshed = user_client.post(f"/api/fits/{fit_one}/price/refresh")
    assert refreshed.status_code == 200, refreshed.text

    fit_two = make_fit(second_user_client, "Two")
    payload = second_user_client.get(f"/api/fits/{fit_two}/price").json()
    hull = next(line for line in payload["lines"] if line["itemId"] == RIFTER_ID)
    assert hull["unitPrice"] is None
    assert payload["totals"]["total"] == 0


def test_unknown_fit_is_404(user_client):
    assert user_client.get("/api/fits/999999/price").status_code == 404
    assert user_client.post("/api/fits/999999/price/refresh").status_code == 404
