"""Skills that affect a fit: GET /api/fits/{id}/skills.

Checks the aggregation itself (direct skills, recursive prerequisites, sources,
highest level wins) and the comparison against the fit character's levels.
"""

from eos.db import sessionctx

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


# -- editable skill levels (skill simulation) --------------------------------------------


def fit_on_editable(app_state, suffix=""):
    """A Rifter fit sitting on a fresh, non-preset (all-zero) pilot.

    Built entirely inside one bound guest context: the engine loads fits and
    characters lazily through the context's session, so mixing HTTP-created
    rows with direct service calls in the same test confuses its identity map.
    A uniquely named pilot per test keeps cases independent, mirroring what a
    signed-in pilot's data looks like after an EVE skill sync.
    """
    import eos.db
    from service.character import Character
    from service.fit import Fit

    fit_on_editable._counter += 1
    name = "Web Editable Tester{}".format(suffix or " {}".format(fit_on_editable._counter))
    with sessionctx.bind_context(app_state.registry.get_guest().context):
        char = Character.new(name)
        fit_id = Fit.getInstance().newFit(RIFTER_ID, name="Editable Pilot Fit")
        Fit.getInstance().changeChar(fit_id, char.ID)
        eos.db.commit()
        return fit_id


fit_on_editable._counter = 0


def test_skills_payload_marks_presets_non_editable(client):
    """All 5/All 0 presets report characterEditable=False and no dirty skills."""
    payload = skills_of(client, make_fit(client))
    assert payload["characterEditable"] is False
    assert payload["dirtyTotal"] == 0
    assert all(row["dirty"] is False for row in payload["skills"])


def test_level_change_is_applied_flagged_dirty_and_reverts(client, app_state):
    """PUT sets the active level and marks the row dirty; reset restores 0.

    The pilot starts untrained, so the ship skill is a gap. Setting it to the
    required level closes the gap (missing count moves), then reset brings the
    saved empty sheet back.
    """
    fit_id = fit_on_editable(app_state)
    payload = skills_of(client, fit_id)
    assert payload["characterEditable"] is True

    frigate = next(row for row in payload["skills"] if row["name"] == "Minmatar Frigate")
    assert frigate["currentLevel"] == 0
    assert frigate["met"] is False
    assert frigate["dirty"] is False
    missing_before = payload["missing"]
    assert missing_before >= 1

    changed = client.put(
        "/api/fits/{}/skills/{}/level".format(fit_id, frigate["id"]),
        json={"level": frigate["requiredLevel"]},
    )
    assert changed.status_code == 200, changed.text
    after = changed.json()
    row = next(r for r in after["skills"] if r["id"] == frigate["id"])
    assert row["currentLevel"] == frigate["requiredLevel"]
    assert row["met"] is True
    assert row["dirty"] is True
    assert after["dirtyTotal"] >= 1
    assert after["missing"] == missing_before - 1

    reset = client.post("/api/fits/{}/skills/reset".format(fit_id))
    assert reset.status_code == 200, reset.text
    restored = reset.json()
    row = next(r for r in restored["skills"] if r["id"] == frigate["id"])
    assert row["currentLevel"] == 0
    assert row["met"] is False
    assert row["dirty"] is False
    assert restored["dirtyTotal"] == 0
    assert restored["missing"] == missing_before


def test_level_change_then_reset_clears_dirty(client, app_state):
    """After a simulation the dirty state only clears with Reset: setting a
    never-trained skill to 0 still diverges from its stored NULL row (pyfa's
    dirtySkills compares against the persisted level, not against zero)."""
    fit_id = fit_on_editable(app_state)
    skill_id = next(iter(skills_of(client, fit_id)["skills"]))["id"]

    changed = client.put("/api/fits/{}/skills/{}/level".format(fit_id, skill_id), json={"level": 3})
    assert changed.status_code == 200
    assert changed.json()["dirtyTotal"] >= 1

    back = client.put("/api/fits/{}/skills/{}/level".format(fit_id, skill_id), json={"level": 0})
    assert back.status_code == 200
    row = next(r for r in back.json()["skills"] if r["id"] == skill_id)
    assert row["currentLevel"] == 0
    assert row["dirty"] is True

    reset = client.post("/api/fits/{}/skills/reset".format(fit_id))
    assert reset.status_code == 200
    row = next(r for r in reset.json()["skills"] if r["id"] == skill_id)
    assert row["currentLevel"] == 0
    assert row["dirty"] is False
    assert reset.json()["dirtyTotal"] == 0


