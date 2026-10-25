"""What one fitted module actually does, in the numbers the fit gives it.

The fitting view shows this on hover: damage per second and the damage type split,
the range the module works at, how much capacitor a neutralizer drains, how much a
remote repairer restores, and so on. Every value is read through
``getModifiedItemAttr`` / ``getDps`` on the *fitted* module, so skills, implants, rigs,
the module's own state and an overheated rack all land in the answer -- the same
routines the statistics column uses, which is what keeps the tooltip and the summary
from disagreeing.

Attribute-driven rather than group-driven on purpose: what a module does is written
in its dogma attributes (a neutralizer carries ``energyNeutralizerAmount``, a nos a
``powerTransferAmount``, a web a negative ``speedFactor``), and that does not change
when CCP renames a market group.

Two of those attributes need care, both verified against real modules:

* ``speedFactor`` is already a percentage -- 100 is "no change", so an afterburner II
  reads 168.75 (+68.75% velocity) and a stasis webifier II reads -60.
* ``falloff`` defaults to 1 m on modules that have no range at all (a local repairer,
  a heat sink), so anything under a kilometre is dropped rather than reported as a
  one metre falloff.

Modules whose whole job is a bonus -- a plate, a membrane, a damage mod, a tracking
enhancer -- report those bonuses through :data:`BONUS_ATTRIBUTES` instead of a modelled
effect, and resistances come in two spellings the game data really uses: a percentage
(``emDamageResistanceBonus``: -20 means "+20% resistance", on membranes and hardeners)
and a resonance multiplier (``armorEmDamageResonance``: 0.85 means 15%, on a damage
control). Both are folded into one ``resistances`` row per layer.
"""

from logbook import Logger

from eos.const import FittingModuleState

from web.services.serialize import module_accepts_charges

pyfalog = Logger(__name__)

#: Below this the value is the attribute's "no range" default rather than a range.
RANGE_FLOOR = 1000.0

#: Bonus attributes worth a row of their own, as (attribute, label, how to read it).
#:
#: * ``percent`` -- the attribute is already a percentage (a penalty is negative)
#: * ``multiplier`` -- the attribute is a factor, so 1.15 reads "+15%"
#: * ``flat`` -- a plain number (hit points added, say), printed as it is
BONUS_ATTRIBUTES = (
    ("trackingSpeedBonus", "Tracking speed", "percent"),
    ("maxRangeBonus", "Optimal range", "percent"),
    ("falloffBonus", "Falloff range", "percent"),
    ("scanResolutionBonus", "Scan resolution", "percent"),
    ("maxTargetRangeBonus", "Lock range", "percent"),
    ("signatureRadiusBonus", "Signature radius", "percent"),
    ("powerOutputMultiplier", "Powergrid output", "multiplier"),
    ("shieldBoostMultiplier", "Shield boost", "percent"),
    ("damageMultiplier", "Damage", "multiplier"),
    ("armorHPBonusAdd", "Armor hit points", "flat"),
    ("ecmStrengthBonusPercent", "ECM strength", "percent"),
    ("ecmRangeBonus", "ECM range", "percent"),
)

#: The four damage types, in the order the game data writes them
RESIST_TYPES = ("em", "thermal", "kinetic", "explosive")

#: The four sensor types an ECM jammer works on (the attribute suffix each uses)
SENSOR_TYPES = ("gravimetric", "ladar", "magnetometric", "radar")

#: Resistance layers, in the order they are worth printing
RESIST_LAYERS = ("armor", "shield", "hull")


def _attr(module, name, default=0):
    """One of the module's attributes as the fit modifies it; 0 when it has none."""
    try:
        value = module.getModifiedItemAttr(name, default)
    except Exception:  # an attribute the item does not carry at all
        return default
    if value is None:
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _cycle_seconds(module):
    """The module's cycle time in seconds (average, so a reload is spread in)."""
    try:
        params = module.getCycleParameters()
    except Exception:
        pyfalog.debug("no cycle parameters for {}", getattr(module, "itemID", "?"))
        return 0.0
    if params is None:
        return 0.0
    try:
        return float(params.averageTime) / 1000.0
    except (TypeError, ValueError):
        return 0.0


