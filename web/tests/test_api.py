"""Web API tests.

The point of these tests is not coverage for its own sake: they pin down the two
things that could quietly break a multi-user deployment (one user seeing another
user's fits, and the engine being shared across users) and the numbers the fitting
view shows.
"""

import pytest

from web.tests.conftest import AUTOCANNON_ID, EMP_S_ID, RIFTER_ID


def test_meta_reports_engine_and_gamedata(client):
    payload = client.get("/api/meta").json()
    assert payload["pyfaVersion"]
    assert payload["gamedata"]["build"]
    assert payload["language"] == "en_US"


def test_anonymous_requests_can_read_game_data(client):
    """Static game data needs no login, so the ship browser can load before sign-in."""
    response = client.get("/api/ships/tree")
    assert response.status_code == 200
    categories = {entry["name"] for entry in response.json()["categories"]}
    assert "Ship" in categories


#: Some of the ships in pyfa's limited-edition group, and the race the game files each
#: hull under (``invtypes.raceID``), which the browser draws as the level below a group.
LIMITED_ISSUE_RACES = {
    "Apocalypse Imperial Issue": "Amarr",
    "Raven State Issue": "Caldari",
    "Megathron Federate Issue": "Gallente",
    "Zephyr": "Gallente",
    "Tempest Tribal Issue": "Minmatar",
    "Primae": "ORE",
    "Hydra": "Triglavian",
    # No empire's race: the internal row the pirate-faction hulls share
    "Guardian-Vexor": "Other",
}

#: How many ships that group holds in this checkout's eve.db (build 3532181).
LIMITED_ISSUE_SHIP_COUNT = 50

#: pyfa's own id for that group (``Market.les_grp``); no ``invgroups`` row carries it.
LIMITED_ISSUE_GROUP_ID = -1


def ship_groups(client, key):
    """The groups the browser shows under one category, by its English key."""
    tree = client.get("/api/ships/tree").json()
    return next(entry for entry in tree["categories"] if entry["key"] == key)["groups"]


def limited_issue_group(client):
    """The one group pyfa files every limited-edition hull in, or None if pyfa listed none.

    That group lives in memory alone (see :func:`web.api.ships.group_ships`), so a process
    in which a second Market was built can hand the tree a copy without its ships. The tree
    answers for the ships either way and lists one row per group id, so a test that needs
    the group says so plainly instead of failing obscurely when upstream lost it.
    """
    return next(
        (group for group in ship_groups(client, "Ship") if group["id"] == LIMITED_ISSUE_GROUP_ID),
        None,
    )


def test_tree_ships_carry_the_race_row_the_client_draws(client):
    """The level below a group: 舰船 -> 巡洋舰 -> 艾玛 -> 预言级.

    Every ship in the tree carries the race it is filed under. The group that needs it
    most is the one pyfa keeps every limited-edition hull in: one group of ships of many
    races, and the one group whose name pyfa itself writes rather than eve.db.
    """
    group = limited_issue_group(client)
    if group is None:
        pytest.skip("pyfa did not list its in-memory limited-edition group in this process")
    assert group["name"] == "Limited Issue Ships"  # an English server names it in English

    raceOf = {}
    for ship in group["ships"]:
        assert ship["name"] not in raceOf, "{} is under two races".format(ship["name"])
        raceOf[ship["name"]] = ship["race"]["name"]
        assert ship["race"]["order"] > 0  # a number, so the rows order the same everywhere
    assert len(raceOf) == LIMITED_ISSUE_SHIP_COUNT
    for name, race in LIMITED_ISSUE_RACES.items():
        assert raceOf[name] == race
    # A hull the game files no race at all gets the row they share, not a guess
    assert raceOf["Cobra"] == "Other"

    # Empires first, then the factions that build hulls of their own, then the rest
    orders = {ship["race"]["name"]: ship["race"]["order"] for ship in group["ships"]}
    assert (
        orders["Amarr"]
        < orders["Caldari"]
        < orders["Gallente"]
        < orders["Minmatar"]
        < orders["ORE"]
        < orders["Triglavian"]
        < orders["Other"]
    )

    # Races are a level the client draws, not rows the server invents: the group stays one
    # row, and the client keys its rows by group id, so the ids still have to be unique
    ids = [entry["id"] for entry in ship_groups(client, "Ship")]
    assert ids.count(LIMITED_ISSUE_GROUP_ID) == 1
    assert len(set(ids)) == len(ids)


