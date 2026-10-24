"""Skills that affect a fit: GET /api/fits/{id}/skills.

Checks the aggregation itself (direct skills, recursive prerequisites, sources,
highest level wins) and the comparison against the fit character's levels.
"""

from web.tests.conftest import AUTOCANNON_ID, EMP_S_ID, RIFTER_ID


def make_fit(client):
    response = client.post("/api/fits", json={"shipId": RIFTER_ID})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def skills_of(client, fit_id):
    response = client.get("/api/fits/{}/skills".format(fit_id))
    assert response.status_code == 200, response.text
    return response.json()


def by_name(payload):
    return {row["name"]: row for row in payload["skills"]}


def test_ship_only_fit_lists_ship_skill(client):
    """Even an empty fit needs the ship's own skill (Rifter -> Minmatar Frigate)."""
    fit_id = make_fit(client)
    payload = skills_of(client, fit_id)

    assert payload["missing"] == 0  # the default character is All 5
    minmatar_frigate = by_name(payload)["Minmatar Frigate"]
    assert minmatar_frigate["requiredLevel"] == 1
    assert minmatar_frigate["currentLevel"] == 5
    assert minmatar_frigate["met"] is True
    assert not minmatar_frigate["prerequisiteOnly"]
    assert "Rifter" in minmatar_frigate["sources"]


def test_module_adds_its_skill_chain_and_sources(client):
    """200mm AC II requires Small Projectile Turret V (and friends) directly;
    Spaceship Command only rides in as a prerequisite of the frigate skill."""
    fit_id = make_fit(client)
    added = client.post("/api/fits/{}/commands".format(fit_id),
                        json={"command": "addLocalModule", "args": {"itemId": AUTOCANNON_ID}})
    assert added.status_code == 200, added.text

    payload = skills_of(client, fit_id)
    rows = by_name(payload)

    turret = rows["Small Projectile Turret"]
    assert turret["requiredLevel"] == 5
    assert not turret["prerequisiteOnly"]
    assert any("200mm" in source for source in turret["sources"]), turret["sources"]
    # The specialization bonus skill is attributed to the module as well
    assert rows["Small Autocannon Specialization"]["requiredLevel"] == 1
    assert rows["Small Autocannon Specialization"]["sources"] == ["200mm AutoCannon II"]

    spaceship_command = rows["Spaceship Command"]
    assert spaceship_command["requiredLevel"] == 1
    assert spaceship_command["prerequisiteOnly"] is True
    assert spaceship_command["sources"] == []


def test_highest_requirement_wins_when_a_skill_is_both_direct_and_prereq(client):
    """Gunnery is a prerequisite of Small Projectile Turret *and* a level-II
    requirement of the T2 gun itself: the direct, higher level must win."""
    fit_id = make_fit(client)
    added = client.post("/api/fits/{}/commands".format(fit_id),
                        json={"command": "addLocalModule", "args": {"itemId": AUTOCANNON_ID}})
    assert added.status_code == 200, added.text

    gunnery = by_name(skills_of(client, fit_id))["Gunnery"]
    assert gunnery["requiredLevel"] == 2
    assert gunnery["prerequisiteOnly"] is False
    assert gunnery["sources"] == ["200mm AutoCannon II"]


def test_ammo_skill_counts_when_present(client):
    """Loading a charge is part of the fit; its requirements are aggregated too."""
    fit_id = make_fit(client)
    added = client.post("/api/fits/{}/commands".format(fit_id),
                        json={"command": "addLocalModule", "args": {"itemId": AUTOCANNON_ID}}).json()
    position = next(m["position"] for m in added["racks"]["high"] if m["itemId"] == AUTOCANNON_ID)
    loaded = client.post("/api/fits/{}/commands".format(fit_id), json={
        "command": "changeLocalModuleCharges",
        "args": {"positions": [position], "chargeItemId": EMP_S_ID},
    })
    assert loaded.status_code == 200, loaded.text

    payload = skills_of(client, fit_id)
    # Every row is well-formed and the endpoint reports the same missing total.
    for row in payload["skills"]:
        assert row["id"] and row["name"]
        assert 0 <= row["currentLevel"] <= 5
        assert 1 <= row["requiredLevel"] <= 5
        assert row["met"] == (row["currentLevel"] >= row["requiredLevel"])
    assert payload["missing"] == sum(1 for row in payload["skills"] if not row["met"])
    assert payload["total"] == len(payload["skills"])


def test_all_zero_character_marks_everything_unmet(user_client):
    presets = {entry["name"]: entry["id"]
               for entry in user_client.get("/api/meta").json()["characters"]
               if entry["kind"] == "preset"}
    fit_id = make_fit(user_client)
    changed = user_client.post("/api/fits/{}/commands".format(fit_id),
                               json={"command": "changeChar", "args": {"characterId": presets["All 0"]}})
    assert changed.status_code == 200, changed.text

    payload = skills_of(user_client, fit_id)
    assert payload["total"] >= 1
    assert payload["missing"] == payload["total"]
    assert all(not row["met"] and row["currentLevel"] == 0 for row in payload["skills"])


CPU_MANAGEMENT_ID = 3426  # passive skill a Rifter fit never requires


def search_skill(client, query):
    response = client.get("/api/fits/skills/search", params={"q": query})
    assert response.status_code == 200, response.text
    return response.json()["results"]