def _optimal(module):
    """The range the module works at, in metres.

    ``Module.maxRange`` is the engine's own answer: the turret's optimal range (which
    can be well under a kilometre for a small short-range turret, and which the loaded
    ammunition modifies), the neutralizer's and web's range, and -- for launchers,
    whose own attributes carry no range at all -- the missile's flight distance. An
    unloaded turret falls back to the type's own ``maxRange`` attribute. Modules with
    no range report 0; the 1 m default some attributes carry is dropped.
    """
    candidates = []
    try:
        candidates.append(module.maxRange)
    except Exception:
        pass
    candidates.append(_attr(module, "maxRange"))
    for candidate in candidates:
        try:
            value = float(candidate)
        except (TypeError, ValueError):
            continue
        if value > 10.0:
            return value
    return 0.0


def _falloff(module):
    value = _attr(module, "falloff")
    return value if value >= RANGE_FLOOR else 0.0


def _with_range(row, module):
    """Attach the range a row acts at, when the module has one."""
    optimal, falloff = _optimal(module), _falloff(module)
    if optimal or falloff:
        row["optimal"] = round(optimal)
        row["falloff"] = round(falloff)
    return row


def _damage_row(module):
    """DPS, volley and the damage split, when the module can hurt something."""
    try:
        dps = module.getDps()
        volley = module.getVolley()
    except Exception:
        pyfalog.debug("no damage for {}", getattr(module, "itemID", "?"))
        return None
    total = float(getattr(dps, "total", 0) or 0)
    if total <= 0:
        return None
    return {
        "kind": "damage",
        "dps": round(total, 2),
        "em": round(float(getattr(dps, "em", 0) or 0), 2),
        "thermal": round(float(getattr(dps, "thermal", 0) or 0), 2),
        "kinetic": round(float(getattr(dps, "kinetic", 0) or 0), 2),
        "explosive": round(float(getattr(dps, "explosive", 0) or 0), 2),
        "volley": round(float(getattr(volley, "total", 0) or 0), 1),
        "cycle": round(_cycle_seconds(module), 2),
    }


def _cap_drain_row(module):
    """Capacitor taken from the target: a neutralizer burns it, a nos keeps it."""
    amount = _attr(module, "energyNeutralizerAmount")
    nosferatu = False
    if amount == 0:
        # A nosferatu moves the capacitor to itself instead of burning it, and CCP
        # gives it a different attribute (`powerTransferAmount`, 10 GJ on a small II).
        amount = _attr(module, "powerTransferAmount")
        nosferatu = amount != 0
    if amount == 0:
        return None
    cycle = _cycle_seconds(module)
    row = {
        "kind": "capDrain",
        "nosferatu": nosferatu,
        "amount": round(abs(amount), 1),
        "perSecond": round(abs(amount) / cycle, 2) if cycle else 0.0,
        "cycle": round(cycle, 2),
    }
    return _with_range(row, module)


def _cap_transfer_row(module):
    """Capacitor a remote energy transfer pushes into a friendly ship."""
    amount = _attr(module, "energyTransferAmount")
    if amount == 0:
        return None
    cycle = _cycle_seconds(module)
    row = {
        "kind": "capTransfer",
        "amount": round(abs(amount), 1),
        "perSecond": round(abs(amount) / cycle, 2) if cycle else 0.0,
        "cycle": round(cycle, 2),
    }
    return _with_range(row, module)


def _repair_row(module):
    """Hit points a repairer restores, per cycle and per second.

    The same three attributes cover local and remote repairers; a module with a range
    is a remote one (a local repairer carries no range at all).
    """
    targets = (
        ("armor", _attr(module, "armorDamageAmount")),
        ("shield", _attr(module, "shieldBonus")),
        ("hull", _attr(module, "structureDamageAmount")),
    )
    target, amount = next(((name, value) for name, value in targets if value), ("", 0.0))
    if not target or amount == 0:
        return None
    cycle = _cycle_seconds(module)
    row = {
        "kind": "repair",
        "target": target,
        "remote": _optimal(module) > 0,
        "amount": round(abs(amount), 1),
        "perSecond": round(abs(amount) / cycle, 2) if cycle else 0.0,
        "cycle": round(cycle, 2),
    }
    return _with_range(row, module)


