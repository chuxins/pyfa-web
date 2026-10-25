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
"""

from logbook import Logger

pyfalog = Logger(__name__)

#: Below this the value is the attribute's "no range" default rather than a range.
RANGE_FLOOR = 1000.0


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
        _damage_row(module),
        _cap_drain_row(module),
        _cap_transfer_row(module),
        _repair_row(module),
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

    return {
        "itemId": getattr(module, "itemID", None),
        "name": getattr(item, "name", None),
        "group": getattr(getattr(item, "group", None), "name", None),
        "charge": (
            {"itemId": charge.ID, "name": charge.name, "amount": getattr(module, "numCharges", None)}
            if charge is not None else None
        ),
        "rows": rows,
    }