def test_the_limited_issue_group_survives_an_empty_market_list(client, monkeypatch):
    """The hulls pyfa holds only in memory still reach the browser.

    ``Market.getShipList`` reads the list pyfa attaches while it builds its singleton, and
    for this group that list is the group's only storage: unlike every other group it has
    no ``invgroups`` row behind it. If it comes up empty -- a process that raced the
    singleton's construction -- the tree still has to show the group.
    """
    from service.market import Market

    real = Market.getShipList

    def empty_for_limited_issue(market, group_id):
        return [] if group_id == LIMITED_ISSUE_GROUP_ID else real(market, group_id)

    monkeypatch.setattr(Market, "getShipList", empty_for_limited_issue)

    group = limited_issue_group(client)
    if group is None:
        pytest.skip("pyfa did not list its in-memory limited-edition group in this process")
    assert len(group["ships"]) == LIMITED_ISSUE_SHIP_COUNT
    assert group["ships"][0]["race"]["name"]


def test_the_group_is_found_by_id_when_the_tree_holds_another_copy(monkeypatch):
    """Two Markets mean two copies of that group; the one without ships still lists them.

    ``Market.__init__`` files the synthetic group into the Ship category of the gamedata
    models, so a process that built a second Market (the ship browser's worker thread stops
    waiting after five seconds -- see ``service/market.py``) has two copies of it, and the
    tree can be handed the copy that holds no list of its own. The fallback matches by
    group id rather than by which object it is holding.
    """
    from service.market import Market

    from web.api.ships import group_ships

    market = Market.getInstance()
    group = market.les_grp

    class OtherCopy:
        """What the other Market's copy looks like: same id, and no list of its own."""

        ID = group.ID

    monkeypatch.setattr(Market, "getShipList", lambda self, group_id: [])

    ships = group_ships(market, OtherCopy())
    assert len(ships) == LIMITED_ISSUE_SHIP_COUNT
    assert {ship.ID for ship in ships} == {ship.ID for ship in group_ships(market, group)}


def test_a_class_of_several_races_splits_into_them(client):
    """A class that fields ships of more than one race is what the level is for.

    The Oracle is the Amarr attack battlecruiser, so it is where the two meet: a ship is
    filed under its race, and that race is the row the browser draws it beneath.
    """
    battlecruisers = next(
        group for group in ship_groups(client, "Ship") if group["name"] == "Attack Battlecruiser"
    )
    byRace = {}
    for ship in battlecruisers["ships"]:
        byRace.setdefault(ship["race"]["name"], []).append(ship["name"])

    assert "Oracle" in byRace["Amarr"]
    assert set(byRace) > {"Amarr"}, "this class fields one race only, so it needs no level"

    # Every ship lands on exactly one race row, so the client's rows add up to the group
    assert sum(len(ships) for ships in byRace.values()) == len(battlecruisers["ships"])


def test_race_labels_follow_the_gamedata_language():
    """A race reads as the game data knows it, and in English outside its languages."""
    import eos.config
    from web.api.ships import race_label

    configured = eos.config.lang
    try:
        eos.config.lang = "_zh"
        assert race_label(1) == "加达里"
        assert race_label(8) == "盖伦特"
        assert race_label(135) == "三神裔"
        # A race this gamedata has no name for, and a type that carries none
        assert race_label(32) == "其他"
        assert race_label(None) == "其他"

        eos.config.lang = ""
        assert race_label(1) == "Caldari"
        assert race_label(32) == "Other"

        eos.config.lang = "_ru"  # no labels of its own, so English
        assert race_label(1) == "Caldari"
    finally:
        eos.config.lang = configured


def test_a_race_row_carries_the_game_id_and_the_order_it_sits_in():
    """What the client draws: the game's own id, and where the row goes among its races."""
    from web.api.ships import race_row

    assert race_row(4)["id"] == 4
    assert race_row(None)["id"] is None

    empires = [race_row(raceID)["order"] for raceID in (4, 1, 8, 2)]
    assert empires == sorted(empires)
    # A race this gamedata has no name for goes after the factions that do have one
    assert max(empires) < race_row(128)["order"] < race_row(32)["order"]
    assert race_row(32)["order"] == race_row(None)["order"]


