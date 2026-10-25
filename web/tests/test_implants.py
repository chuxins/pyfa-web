"""Character implants for the top-bar implant simulator.

Covers the character-level implant list (not the per-fit implant commands, which
have their own tests): listing, adding, same-slot replacement, removing, the
read-only preset guard, the catalogue search, and reconciling the list against
ESI's implants endpoint (in-game baseline kept, local simulation implants kept).
"""

from eos.db import sessionctx

#: Published implants (category Implant), by implantness slot
CA1_ID = 2082        # Genolution Core Augmentation CA-1, slot 1
AMULET_A_ID = 20499  # High-grade Amulet Alpha, slot 1
CA4_ID = 33394       # Genolution Core Augmentation CA-4, slot 2
RIFTER_ID = 587      # not an implant

_new_char_counter = {"value": 0}


def new_editable_character(user_client, app_state, bind_sso=False):
    """A fresh non-preset pilot in the test account's own database.

    Built inside one bound context for the same reason ``test_skills`` builds
    its editable pilot that way: the engine loads rows lazily through that
    session. When ``bind_sso`` is set a matching ``SsoCharacter`` token row is
    created and linked, which is what the ESI sync reads with.

    The pilot belongs to the caller's account (the ``user_client`` fixture),
    never the shared guest database: an SSO-bound character there would appear
    in every anonymous request's character strip and outlive this test.
    """
    import config as pyfaConfig
    import eos.db
    from eos.saveddata.ssocharacter import SsoCharacter
    from service.character import Character

    _new_char_counter["value"] += 1
    n = _new_char_counter["value"]
    name = "Web Implant Tester {}".format(n)
    context = app_state.registry.get(user_client.pyfaUser.id).context
    with sessionctx.bind_context(context):
        char = Character.new(name)
        eos.db.commit()
        sso_id = None
        if bind_sso:
            import datetime

            sso = SsoCharacter(90000000 + n, name, pyfaConfig.getClientSecret(), "Tranquility")
            sso.accessToken = "test-token"
            sso.refreshToken = "test-refresh-token"
            sso.accessTokenExpires = datetime.datetime.now() + datetime.timedelta(hours=1)
            eos.db.saveddata_session.add(sso)
            eos.db.saveddata_session.flush()
            char.setSsoCharacter(sso, pyfaConfig.getClientSecret())
            eos.db.commit()
            sso_id = sso.ID
        return char.ID, sso_id


def preset_id(client, name):
    entries = client.get("/api/meta").json()["characters"]
    return next(entry["id"] for entry in entries if entry["name"] == name)


def implants_of(client, character_id):
    response = client.get("/api/characters/{}/implants".format(character_id))
    assert response.status_code == 200, response.text
    return response.json()


def test_preset_reports_an_empty_editable_list(user_client):
    """All 5/All 0 start empty but are editable for implants (skills stay read-only)."""
    all5 = preset_id(user_client, "All 5")
    payload = implants_of(user_client, all5)
    assert payload["implants"] == []
    assert payload["preset"] is True
    assert payload["hasSso"] is False


def test_unknown_character_is_a_404(client):
    assert client.get("/api/characters/987654321/implants").status_code == 404


def test_add_implant_to_editable_character(user_client, app_state):
    char_id, _ = new_editable_character(user_client, app_state)
    response = user_client.post("/api/characters/{}/implants".format(char_id), json={"itemId": CA1_ID})
    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["added"] is True
    assert payload["preset"] is False
    assert [row["itemId"] for row in payload["implants"]] == [CA1_ID]
    row = payload["implants"][0]
    assert row["slot"] == 1
    assert row["source"] == "custom"
    assert [row["itemId"] for row in implants_of(user_client, char_id)["implants"]] == [CA1_ID]


def test_adding_same_slot_implant_replaces_the_old_one(user_client, app_state):
    """makeRoom: a second slot-1 implant takes the slot, like the desktop editor."""
    char_id, _ = new_editable_character(user_client, app_state)
    user_client.post("/api/characters/{}/implants".format(char_id), json={"itemId": CA1_ID})
    response = user_client.post("/api/characters/{}/implants".format(char_id),
                                json={"itemId": AMULET_A_ID})
    assert response.status_code == 201, response.text
    assert [row["itemId"] for row in response.json()["implants"]] == [AMULET_A_ID]