def _ecm_row(module):
    """Jam strength per sensor type: ``scanGravimetricStrengthBonus`` and its three siblings.

    A multispectral jammer carries the same number four times; a race-specific one (a
    ``Gravimetric ECM II``) is strong against its own race and weak against the rest, so
    the row keeps all four values and the card collapses them only when they agree.
    """
    values = {
        sensor: _attr(module, "scan{}StrengthBonus".format(sensor.capitalize()))
        for sensor in SENSOR_TYPES
    }
    if not any(values.values()):
        return None
    return {"kind": "ecm", "values": {sensor: round(value, 2) for sensor, value in values.items()}}


def _scrambler_row(module):
    """Warp disruption strength: what a warp scrambler or a point brings."""
    strength = _attr(module, "warpScrambleStrength")
    if strength == 0:
        return None
    return _with_range({"kind": "warpScrambler", "strength": round(abs(strength), 1)}, module)


def _web_row(module):
    """A negative speed factor: how much slower the target flies (percentages)."""
    factor = _attr(module, "speedFactor")
    if factor >= 0:
        return None
    return _with_range({"kind": "web", "speedFactor": round(factor, 1)}, module)


def _propulsion_row(module):
    """A speed factor above 100: the velocity multiplier a prop mod gives the hull."""
    factor = _attr(module, "speedFactor")
    if factor <= 100:
        return None
    return {"kind": "propulsion", "speedFactor": round(factor, 1)}


def _cap_boost_row(module):
    """A capacitor booster: the charge holds the capacitor, the module the cycle.

    The 3200 GJ of a Cap Booster 3200 lives on the *charge* (``capacitorBonus``); the
    booster itself only contributes its activation cycle. That cycle is the module's
    own ``duration`` (12.75 s for a Heavy F-RX) rather than
    ``getCycleParameters().averageTime``, which amortises the 10 s reload over the one
    charge the booster can hold and would report 22.75 s -- the pilot reads the number
    the module shows next to "activate", not the sustained figure.
    """
    if getattr(module, "charge", None) is None:
        return None
    try:
        amount = float(module.getModifiedChargeAttr("capacitorBonus", 0) or 0)
    except Exception:
        pyfalog.debug("no charge capacitor for {}", getattr(module, "itemID", "?"))
        return None
    if amount <= 0:
        return None
    cycle = _attr(module, "duration") / 1000.0 or _cycle_seconds(module)
    return {
        "kind": "capBoost",
        "amount": round(amount, 1),
        "cycle": round(cycle, 2),
        "perSecond": round(amount / cycle, 1) if cycle else 0.0,
    }


def _bonus_rows(module, item, dealsDamage):
    """The bonuses a module exists to provide, as rows of the card.

    Covers both halves of the game data: percentage bonuses (a tracking enhancer's +9.5%
    tracking, a damage mod's x1.1) and resistances, which come either as a negative
    percentage (membranes, hardeners) or as the resonance itself (a damage control).
    A weapon's own ``damageMultiplier`` is its ammunition multiplier, not a bonus, so it
    is skipped -- the damage row already says what it hits for.
    """
    rows = []
    effects = " ".join(getattr(item, "effects", {}) or ())

    for attribute, label, kind in BONUS_ATTRIBUTES:
        if attribute == "damageMultiplier" and dealsDamage:
            continue
        raw = _attr(module, attribute)
        if not raw:
            continue
        if kind == "multiplier":
            value = round((raw - 1.0) * 100, 1)
        elif kind == "flat":
            value = round(raw, 1)
        else:
            value = round(raw, 1)
        if value:
            rows.append({
                "kind": "bonus", "label": label, "value": value,
                "percent": kind != "flat",
            })

    rows.extend(_resistance_rows(module, effects))
    return rows