def test_anonymous_requests_get_the_full_fitting_workflow(client):
    """A guest is the whole application minus the two EVE-character actions.

    Guests build, edit and copy fits out of the shared guest database (which is why
    this test removes what it created); only importing from and exporting to an EVE
    character still asks for a login.
    """
    created = client.post("/api/fits", json={"shipId": RIFTER_ID, "name": "Guest Rifter"})
    assert created.status_code == 201, created.text
    fit_id = created.json()["id"]

    # Edit it like the browser does: fit a module, then rename
    edited = client.post("/api/fits/{}/commands".format(fit_id), json={
        "command": "addLocalModule", "args": {"itemId": AUTOCANNON_ID},
    })
    assert edited.status_code == 200, edited.text
    renamed = client.patch("/api/fits/{}".format(fit_id), json={"name": "Guest Renamed"})
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Guest Renamed"

    # Copy it out as EFT text -- the export that was meant to work signed out
    exported = client.get("/api/fits/{}/export-txt".format(fit_id))
    assert exported.status_code == 200
    assert exported.text.splitlines()[0] == "[Rifter, Guest Renamed]"

    # The two actions that act as the pilot still need the pilot's login
    assert client.post("/api/esi/fittings/import").status_code == 401
    assert client.post("/api/esi/fittings/export", json={"fitId": fit_id}).status_code == 401

    # Leave the shared guest database as it was found
    assert client.delete("/api/fits/{}".format(fit_id)).status_code == 204


def test_ship_detail(client):
    payload = client.get("/api/ships/{}".format(RIFTER_ID)).json()
    assert payload["ship"]["name"] == "Rifter"
    assert payload["slots"]["high"] == 3
    assert payload["slots"]["low"] == 4
    assert payload["slots"]["rig"] == 3


def test_item_search_finds_module_and_ship(client):
    results = client.get("/api/items/search", params={"q": "200mm AutoCannon II"}).json()["results"]
    assert [item["id"] for item in results] == [AUTOCANNON_ID]

    ships = client.get("/api/items/search", params={"q": "Rifter", "scope": "everything"}).json()["results"]
    assert RIFTER_ID in [item["id"] for item in ships]


def test_slot_search_can_be_filtered_by_size(client):
    """The picker's size chips narrow a rack to one size class.

    Weapons carry their size on ``chargeSize`` -- a 200mm AutoCannon is a small turret, a
    250mm Railgun a medium one -- so browsing a rack with a size keeps only that class.
    """
    small = client.get("/api/items/search", params={"scope": "high", "size": 1, "limit": 1000}).json()["results"]
    medium = client.get("/api/items/search", params={"scope": "high", "size": 2, "limit": 1000}).json()["results"]
    small_ids = {item["id"] for item in small}
    medium_ids = {item["id"] for item in medium}

    assert small_ids and medium_ids
    assert AUTOCANNON_ID in small_ids
    assert AUTOCANNON_ID not in medium_ids
    assert 3082 in medium_ids  # 250mm Railgun II: a medium turret
    assert 3082 not in small_ids

    # Without a size the same rack still holds every class
    all_high = {item["id"] for item in client.get("/api/items/search", params={"scope": "high", "limit": 1000}).json()["results"]}
    assert AUTOCANNON_ID in all_high and 3082 in all_high


def test_dev_login_roundtrip(client):
    response = client.get("/api/auth/login", follow_redirects=False)
    assert response.status_code == 303
    assert client.get("/api/auth/me").json()["authenticated"] is True


def test_create_fit_and_read_back(user_client):
    created = user_client.post("/api/fits", json={"shipId": RIFTER_ID, "name": "Test Rifter"})
    assert created.status_code == 201, created.text
    fit_id = created.json()["id"]

    detail = user_client.get("/api/fits/{}".format(fit_id)).json()
    assert detail["name"] == "Test Rifter"
    assert detail["ship"]["item"]["name"] == "Rifter"
    # The hull's own bonuses ride along for the card at the bottom of the fitting view
    traits = detail["ship"]["traits"]
    assert traits and "<b>" in traits and "Frigate" in traits
    # A fresh Rifter: three high slots, all empty
    assert len(detail["racks"]["high"]) == 3
    assert all(module["isEmpty"] for module in detail["racks"]["high"])
    assert detail["stats"]["errors"] == {}


