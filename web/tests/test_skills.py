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


def test_auxiliary_skills_listed_separately(client):
    """Skills the fit does not require but which change its numbers (CPU
    Management boosts the Rifter's power grid output, etc.) are returned in a
    distinct `auxiliary` section and never duplicated into `skills`."""
    fit_id = make_fit(client)

    payload = skills_of(client, fit_id)
    assert "auxiliary" in payload
    assert payload["auxiliaryTotal"] == len(payload["auxiliary"])

    required_ids = {row["id"] for row in payload["skills"]}
    aux_by_name = {row["name"]: row for row in payload["auxiliary"]}
    assert not (required_ids & {row["id"] for row in payload["auxiliary"]})

    # CPU Management is a passive ship bonus, never a fit requirement.
    cpu = aux_by_name["CPU Management"]
    assert cpu["requiredLevel"] == 0
    assert cpu["auxiliary"] is True
    assert "Rifter" in cpu["sources"]
    # The default test character is All 5.
    assert cpu["currentLevel"] == 5

    # Auxiliary rows are sorted by name, and auxiliary never counts as missing.
    names = [row["name"] for row in payload["auxiliary"]]
    assert names == sorted(names)
    assert payload["missing"] == sum(1 for row in payload["skills"] if not row["met"])


def test_auxiliary_skills_exclude_required_chain(client):
    """With a projectile turret fitted, Gunnery stays in the requirement chain
    (it is a prerequisite of the turret skills) instead of being reported as
    auxiliary, while a purely bonus skill (e.g. Weapon Upgrades, if it applies)
    still shows up on the auxiliary side."""
    fit_id = make_fit(client)
    added = client.post("/api/fits/{}/commands".format(fit_id),
                        json={"command": "addLocalModule", "args": {"itemId": AUTOCANNON_ID}})
    assert added.status_code == 200, added.text

    payload = skills_of(client, fit_id)
    required_names = {row["name"] for row in payload["skills"]}
    aux_names = {row["name"] for row in payload["auxiliary"]}

    assert "Gunnery" in required_names
    assert "Gunnery" not in aux_names
    assert "CPU Management" in aux_names


def test_auxiliary_skills_all_zero_character(user_client):
    """Level-0 characters still see the auxiliary skills available to the fit:
    passive skill effects register at level 0, and they never look unmet."""
    presets = {entry["name"]: entry["id"]
               for entry in user_client.get("/api/meta").json()["characters"]
               if entry["kind"] == "preset"}
    fit_id = make_fit(user_client)
    changed = user_client.post("/api/fits/{}/commands".format(fit_id),
                               json={"command": "changeChar", "args": {"characterId": presets["All 0"]}})
    assert changed.status_code == 200, changed.text

    payload = skills_of(user_client, fit_id)
    assert payload["auxiliaryTotal"] >= 1
    assert all(row["currentLevel"] == 0 and row["met"] for row in payload["auxiliary"])
    # Auxiliary skills never contribute to the unmet count.
    assert payload["missing"] == payload["total"]


def test_unknown_fit_is_404(client):
    assert client.get("/api/fits/99999999/skills").status_code == 404
