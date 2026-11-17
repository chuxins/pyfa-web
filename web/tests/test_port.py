"""P1 import/export API tests.

The endpoints are thin wrappers over pyfa's own ``service.port`` (verified
headless in ``test_smoke_m0.py``); these tests pin the web contract: format
detection, fit creation, applying item text to an existing fit through the
undo stack, the export formats, and the design-doc error vocabulary.
"""

from web.tests.conftest import AUTOCANNON_ID, RIFTER_ID

#: A Rifter with one 200mm AutoCannon II (DNA spells quantities as ``;n``)
DNA_RIFTER = "587:2889;1::"

#: The same fit as EFT text
EFT_RIFTER = "[Rifter, M0 Smoke]\n200mm AutoCannon II"

#: An item-level paste the desktop recognizes as drones
DRONE_TEXT = "Hornet EC-300 x3"


def make_fit(client, name="Port Test", ship_id=RIFTER_ID):
    response = client.post("/api/fits", json={"shipId": ship_id, "name": name})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def import_text(client, text, target_fit_id=None, save=True):
    payload = {"text": text, "save": save}
    if target_fit_id is not None:
        payload["targetFitId"] = target_fit_id
    return client.post("/api/port/import", json=payload)


# ---------------------------------------------------------------------------
# Import
# ---------------------------------------------------------------------------

def test_import_dna_creates_a_fit(user_client):
    response = import_text(user_client, DNA_RIFTER)
    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["format"] == "dna"
    assert payload["appliedToFitId"] is None
    assert len(payload["created"]) == 1
    created = payload["created"][0]
    assert created["shipName"] == "Rifter"
    assert created["id"] is not None

    # the new fit is really in the caller's database
    detail = user_client.get("/api/fits/{}".format(created["id"])).json()
    assert detail["ship"]["item"]["name"] == "Rifter"


def test_import_eft_creates_a_fit(user_client):
    response = import_text(user_client, EFT_RIFTER)
    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["format"] == "eft"
    assert len(payload["created"]) == 1
    assert payload["created"][0]["shipName"] == "Rifter"


def test_import_unrecognised_text_is_unsupported(user_client):
    response = import_text(user_client, "this is not a fit")
    assert response.status_code == 400, response.text
    assert response.json()["detail"]["code"] == "importUnsupported"


def test_import_empty_text_is_unreadable(user_client):
    response = import_text(user_client, "   \n  ")
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "importUnreadable"



# ---------------------------------------------------------------------------
# Import into an existing fit (desktop paste semantics)
# ---------------------------------------------------------------------------

def test_import_applies_drones_to_existing_fit(user_client):
    fit_id = make_fit(user_client, "Drone Host")
    response = import_text(user_client, DRONE_TEXT, target_fit_id=fit_id)
    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["format"] == "drones"
    assert payload["created"] == []
    assert payload["appliedToFitId"] == fit_id

    detail = user_client.get("/api/fits/{}".format(fit_id)).json()
    drones = detail["drones"]
    assert len(drones) == 1
    assert drones[0]["amount"] == 3


def test_import_whole_fit_text_with_target_creates_new_fit(user_client):
    """A whole-fit DNA text pasted with a target still creates a new fit,
    exactly like the desktop paste into an open fit."""
    fit_id = make_fit(user_client, "Existing")
    response = import_text(user_client, DNA_RIFTER, target_fit_id=fit_id)
    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["format"] == "dna"
    assert payload["appliedToFitId"] is None
    assert len(payload["created"]) == 1


def test_import_apply_to_missing_fit_is_404(user_client):
    response = import_text(user_client, DRONE_TEXT, target_fit_id=999999)
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Unsaved imports (clipboard: open the fit, do not add it to the library)
# ---------------------------------------------------------------------------