def test_skill_search_returns_skill_category_only(client):
    """The picker searches the Skill category; every result is a skill."""
    results = search_skill(client, "CPU Management")
    assert any(row["id"] == CPU_MANAGEMENT_ID for row in results)
    assert all(row["category"] == "Skill" for row in results)


def test_custom_skill_added_listed_and_shows_current_level(client):
    """A pinned skill lands in the `custom` section with no required level,
    reports the fit character's trained level (All 5 by default) and never
    counts as missing; `custom` stays disjoint from the required list."""
    fit_id = make_fit(client)

    added = client.post("/api/fits/{}/custom-skills".format(fit_id),
                        json={"skillId": CPU_MANAGEMENT_ID})
    assert added.status_code == 201, added.text
    body = added.json()
    assert body["added"] is True
    custom_by_name = {row["name"]: row for row in body["custom"]}
    cpu = custom_by_name["CPU Management"]
    assert cpu["requiredLevel"] == 0
    assert cpu["currentLevel"] == 5
    assert cpu["custom"] is True
    assert cpu["sources"] == []
    assert body["customTotal"] == 1

    payload = skills_of(client, fit_id)
    required_ids = {row["id"] for row in payload["skills"]}
    assert CPU_MANAGEMENT_ID not in required_ids
    assert [row["id"] for row in payload["custom"]] == [CPU_MANAGEMENT_ID]
    # Custom skills never inflate the requirement total or missing count.
    assert payload["missing"] == sum(1 for row in payload["skills"] if not row["met"])
    assert all(row["met"] for row in payload["custom"])


def test_custom_skill_duplicate_add_is_idempotent(client):
    """Pinning the same skill twice keeps one row and reports added=False."""
    fit_id = make_fit(client)
    url = "/api/fits/{}/custom-skills".format(fit_id)

    first = client.post(url, json={"skillId": CPU_MANAGEMENT_ID})
    assert first.status_code == 201
    assert first.json()["added"] is True

    second = client.post(url, json={"skillId": CPU_MANAGEMENT_ID})
    assert second.status_code == 201
    assert second.json()["added"] is False
    assert second.json()["customTotal"] == 1


def test_custom_skill_removed(client):
    """Unpinning removes the row; removing an absent pin is a quiet no-op."""
    fit_id = make_fit(client)
    client.post("/api/fits/{}/custom-skills".format(fit_id),
                json={"skillId": CPU_MANAGEMENT_ID})

    removed = client.delete("/api/fits/{}/custom-skills/{}".format(fit_id, CPU_MANAGEMENT_ID))
    assert removed.status_code == 200, removed.text
    assert removed.json()["custom"] == []
    assert skills_of(client, fit_id)["customTotal"] == 0

    # Deleting a pin that does not exist is still a successful no-op.
    again = client.delete("/api/fits/{}/custom-skills/{}".format(fit_id, CPU_MANAGEMENT_ID))
    assert again.status_code == 200


def test_add_non_skill_is_rejected(client):
    """Only Skill-category types may be pinned."""
    fit_id = make_fit(client)
    bad = client.post("/api/fits/{}/custom-skills".format(fit_id), json={"skillId": RIFTER_ID})
    assert bad.status_code == 400
    assert skills_of(client, fit_id)["customTotal"] == 0


def test_custom_skill_in_required_chain_hidden_from_custom(client):
    """Gunnery can be pinned, but with a gun fitted it is a requirement and
    must only appear in the required list, never duplicated into custom."""
    fit_id = make_fit(client)
    pinned = client.post("/api/fits/{}/custom-skills".format(fit_id), json={"skillId": 3300})
    assert pinned.status_code == 201
    assert any(row["id"] == 3300 for row in pinned.json()["custom"])

    added = client.post("/api/fits/{}/commands".format(fit_id),
                        json={"command": "addLocalModule", "args": {"itemId": AUTOCANNON_ID}})
    assert added.status_code == 200, added.text

    payload = skills_of(client, fit_id)
    assert any(row["id"] == 3300 for row in payload["skills"])
    assert all(row["id"] != 3300 for row in payload["custom"])


def test_custom_skills_all_zero_character(user_client):
    """An untrained pinned skill still shows up (at level 0) and never counts
    as a missing requirement."""
    presets = {entry["name"]: entry["id"]
               for entry in user_client.get("/api/meta").json()["characters"]
               if entry["kind"] == "preset"}
    fit_id = make_fit(user_client)
    user_client.post("/api/fits/{}/custom-skills".format(fit_id),
                     json={"skillId": CPU_MANAGEMENT_ID})
    changed = user_client.post("/api/fits/{}/commands".format(fit_id),
                               json={"command": "changeChar", "args": {"characterId": presets["All 0"]}})
    assert changed.status_code == 200, changed.text

    payload = skills_of(user_client, fit_id)
    cpu = next(row for row in payload["custom"] if row["id"] == CPU_MANAGEMENT_ID)
    assert cpu["currentLevel"] == 0
    assert cpu["met"] is True
    assert payload["missing"] == payload["total"]


def test_custom_skills_are_isolated_between_fits(client):
    """Pins belong to one fit and do not leak into another fit's list."""
    first = make_fit(client)
    second = make_fit(client)
    client.post("/api/fits/{}/custom-skills".format(first), json={"skillId": CPU_MANAGEMENT_ID})

    assert skills_of(client, first)["customTotal"] == 1
    assert skills_of(client, second)["customTotal"] == 0


def test_unknown_fit_is_404(client):
    assert client.get("/api/fits/99999999/skills").status_code == 404