def test_different_slots_coexist_and_sort_by_slot(user_client, app_state):
    char_id, _ = new_editable_character(user_client, app_state)
    user_client.post("/api/characters/{}/implants".format(char_id), json={"itemId": CA4_ID})
    response = user_client.post("/api/characters/{}/implants".format(char_id),
                                json={"itemId": CA1_ID})
    ids = [(row["slot"], row["itemId"]) for row in response.json()["implants"]]
    assert ids == [(1, CA1_ID), (2, CA4_ID)]


def test_adding_an_implant_twice_is_reported(user_client, app_state):
    char_id, _ = new_editable_character(user_client, app_state)
    user_client.post("/api/characters/{}/implants".format(char_id), json={"itemId": CA1_ID})
    response = user_client.post("/api/characters/{}/implants".format(char_id),
                                json={"itemId": CA1_ID})
    assert response.status_code == 201
    assert response.json()["added"] is False
    assert len(response.json()["implants"]) == 1


def test_preset_takes_implants_and_its_fits_apply_them(user_client, app_state):
    """Presets carry simulation implants like any pilot, and their fits use them."""
    all5 = preset_id(user_client, "All 5")
    response = user_client.post("/api/characters/{}/implants".format(all5), json={"itemId": CA1_ID})
    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["preset"] is True
    assert payload["added"] is True
    assert [row["itemId"] for row in payload["implants"]] == [CA1_ID]

    # Same-slot replacement behaves as it does on a real pilot.
    response = user_client.post("/api/characters/{}/implants".format(all5),
                                json={"itemId": AMULET_A_ID})
    assert [row["itemId"] for row in response.json()["implants"]] == [AMULET_A_ID]

    # A fit sitting on the preset applies the preset's implant list.
    import eos.db
    from eos.db import sessionctx as _s
    from service.fit import Fit

    with _s.bind_context(app_state.registry.get(user_client.pyfaUser.id).context):
        fit_id = Fit.getInstance().newFit(RIFTER_ID, name="Preset implant sim")
        Fit.getInstance().changeChar(fit_id, all5)
        fit = eos.db.getFit(fit_id)
        fit.implantLocation = 1
        Fit.getInstance().recalc(fit)
        eos.db.commit()

    fit_payload = user_client.get("/api/fits/{}".format(fit_id)).json()
    assert [row["itemId"] for row in fit_payload["appliedImplants"]] == [AMULET_A_ID]

    removed = user_client.delete("/api/characters/{}/implants/{}".format(all5, AMULET_A_ID))
    assert removed.status_code == 200, removed.text
    assert removed.json()["removed"] is True
    assert removed.json()["implants"] == []


def test_non_implant_item_is_refused(user_client, app_state):
    char_id, _ = new_editable_character(user_client, app_state)
    response = user_client.post("/api/characters/{}/implants".format(char_id),
                                json={"itemId": RIFTER_ID})
    assert response.status_code == 400
    assert implants_of(user_client, char_id)["implants"] == []


def test_remove_implant(user_client, app_state):
    char_id, _ = new_editable_character(user_client, app_state)
    user_client.post("/api/characters/{}/implants".format(char_id), json={"itemId": CA1_ID})
    response = user_client.delete("/api/characters/{}/implants/{}".format(char_id, CA1_ID))
    assert response.status_code == 200, response.text
    assert response.json()["removed"] is True
    assert response.json()["implants"] == []


def test_implant_search_only_returns_implants(client):
    response = client.get("/api/implants/search?q=genolution")
    assert response.status_code == 200, response.text
    results = response.json()["results"]
    assert results
    assert CA1_ID in {row["id"] for row in results}
    assert RIFTER_ID not in {row["id"] for row in results}
    assert all(row["category"] == "Implant" for row in results)
    assert all(row["group"] != "Booster" for row in results)
    assert all(isinstance(row["slot"], int) for row in results)