def test_import_without_save_stays_unsaved_and_discardable(user_client):
    """``save=false`` opens the pasted fit but keeps it out of the library: it is
    not listed anywhere until saved, and discarding removes it entirely."""
    response = import_text(user_client, DNA_RIFTER, save=False)
    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["format"] == "dna"
    assert len(payload["created"]) == 1
    fit_id = payload["created"][0]["id"]

    # The fit is openable and flagged as unsaved
    detail = user_client.get("/api/fits/{}".format(fit_id)).json()
    assert detail["ship"]["item"]["name"] == "Rifter"
    assert detail["dirty"] is True
    assert detail["draft"] is True

    # ...but it is not a fit of the library yet: no list, hull list or search hit
    listed = [fit["id"] for fit in user_client.get("/api/fits").json()["fits"]]
    assert fit_id not in listed
    by_ship = [fit["id"] for fit in user_client.get("/api/fits", params={"shipId": RIFTER_ID}).json()["fits"]]
    assert fit_id not in by_ship
    found = [fit["id"] for fit in user_client.get("/api/fits", params={"q": "Imported"}).json()["fits"]]
    assert fit_id not in found

    # Discarding the draft deletes it: it was never a fit of the library
    discarded = user_client.post("/api/fits/{}/discard".format(fit_id))
    assert discarded.status_code == 200, discarded.text
    assert discarded.json()["removed"] is True
    assert user_client.get("/api/fits/{}".format(fit_id)).status_code == 404


def test_import_without_save_enters_the_library_only_when_saved(user_client):
    """Clicking Save is what turns a pasted fit into a library fit."""
    fit_id = import_text(user_client, DNA_RIFTER, save=False).json()["created"][0]["id"]

    saved = user_client.post("/api/fits/{}/save".format(fit_id))
    assert saved.status_code == 200, saved.text
    assert saved.json()["dirty"] is False
    assert saved.json()["draft"] is False

    listed = [fit["id"] for fit in user_client.get("/api/fits").json()["fits"]]
    assert fit_id in listed


def test_import_without_save_is_not_saved_by_saving_another_fit(user_client):
    """Saving an unrelated fit must not drag the pasted draft into the library.

    The draft has a row of its own (it needs an id to be opened), so this pins the
    line between "unsaved" and "saved": only the draft's own Save changes it.
    """
    draft_id = import_text(user_client, DNA_RIFTER, save=False).json()["created"][0]["id"]

    other_id = make_fit(user_client, "Unrelated")
    assert user_client.post("/api/fits/{}/save".format(other_id)).status_code == 200

    listed = [fit["id"] for fit in user_client.get("/api/fits").json()["fits"]]
    assert other_id in listed
    assert draft_id not in listed
    assert user_client.get("/api/fits/{}".format(draft_id)).json()["draft"] is True


def test_import_without_save_replaces_the_previous_draft(user_client):
    """A new clipboard import throws the previous unsaved import away."""
    first = import_text(user_client, DNA_RIFTER, save=False).json()["created"][0]["id"]
    second = import_text(user_client, EFT_RIFTER, save=False).json()["created"][0]["id"]

    assert user_client.get("/api/fits/{}".format(first)).status_code == 404
    assert user_client.get("/api/fits/{}".format(second)).status_code == 200


def test_duplicating_a_draft_fit_creates_a_library_fit(user_client):
    """Save As on a pasted draft produces a normal fit, not another hidden draft."""
    draft_id = import_text(user_client, DNA_RIFTER, save=False).json()["created"][0]["id"]

    clone = user_client.post("/api/fits/{}/duplicate".format(draft_id))
    assert clone.status_code == 201, clone.text
    copy_id = clone.json()["id"]

    listed = [fit["id"] for fit in user_client.get("/api/fits").json()["fits"]]
    assert copy_id in listed
    assert draft_id not in listed


def test_import_without_save_applies_items_as_draft(user_client):
    """Item-level text with ``save=false`` lands on the target fit as an
    unsaved draft; saving the fit afterwards persists it."""
    fit_id = make_fit(user_client, "Drone Draft Host")
    response = import_text(user_client, DRONE_TEXT, target_fit_id=fit_id, save=False)
    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["format"] == "drones"
    assert payload["appliedToFitId"] == fit_id

    detail = user_client.get("/api/fits/{}".format(fit_id)).json()
    assert len(detail["drones"]) == 1
    assert detail["dirty"] is True

    saved = user_client.post("/api/fits/{}/save".format(fit_id))
    assert saved.status_code == 200, saved.text
    assert saved.json()["dirty"] is False


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------