def test_create_fit_with_an_unknown_ship_is_a_clean_400(user_client):
    """A ship id the game data does not know must surface as a readable 400,
    not an internal ``'NoneType' object has no attribute 'category'`` leak."""
    response = user_client.post("/api/fits", json={"shipId": 999_999_999})
    assert response.status_code == 400
    assert "Unknown ship ID" in response.json()["detail"]


def test_empty_fit_stats_are_ship_baseline(user_client):
    fit_id = user_client.post("/api/fits", json={"shipId": RIFTER_ID}).json()["id"]
    stats = user_client.get("/api/fits/{}/stats".format(fit_id)).json()["stats"]

    # Rifter with all-5 skills and no modules
    hardpoints = stats["resources"]["hardpoints"]
    assert hardpoints["turret"]["total"] == 3
    assert hardpoints["turret"]["used"] == 0
    assert stats["resistances"]["hp"]["shield"] > 0
    assert stats["resistances"]["ehp"]["total"] > stats["resistances"]["hp"]["total"]
    assert stats["firepower"]["dps"]["value"]["total"] == 0
    assert stats["capacitor"]["stable"] is True
    assert stats["targeting"]["maxTargetRange"] > 0


def test_fit_rename_and_delete(user_client):
    fit_id = user_client.post("/api/fits", json={"shipId": RIFTER_ID}).json()["id"]

    renamed = user_client.patch("/api/fits/{}".format(fit_id), json={"name": "Renamed"})
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Renamed"

    assert user_client.patch("/api/fits/{}".format(fit_id), json={"name": "  "}).status_code == 400

    assert user_client.delete("/api/fits/{}".format(fit_id)).status_code == 204
    assert user_client.get("/api/fits/{}".format(fit_id)).status_code == 404


def test_fits_are_isolated_between_users(user_client, second_user_client):
    """The whole point of the per-user database."""
    fit_id = user_client.post("/api/fits", json={"shipId": RIFTER_ID, "name": "Mine"}).json()["id"]

    assert [f["name"] for f in user_client.get("/api/fits").json()["fits"]] == ["Mine"]
    assert second_user_client.get("/api/fits").json()["fits"] == []

    # Fit IDs restart per user, so the second user's fit 1 is not the first user's
    second_fit = second_user_client.post("/api/fits", json={"shipId": RIFTER_ID, "name": "Theirs"}).json()["id"]
    assert second_fit == fit_id  # same numbering, different database
    assert second_user_client.get("/api/fits/{}".format(second_fit)).json()["name"] == "Theirs"
    assert user_client.get("/api/fits/{}".format(fit_id)).json()["name"] == "Mine"

    # And the second user cannot reach into the first user's data
    second_user_client.patch("/api/fits/{}".format(fit_id), json={"name": "Hijacked"})
    assert user_client.get("/api/fits/{}".format(fit_id)).json()["name"] == "Mine"


def test_service_singletons_are_scoped_per_user(app_state, user_client, second_user_client):
    """Fit caches ORM objects, so one instance per process would mix users up."""
    from service.fit import Fit

    first = user_client.pyfaUser
    second = second_user_client.pyfaUser

    with app_state.registry.acquire(first.id):
        first_instance = Fit.getInstance()
        first_instance_again = Fit.getInstance()
    with app_state.registry.acquire(second.id):
        second_instance = Fit.getInstance()

    assert first_instance is first_instance_again, "the same user must get the same instance"
    assert first_instance is not second_instance, "different users must not share engine state"


def test_saveddata_without_a_user_fails_loudly():
    """A background thread that forgot to bind must not write to the wrong database."""
    import pytest

    from eos.db import sessionctx

    with pytest.raises(sessionctx.NoSessionContextError):
        sessionctx.get_context().session.query("anything")


