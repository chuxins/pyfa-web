"""Fighter squadrons on a carrier: which abilities count, and what the numbers add up to.

A combat fighter carries two damaging abilities in the game data -- its attack
(``fighterAbilityAttackM``) and anti-fighter missiles (``fighterAbilityMissiles``) -- and
only one of them is ever fired. They used to be switched on together whenever the game
data happened to list the missiles first, so a Templar II squadron on an Archon reported
441 DPS instead of the 267 its attack does. These tests pin the choice and the arithmetic.
"""

import pytest

#: Archon: 4 fighter tubes (3 light + 2 support slots), 65 000 m3 fighter bay
ARCHON = 23757
#: Templar II: light fighter, 6 to a squadron, attack = 5 s cycle
TEMPLAR_II = 40556
#: Dragonfly II: the second combat fighter these tests use -- it carries both the attack
#: and the anti-fighter missiles too, on the same light slots
DRAGONFLY_II = 40557
#: Cenobite I: a support fighter -- no attack ability, an energy neutralizer and a
#: microwarpdrive instead, which keeps its ability switched on
SUPPORT_FIGHTER = 37599


def make_carrier(client, name="Fighter Test"):
    response = client.post("/api/fits", json={"shipId": ARCHON, "name": name})
    assert response.status_code == 201, response.text
    fit_id = response.json()["id"]
    return fit_id


def add_fighter(client, fit_id, item_id):
    response = client.post(
        "/api/fits/{}/commands".format(fit_id),
        json={"command": "addLocalFighter", "args": {"itemId": item_id}})
    assert response.status_code == 200, response.text
    return response.json()


def detail(client, fit_id):
    response = client.get("/api/fits/{}".format(fit_id))
    assert response.status_code == 200, response.text
    return response.json()


def ability_state(row):
    return {ability["name"]: ability["active"] for ability in row["abilities"]}


def firepower(fit):
    return fit["stats"]["firepower"]


def test_a_combat_squadron_fires_only_its_attack(user_client):
    """Templar II: the attack is on, the anti-fighter missiles are not."""
    fit_id = make_carrier(user_client)
    add_fighter(user_client, fit_id, TEMPLAR_II)

    row = detail(user_client, fit_id)["fighters"][0]
    state = ability_state(row)
    assert state.get("Turret Attack") is True, state
    assert state.get("Missile Attack") is False, state
    # the microwarpdrive is a deliberate choice, never on by default
    assert state.get("Microwarpdrive") is False, state


def test_the_squadron_dps_is_the_attack_and_nothing_else(user_client):
    """The two numbers have to agree with each other: DPS = volley / attack cycle."""
    fit_id = make_carrier(user_client)
    add_fighter(user_client, fit_id, TEMPLAR_II)
    strike = firepower(detail(user_client, fit_id))

    # Templar II's attack cycles in 5 s
    assert strike["dps"]["value"]["total"] == pytest.approx(strike["volley"]["value"]["total"] / 5.0, rel=1e-6)
    # and it is the light fighter's own damage, not a sum of two weapons
    assert 200 < strike["dps"]["value"]["total"] < 320, strike["dps"]["value"]


def test_turning_the_anti_fighter_missiles_on_adds_their_share(user_client):
    """Proving the missiles are a separate weapon the pilot can switch on."""
    fit_id = make_carrier(user_client)
    add_fighter(user_client, fit_id, TEMPLAR_II)
    before = firepower(detail(user_client, fit_id))["dps"]["value"]["total"]

    fighter = detail(user_client, fit_id)["fighters"][0]
    missiles = next(ability for ability in fighter["abilities"] if ability["name"] == "Missile Attack")
    response = user_client.post(
        "/api/fits/{}/commands".format(fit_id),
        json={"command": "toggleLocalFighterAbilityState",
              "args": {"main": {"kind": "fighter", "position": fighter["position"]},
                       "effectId": missiles["effectId"]}})
    assert response.status_code == 200, response.text
    after = firepower(response.json())["dps"]["value"]["total"]
    assert after > before