def test_empty_implant_search_browses_the_whole_catalogue_by_slot(client):
    """The add-implant picker lists every implant before anything is typed."""
    response = client.get("/api/implants/search?limit=1000")
    assert response.status_code == 200, response.text
    results = response.json()["results"]
    assert len(results) > 500
    assert all(row["category"] == "Implant" for row in results)
    assert all(row["group"] != "Booster" for row in results)
    assert all(row["nameEn"] for row in results)

    by_id = {row["id"]: row for row in results}
    assert by_id[CA1_ID]["slot"] == 1
    assert by_id[CA4_ID]["slot"] == 2

    # The browse list is grouped by slot in the picker, so the server orders it.
    slots = [row["slot"] for row in results]
    assert slots == sorted(slots)


def test_implant_search_excludes_items_already_on_character(user_client, app_state):
    new_editable_character(user_client, app_state)
    response = user_client.get("/api/implants/search?q=genolution&exclude={}".format(CA1_ID))
    assert CA1_ID not in {row["id"] for row in response.json()["results"]}


# -- ESI sync ----------------------------------------------------------------


class StubEsi:
    """Stands in for service.esi.Esi: answers getImplants, no network."""

    implants = []
    failure = None

    @classmethod
    def getInstance(cls):
        return cls

    @classmethod
    def getImplants(cls, sso_id):
        if cls.failure is not None:
            raise cls.failure
        return [{"type_id": item_id} for item_id in cls.implants]


def _patch_esi(monkeypatch, implants, failure=None):
    from web.services import charimplants

    StubEsi.implants = implants
    StubEsi.failure = failure
    monkeypatch.setattr(charimplants, "_esi", lambda: StubEsi)


def test_sync_pulls_in_game_implants_and_marks_them(user_client, app_state, monkeypatch):
    char_id, sso_id = new_editable_character(user_client, app_state, bind_sso=True)
    assert sso_id is not None
    _patch_esi(monkeypatch, [CA1_ID, CA4_ID])

    response = user_client.post("/api/characters/{}/implants/sync-esi".format(char_id))
    assert response.status_code == 200, response.text
    payload = response.json()
    rows = {row["itemId"]: row for row in payload["implants"]}
    assert set(rows) == {CA1_ID, CA4_ID}
    assert all(row["source"] == "esi" for row in rows.values())


def test_sync_keeps_locally_added_simulation_implant(user_client, app_state, monkeypatch):
    char_id, _ = new_editable_character(user_client, app_state, bind_sso=True)
    # A custom implant in a slot EVE reports nothing for.
    user_client.post("/api/characters/{}/implants".format(char_id), json={"itemId": AMULET_A_ID})
    _patch_esi(monkeypatch, [CA4_ID])

    payload = user_client.post("/api/characters/{}/implants/sync-esi".format(char_id)).json()
    rows = {row["itemId"]: row["source"] for row in payload["implants"]}
    assert rows == {AMULET_A_ID: "custom", CA4_ID: "esi"}

    # A second sync (nothing changed in game) keeps both.
    payload = user_client.post("/api/characters/{}/implants/sync-esi".format(char_id)).json()
    assert {row["itemId"]: row["source"] for row in payload["implants"]} == rows


def test_sync_removes_an_in_game_implant_the_pilot_no_longer_carries(
        user_client, app_state, monkeypatch):
    char_id, _ = new_editable_character(user_client, app_state, bind_sso=True)
    _patch_esi(monkeypatch, [CA1_ID, CA4_ID])
    user_client.post("/api/characters/{}/implants/sync-esi".format(char_id))
    # The pilot jumped clones: CA-4 is gone in game.
    _patch_esi(monkeypatch, [CA1_ID])
    payload = user_client.post("/api/characters/{}/implants/sync-esi".format(char_id)).json()
    assert [row["itemId"] for row in payload["implants"]] == [CA1_ID]