def test_export_efs_json(user_client):
    fit_id = import_text(user_client, DNA_RIFTER).json()["created"][0]["id"]
    response = user_client.post("/api/fits/{}/export".format(fit_id),
                                json={"format": "efs", "options": {}})
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("application/json")
    body = response.json()
    assert "name" in body or "ship" in body


def test_export_esi_json(user_client):
    fit_id = import_text(user_client, DNA_RIFTER).json()["created"][0]["id"]
    response = user_client.post("/api/fits/{}/export".format(fit_id),
                                json={"format": "esiJson", "options": {}})
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("application/json")
    assert response.json()["ship_type_id"] == RIFTER_ID


def test_export_optimize_prices_is_refused_until_p2(user_client):
    fit_id = import_text(user_client, DNA_RIFTER).json()["created"][0]["id"]
    response = user_client.post("/api/fits/{}/export".format(fit_id),
                                json={"format": "multibuy", "options": {"optimizePrices": True}})
    assert response.status_code == 400, response.text
    assert response.json()["detail"]["code"] == "exportUnsupported"


def test_export_unknown_format_is_refused(user_client):
    fit_id = import_text(user_client, DNA_RIFTER).json()["created"][0]["id"]
    response = user_client.post("/api/fits/{}/export".format(fit_id),
                                json={"format": "html", "options": {}})
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "exportUnsupported"


def test_export_missing_fit_is_404(user_client):
    response = user_client.post("/api/fits/999999/export",
                                json={"format": "eft", "options": {}})
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Backup and mutated items
# ---------------------------------------------------------------------------

def test_backup_round_trip(user_client):
    import_text(user_client, DNA_RIFTER)

    exported = user_client.post("/api/backup/export")
    assert exported.status_code == 200, exported.text
    assert "<?xml" in exported.text
    assert "<fittings" in exported.text

    restored = user_client.post("/api/backup/import", json={"text": exported.text})
    assert restored.status_code == 200, restored.text
    assert restored.json()["imported"] >= 1


def test_backup_import_malformed_is_unreadable(user_client):
    response = user_client.post("/api/backup/import", json={"text": "not xml at all"})
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "importUnreadable"


def test_mutant_parse_resolves_base_item(user_client):
    response = user_client.post("/api/items/mutant/parse",
                                json={"text": "200mm AutoCannon II\n"})
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["baseItemId"] == AUTOCANNON_ID
    assert payload["baseItemName"] == "200mm AutoCannon II"
    assert payload["mutaplasmidId"] is None


def test_mutant_parse_unknown_item_is_unreadable(user_client):
    response = user_client.post("/api/items/mutant/parse",
                                json={"text": "A Ship That Does Not Exist\n"})
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "importUnreadable"

def test_export_eft(user_client):
    fit_id = import_text(user_client, DNA_RIFTER).json()["created"][0]["id"]
    response = user_client.post("/api/fits/{}/export".format(fit_id),
                                json={"format": "eft", "options": {}})
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/plain")
    assert response.text.startswith("[Rifter,")
    assert "200mm AutoCannon II" in response.text


def test_export_dna(user_client):
    fit_id = import_text(user_client, DNA_RIFTER).json()["created"][0]["id"]
    response = user_client.post("/api/fits/{}/export".format(fit_id),
                                json={"format": "dna", "options": {"formatting": True}})
    assert response.status_code == 200, response.text
    assert response.text.startswith("<url=fitting:587:")
    assert "587:2889;1::" in response.text


def test_export_multibuy(user_client):
    fit_id = import_text(user_client, DNA_RIFTER).json()["created"][0]["id"]
    response = user_client.post("/api/fits/{}/export".format(fit_id),
                                json={"format": "multibuy", "options": {}})
    assert response.status_code == 200, response.text
    assert "200mm AutoCannon II" in response.text


def test_export_shipstats(user_client):
    fit_id = import_text(user_client, DNA_RIFTER).json()["created"][0]["id"]
    response = user_client.post("/api/fits/{}/export".format(fit_id),
                                json={"format": "shipstats", "options": {}})
    assert response.status_code == 200, response.text
    assert "Rifter" in response.text

def test_import_malformed_xml_is_unreadable(user_client):
    response = import_text(user_client, '<?xml version="1.0"?><fittings>')
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "importUnreadable"