def test_a_second_kind_of_fighter_also_fires_one_weapon(user_client):
    fit_id = make_carrier(user_client)
    add_fighter(user_client, fit_id, DRAGONFLY_II)

    row = detail(user_client, fit_id)["fighters"][0]
    state = ability_state(row)
    attack = [name for name, active in state.items() if active and "Attack" in name]
    assert attack == ["Turret Attack"], state
    assert state.get("Missile Attack") is False, state


def test_a_squadron_holds_six_fighters_and_uses_one_tube(user_client):
    fit_id = make_carrier(user_client)
    add_fighter(user_client, fit_id, TEMPLAR_II)

    fit = detail(user_client, fit_id)
    row = fit["fighters"][0]
    assert row["amount"] == 6
    assert row["active"] is True
    assert row["state"] == "active"
    resources = fit["stats"]["resources"]["fighters"]
    assert resources["tubesUsed"] == 1
    assert resources["tubesTotal"] == 4
    assert resources["bayUsed"] == pytest.approx(6000)


def test_a_recalled_squadron_stops_counting(user_client):
    """A squadron in the hangar contributes nothing to the fit's damage."""
    fit_id = make_carrier(user_client)
    add_fighter(user_client, fit_id, TEMPLAR_II)
    assert firepower(detail(user_client, fit_id))["dps"]["value"]["total"] > 0

    fighter = detail(user_client, fit_id)["fighters"][0]
    recalled = user_client.post(
        "/api/fits/{}/commands".format(fit_id),
        json={"command": "toggleLocalFighterStates",
              "args": {"main": {"kind": "fighter", "position": fighter["position"]}}})
    assert recalled.status_code == 200, recalled.text
    assert recalled.json()["fighters"][0]["active"] is False
    assert firepower(recalled.json())["dps"]["value"]["total"] == 0


def test_a_support_squadron_keeps_its_utility_ability(user_client):
    """No attack ability means the squadron's neut/web/ECM starts switched on."""
    fit_id = make_carrier(user_client)

    added = add_fighter(user_client, fit_id, SUPPORT_FIGHTER)
    state = ability_state(added["fighters"][0])
    if not state:
        pytest.skip("that fighter has no implemented ability in this game data")
    assert any(state.values()), state
    assert state.get("Microwarpdrive") is not True, state
# -- the stored state a fit can carry from before the fix -------------------------------
#
# A squadron saved by the old rule can hold the attack and the anti-fighter missiles
# switched on at once. Loading it runs ``normaliseAbilityDefaults``, which these tests
# drive on a stand-in object (building a real Fighter needs the engine's database
# context, and the rule itself does not).


class _Ability:
    def __init__(self, name, active, dealsDamage=True):
        self.effect = type("Effect", (), {"name": name})
        self.active = active
        self.dealsDamage = dealsDamage


class _StoredSquadron:
    abilities = ()
    itemID = 40556


def _normalise(abilities):
    from eos.saveddata.fighter import Fighter

    squadron = _StoredSquadron()
    squadron.abilities = abilities
    squadron.STANDARD_ATTACK_EFFECTS = Fighter.STANDARD_ATTACK_EFFECTS
    Fighter.normaliseAbilityDefaults(squadron)
    return squadron


def test_a_squadron_saved_with_both_weapons_on_is_corrected_on_load():
    attack = _Ability("fighterAbilityAttackM", True)
    missiles = _Ability("fighterAbilityMissiles", True)
    _normalise([attack, missiles])

    assert attack.active is True
    assert missiles.active is False


def test_normalising_leaves_a_deliberate_choice_alone():
    attack = _Ability("fighterAbilityAttackM", False)
    missiles = _Ability("fighterAbilityMissiles", True)
    _normalise([attack, missiles])

    assert attack.active is False
    assert missiles.active is True


def test_normalising_keeps_non_damaging_abilities():
    """A support squadron's neut is not a weapon, so the rule never touches it."""
    attack = _Ability("fighterAbilityAttackM", True)
    neut = _Ability("fighterAbilityEnergyNeutralizer", True, dealsDamage=False)
    _normalise([attack, neut])

    assert attack.active is True
    assert neut.active is True