def _resistance_rows(module, effects):
    """One row per layer whose resistances this module improves."""
    rows = []

    # (1) A percentage on the module (membranes, hardeners): -20 means "+20% resistance".
    bonus = {kind: _attr(module, "{}DamageResistanceBonus".format(kind)) for kind in RESIST_TYPES}
    if any(bonus.values()):
        layer = "shield" if "Shield" in effects else "armor"
        rows.append(_resistance_row(layer, {kind: -bonus[kind] for kind in RESIST_TYPES}))

    # (2) The resonance itself (a damage control): 0.85 means 15% resistance.
    for layer in RESIST_LAYERS:
        values = {}
        for kind in RESIST_TYPES:
            resonance = _attr(module, "{}{}DamageResonance".format(layer, kind.capitalize()), 1.0)
            if resonance and resonance < 1.0:
                values[kind] = (1.0 - resonance) * 100
        if values:
            rows.append(_resistance_row(layer, values))

    return rows


def _resistance_row(layer, values):
    return {
        "kind": "resistances",
        "layer": layer,
        "values": {kind: round(values.get(kind, 0.0), 1) for kind in RESIST_TYPES},
    }


def module_effect(module):
    """The rows the hover card draws for one fitted module.

    Returns None for a module that is not there, and an empty ``rows`` list for one
    whose effect this does not model (a resistance plating, say) -- the card then just
    says what the module is.
    """
    if module is None or getattr(module, "isEmpty", True):
        return None

    item = getattr(module, "item", None)
    charge = getattr(module, "charge", None)

    rows = [row for row in (
        _cap_boost_row(module),
        _damage_row(module),
        _cap_drain_row(module),
        _cap_transfer_row(module),
        _repair_row(module),
        _ecm_row(module),
        _scrambler_row(module),
        _web_row(module),
        _propulsion_row(module),
    ) if row]
    # A weapon's range belongs right under its damage
    if rows and rows[0]["kind"] == "damage":
        optimal, falloff = _optimal(module), _falloff(module)
        if optimal or falloff:
            rows.insert(1, {"kind": "range", "optimal": round(optimal), "falloff": round(falloff)})
    elif not rows and _attr(module, "damageMultiplier") > 0:
        # An unloaded turret has no damage to show but still has a range. Modules that
        # report other rows carry their own range inside them, so this must not fire
        # for them (a neutralizer has a damageMultiplier attribute too).
        optimal, falloff = _optimal(module), _falloff(module)
        if optimal or falloff:
            rows.append({"kind": "range", "optimal": round(optimal), "falloff": round(falloff)})

    # The bonuses the module exists to provide (a plate, a membrane, a damage mod, a
    # scripted tracking computer -- one list covers all of them)
    dealsDamage = bool(rows) and rows[0]["kind"] == "damage"
    rows.extend(_bonus_rows(module, item, dealsDamage))

    # A module that takes charges but holds none is simply active: its numbers depend on
    # what is loaded (a cap booster without a charge restores nothing, a tracking
    # computer without a script is just the gun it boosts). The card says so in green
    # rather than pretending the module does nothing.
    if not rows and charge is None and module_accepts_charges(module):
        rows.append({"kind": "active"})

    return {
        "itemId": getattr(module, "itemID", None),
        "name": getattr(item, "name", None),
        "group": getattr(getattr(item, "group", None), "name", None),
        "state": None,
        #: Whether the module can be switched on at all: what tells a passive module
        #: (always running) from an active one (the pilot turns it on)
        "canActivate": bool(_can_activate(module)),
        "charge": (
            {"itemId": charge.ID, "name": charge.name, "amount": getattr(module, "numCharges", None)}
            if charge is not None else None
        ),
        "rows": rows,
    }


def _can_activate(module):
    try:
        return module.isValidState(FittingModuleState.ACTIVE)
    except Exception:
        return False