def test_item_attributes_and_requirements(client):
    attributes = client.get("/api/items/{}/attributes".format(AUTOCANNON_ID)).json()
    assert attributes["modified"] is False
    assert any(row["name"] == "damageMultiplier" for row in attributes["rows"])

    requirements = client.get("/api/items/{}/requirements".format(AUTOCANNON_ID)).json()
    assert any(row["name"] == "Small Projectile Turret" for row in requirements["skills"])


def test_valid_charges_for_module(client):
    charges = client.get("/api/items/{}/charges".format(AUTOCANNON_ID)).json()["charges"]
    names = {charge["item"]["name"] for charge in charges}
    assert "EMP S" in names


@pytest.mark.parametrize("kind,image_id", [("icons", 387), ("renders", 46)])
def test_images_are_served(client, kind, image_id):
    response = client.get("/img/{}/{}".format(kind, image_id))
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert "max-age" in response.headers["cache-control"]


def test_unknown_image_is_404(client):
    assert client.get("/img/icons/999999999").status_code == 404
    assert client.get("/img/bogus/1").status_code == 404


def test_meta_only_tells_a_signed_in_client_about_the_dev_bypass(client, user_client):
    """The flag is an invitation on a deployment that left it on by mistake."""
    assert client.get("/api/meta").json()["sso"]["devBypass"] is False
    assert user_client.get("/api/meta").json()["sso"]["devBypass"] is True


def test_dispatched_callbacks_keep_the_context_they_were_queued_from(app_state, user_client):
    """wx.CallAfter carries the caller's context, so the callback sees the user."""
    import threading

    from eos.db import sessionctx
    from web.events import dispatcher

    user = user_client.pyfaUser
    result = {}
    done = threading.Event()

    with app_state.registry.acquire(user.id) as data:
        def callback():
            try:
                result["context"] = sessionctx.current_context()
            except Exception as ex:  # pragma: no cover - a failure is the point
                result["error"] = ex
            finally:
                done.set()

        dispatcher.submit(callback)
        assert done.wait(30), "the dispatcher never ran the callback"

    assert result.get("error") is None
    assert result["context"] is data.context


def test_dispatched_callbacks_from_a_foreign_thread_cannot_touch_saveddata(app_state):
    """Threads do not inherit contextvars, so such a callback has to fail loudly."""
    import threading

    from eos.db import sessionctx
    from web.events import dispatcher

    result = {}
    done = threading.Event()

    def foreign_thread():
        def callback():
            try:
                sessionctx.get_context().session.query("anything")
            except Exception as ex:
                result["error"] = ex
            finally:
                done.set()

        dispatcher.submit(callback)

    threading.Thread(target=foreign_thread, daemon=True).start()
    assert done.wait(30), "the dispatcher never ran the callback"
    assert isinstance(result["error"], sessionctx.NoSessionContextError)


def test_fit_exports_as_eft_text(user_client):
    """The TXT export is always available and answers with EFT text, not JSON."""
    fit_id = user_client.post("/api/fits", json={"shipId": RIFTER_ID, "name": "Text Export"}).json()["id"]
    user_client.post("/api/fits/{}/commands".format(fit_id), json={
        "command": "addLocalModule", "args": {"itemId": AUTOCANNON_ID},
    })

    response = user_client.get("/api/fits/{}/export-txt".format(fit_id))
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/plain")

    lines = response.text.splitlines()
    assert lines[0] == "[Rifter, Text Export]"
    # EFT lists each fitted item by name, the module we added included
    assert any(line.strip().startswith("200mm AutoCannon II") for line in lines)


def test_export_txt_needs_no_login(client):
    """An anonymous visitor can copy a fit out of pyfa like any other read: the answer
    is about the fit existing or not (404), never a demand for a login (401)."""
    response = client.get("/api/fits/12345/export-txt")
    assert response.status_code == 404


def test_export_txt_of_a_foreign_fit_is_a_404(user_client, second_user_client):
    """A fit id from another account is the same as one that never existed."""
    fit_id = user_client.post("/api/fits", json={"shipId": RIFTER_ID}).json()["id"]
    assert second_user_client.get("/api/fits/{}/export-txt".format(fit_id)).status_code == 404