def test_level_change_on_preset_is_409(client, app_state):
    """The built-in characters reject edits; their levels are fixed.

    The fit is built directly in the guest context (not via the HTTP create
    path): the process-wide Fit service memoizes its default pilot, so a fit
    created after another test switched the service default would otherwise
    ride that pilot instead of All 5.
    """
    import eos.db
    from eos.saveddata.character import Character as es_Character
    from service.fit import Fit

    with sessionctx.bind_context(app_state.registry.get_guest().context):
        all5 = es_Character.getAll5()
        eos.db.commit()
        fit_id = Fit.getInstance().newFit(RIFTER_ID, name="All Five Fit")
        Fit.getInstance().changeChar(fit_id, all5.ID)
        eos.db.commit()
    # pick a required skill id through the read API
    skill_id = skills_of(client, fit_id)["skills"][0]["id"]
    refused = client.put(
        "/api/fits/{}/skills/{}/level".format(fit_id, skill_id),
        json={"level": 1},
    )
    assert refused.status_code == 409, refused.text
    # Nothing moved.
    assert skills_of(client, fit_id)["dirtyTotal"] == 0


def test_level_change_validates_level_and_skill(client, app_state):
    fit_id = fit_on_editable(app_state)
    skill_id = skills_of(client, fit_id)["skills"][0]["id"]
    assert client.put(
        "/api/fits/{}/skills/{}/level".format(fit_id, skill_id), json={"level": 6}
    ).status_code == 422
    assert client.put(
        "/api/fits/{}/skills/{}/level".format(fit_id, RIFTER_ID), json={"level": 1}
    ).status_code == 400


def test_simulated_levels_are_not_persisted(client, app_state):
    """A simulation only moves in-memory active levels; the characterSkills
    row keeps its stored (untrained NULL) level instead of the simulated one."""
    import eos.db
    import sqlalchemy

    fit_id = fit_on_editable(app_state)
    with sessionctx.bind_context(app_state.registry.get_guest().context):
        char_id = eos.db.getFit(fit_id).character.ID
    skill_id = next(iter(skills_of(client, fit_id)["skills"]))["id"]
    changed = client.put(
        "/api/fits/{}/skills/{}/level".format(fit_id, skill_id), json={"level": 4}
    )
    assert changed.status_code == 200

    def stored_levels():
        with sessionctx.bind_context(app_state.registry.get_guest().context):
            return eos.db.saveddata_session.execute(
                sqlalchemy.text(
                    "select _Skill__level from characterSkills "
                    "where characterID = :c and itemID = :s"
                ),
                {"c": char_id, "s": skill_id},
            ).fetchall()

    # The pilot never trained this skill: the row exists (created with the
    # character) at NULL, and the simulation must not turn it into 4.
    assert stored_levels() == [(None,)]

    client.post("/api/fits/{}/skills/reset".format(fit_id))
    assert stored_levels() == [(None,)]


def test_custom_skill_level_is_editable_and_resets(client, app_state):
    """The pilot's own pinned skills are editable in the same way."""
    fit_id = fit_on_editable(app_state)
    client.post("/api/fits/{}/custom-skills".format(fit_id), json={"skillId": CPU_MANAGEMENT_ID})
    skill_id = CPU_MANAGEMENT_ID

    changed = client.put(
        "/api/fits/{}/skills/{}/level".format(fit_id, skill_id), json={"level": 2}
    )
    assert changed.status_code == 200, changed.text
    row = next(r for r in changed.json()["custom"] if r["id"] == skill_id)
    assert row["currentLevel"] == 2
    assert row["dirty"] is True

    reset = client.post("/api/fits/{}/skills/reset".format(fit_id)).json()
    row = next(r for r in reset["custom"] if r["id"] == skill_id)
    assert row["currentLevel"] == 0
    assert row["dirty"] is False