def test_removing_an_in_game_implant_is_kept_until_the_clone_changes(
        user_client, app_state, monkeypatch):
    """A manual delete of an implant the clone still carries is a simulation:
    refreshing must not put it straight back. Once the pilot is no longer
    carrying it in game, the marker clears; implanting it again later shows up.
    """
    char_id, _ = new_editable_character(user_client, app_state, bind_sso=True)
    _patch_esi(monkeypatch, [CA1_ID, CA4_ID])
    user_client.post("/api/characters/{}/implants/sync-esi".format(char_id))
    # Pilot simulates without CA-1 even though the clone carries it.
    removed = user_client.delete("/api/characters/{}/implants/{}".format(char_id, CA1_ID))
    assert removed.json()["removed"] is True

    # Refresh while still carrying it: the deliberate removal is respected.
    payload = user_client.post("/api/characters/{}/implants/sync-esi".format(char_id)).json()
    assert CA1_ID not in {row["itemId"] for row in payload["implants"]}
    assert CA4_ID in {row["itemId"] for row in payload["implants"]}

    # The clone no longer carries CA-1: the marker clears on this sync...
    _patch_esi(monkeypatch, [CA4_ID])
    user_client.post("/api/characters/{}/implants/sync-esi".format(char_id))
    # ...and a later re-implantation in game brings it back as a fresh ESI row.
    _patch_esi(monkeypatch, [CA1_ID, CA4_ID])
    payload = user_client.post("/api/characters/{}/implants/sync-esi".format(char_id)).json()
    rows = {row["itemId"]: row["source"] for row in payload["implants"]}
    assert rows.get(CA1_ID) == "esi"


def test_sync_without_a_login_is_a_409(user_client, app_state):
    char_id, sso_id = new_editable_character(user_client, app_state, bind_sso=False)
    assert sso_id is None
    response = user_client.post("/api/characters/{}/implants/sync-esi".format(char_id))
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "noCharacter"


def test_sync_missing_scope_is_surfaced_for_re_authorisation(user_client, app_state, monkeypatch):
    from service.esiAccess import APIException

    char_id, _ = new_editable_character(user_client, app_state, bind_sso=True)
    failure = APIException("https://esi/implants", 403, {"error": "Forbidden"})
    _patch_esi(monkeypatch, [], failure=failure)
    response = user_client.post("/api/characters/{}/implants/sync-esi".format(char_id))
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "missingScope"
    # Nothing was written on failure.
    assert implants_of(user_client, char_id)["implants"] == []


def test_sync_an_undecryptable_login_is_a_re_login_not_a_500(user_client, app_state, monkeypatch):
    """A refresh token that cannot be decrypted (a row copied from another
    deployment, say) must answer as tokenRefused, not as a server crash."""
    from cryptography.fernet import InvalidToken

    char_id, _ = new_editable_character(user_client, app_state, bind_sso=True)
    _patch_esi(monkeypatch, [], failure=InvalidToken())
    response = user_client.post("/api/characters/{}/implants/sync-esi".format(char_id))
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "tokenRefused"


def test_sync_applied_to_a_fit_recalculates_that_fit(user_client, app_state, monkeypatch):
    """When fitId is given and the fit uses the character implant location, the
    answer carries the refreshed fit with the pulled implants applied."""
    from service.fit import Fit
    from eos.db import sessionctx as _s
    import eos.db

    char_id, _ = new_editable_character(user_client, app_state, bind_sso=True)
    _patch_esi(monkeypatch, [CA1_ID])
    with _s.bind_context(app_state.registry.get(user_client.pyfaUser.id).context):
        fit_id = Fit.getInstance().newFit(RIFTER_ID, name="Implant sim fit")
        Fit.getInstance().changeChar(fit_id, char_id)
        eos.db.commit()

    response = user_client.post(
        "/api/characters/{}/implants/sync-esi?fitId={}".format(char_id, fit_id))
    assert response.status_code == 200, response.text
    answer = response.json()
    assert answer["fit"] is not None
    assert [row["itemId"] for row in answer["fit"]["appliedImplants"]] == [CA1_ID]


