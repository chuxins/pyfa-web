"""A pilot character's implant list: ESI truth, local edits, and what a fit applies.

The implant simulator in the top bar shows the implants of the character the
pilot picks and lets them add and remove implants to see how the fit changes.
Two distinct implant stores already exist in pyfa:

* ``fit.implants`` -- implants saved on one fit (``implantLocation == FIT``);
* ``character.implants`` -- the implants on the *character* itself, used by every
  fit whose implant location is ``CHARACTER``. This is the same list the desktop
  character editor edits (``Character.addImplant``/``removeImplant``) and it is
  persisted in the pilot's own ``saveddata.db``.

This module works on the character store. ESI's implants endpoint reports the
implants the pilot's clone actually carries; that list is pulled in with
:func:`sync_from_esi` and becomes the baseline. Implants the pilot adds by hand
are kept as simulation extras and survive a re-sync, while deleting an implant
that came from ESI is remembered too, so a refresh does not put it straight
back. The source of every ESI implant is tracked in a small web-only table next
to pyfa's own schema (the same arrangement as ``web.services.customskills``)::

    CREATE TABLE charImplantSets (
        characterID INTEGER NOT NULL,
        itemID      INTEGER NOT NULL,
        PRIMARY KEY (characterID, itemID)
    )

Rows in the table are the implants the last ESI sync reported the clone as
carrying in game -- the baseline, independent of what is currently fitted to
the character. A character implant that has no row is a locally added
simulation implant. An id that has a row but is no longer on the character was
deliberately removed to simulate flying without it: the refresh leaves it off
while the clone still carries it, and only re-adds it once the game itself has
stopped reporting it (the row clears) and later reports it again, i.e. the
pilot actually re-implanted.
"""

import eos.db
from logbook import Logger
from sqlalchemy import text

pyfalog = Logger(__name__)

TABLE_NAME = "charImplantSets"

_CREATE = text(
    """
    CREATE TABLE IF NOT EXISTS {name} (
        characterID INTEGER NOT NULL,
        itemID      INTEGER NOT NULL,
        PRIMARY KEY (characterID, itemID)
    )
    """.format(name=TABLE_NAME)
)


def ensure_table():
    """Create the web-only source table when it does not exist yet (idempotent).

    Called once per opened user database (see ``web.userdata``) and lazily by
    every function below, so tests and admin imports work without that path.
    """
    eos.db.saveddata_session.execute(_CREATE)
    eos.db.saveddata_session.commit()


def get_character(character_id):
    """The saveddata ``Character`` row, or None when the id is unknown."""
    from service.character import Character

    return Character.getCharacter(character_id)


def _esi_rows(character_id):
    """The item ids the last ESI sync recorded for this character."""
    rows = eos.db.saveddata_session.execute(
        text("SELECT itemID FROM {name} WHERE characterID = :c".format(name=TABLE_NAME)),
        {"c": character_id},
    ).fetchall()
    return {int(row[0]) for row in rows}


def _replace_esi_rows(character_id, item_ids):
    """Write down the set ESI currently reports (the game's own implants)."""
    session = eos.db.saveddata_session
    session.execute(
        text("DELETE FROM {name} WHERE characterID = :c".format(name=TABLE_NAME)),
        {"c": character_id},
    )
    for item_id in sorted(item_ids):
        session.execute(
            text(
                "INSERT OR IGNORE INTO {name} (characterID, itemID) VALUES (:c, :i)".format(
                    name=TABLE_NAME)
            ),
            {"c": character_id, "i": item_id},
        )
    session.commit()


def _serialize_item(item):
    from web.services.serialize import serialize_item

    return serialize_item(item)


def list_implants(character):
    """The character's implants, sorted by slot, each tagged with its source.

    ``source`` is ``"esi"`` for an implant the last ESI sync reported in game
    and ``"custom"`` for one added locally. Slot 0 implants sort first.
    """
    ensure_table()
    esi_ids = _esi_rows(character.ID)
    rows = []
    for implant in sorted(character.implants, key=lambda imp: (imp.slot or 0, imp.itemID)):
        rows.append({
            "itemId": implant.itemID,
            "item": _serialize_item(implant.item),
            "slot": implant.slot,
            "active": bool(implant.active),
            "source": "esi" if implant.itemID in esi_ids else "custom",
        })
    return {"id": character.ID, "name": character.name, "implants": rows}


def add_implant(character, item_id):
    """Add one implant type to the character.

    Mirrors ``Character.addImplant`` (the desktop character editor's own path):
    same-slot implants make room for the newcomer. Refuses items that are not
    implants; presets (All 5 / All 0) accept implants too -- their skill sheet is
    read-only, but the implant list is simulation data like any other pilot's and
    lives in the caller's own database. Returns False when the implant was
    already present, True when it was added.
    """
    ensure_table()

    item = eos.db.getItem(item_id)
    if item is None or not getattr(item, "isImplant", False):
        raise ValueError("not an implant")

    if any(implant.itemID == item_id for implant in character.implants):
        return False

    from eos.saveddata.implant import Implant

    implant = Implant(item)
    character.implants.makeRoom(implant)
    character.implants.append(implant)
    eos.db.commit()
    return True


def remove_implant(character, item_id):
    """Remove one implant from the character.

    The implant's ESI source row is deleted as well, so a later sync does not
    re-add an implant the pilot removed on purpose: the local edit is a
    simulation decision until the game itself reports the implant again.
    Presets can be edited here just like any other character: only their skill
    sheet is read-only. Returns False when the character did not carry it.
    """
    ensure_table()

    target = next((implant for implant in character.implants if implant.itemID == item_id), None)
    if target is None:
        return False

    character.implants.remove(target)
    # Keep the ESI marker (if any): it records what the clone carries in game,
    # which the pilot is overriding locally. A refresh therefore knows not to
    # re-add a deliberately simulated-away implant while the clone still carries
    # it; the marker only goes when ESI itself stops reporting it.
    eos.db.commit()
    return True


class EsiImplantError(Exception):
    """The implants could not be pulled from EVE, with a code the UI translates."""

    def __init__(self, code, message, status=502, params=None):
        super().__init__(message)
        self.code = code
        self.status = status
        self.params = dict(params or {})


def _esi():
    from service.esi import Esi

    return Esi.getInstance()


def sync_from_esi(character, sso_row):
    """Pull the implants ESI reports for ``sso_row`` and reconcile the character.

    The game's list is the baseline: implants ESI reports but the character does
    not have are added, implants ESI no longer reports (and that carried an ESI
    tag) are removed. Locally added simulation implants are left untouched.

    Returns the new list payload (same shape as :func:`list_implants`). Raises
    :class:`EsiImplantError` when the token lacks the implants scope
    (``missingScope``: the pilot must sign in again and approve it), the stored
    login is no longer accepted, EVE is unreachable, or the answer is unusable.
    """
    import requests
    from cryptography.fernet import InvalidToken
    from service.esiAccess import APIException, GenericSsoError

    ensure_table()
    try:
        payload = _esi().getImplants(sso_row.ID)
    except APIException as ex:
        status = getattr(ex, "status_code", None)
        if status in (403, 400):
            # A token issued before the implants scope was requested answers the
            # clones endpoint with 403. The login itself is still good; the pilot
            # just has to re-authorise with the extra scope.
            raise EsiImplantError(
                "missingScope",
                "The login does not include permission to read implants from EVE; "
                "sign in with EVE again and approve the clone implants scope.",
                status=403) from ex
        raise EsiImplantError(
            "esiRefused", "EVE refused to hand over the implants: {}".format(ex),
            params={"reason": str(ex)}) from ex
    except (GenericSsoError, InvalidToken) as ex:
        # GenericSsoError covers a refresh EVE rejects; InvalidToken is raised when
        # the stored refresh token cannot even be decrypted with this client's key
        # (a row imported from another deployment, say). Both mean: sign in again.
        raise EsiImplantError(
            "tokenRefused", "EVE did not accept the stored login: {}".format(ex),
            status=409) from ex
    except requests.exceptions.RequestException as ex:
        raise EsiImplantError(
            "esiUnreachable", "EVE could not be reached: {}".format(ex)) from ex

    # An expired access token was refreshed on the way through; persist it.
    eos.db.save(sso_row)

    if not isinstance(payload, list):
        raise EsiImplantError(
            "esiUnusable", "EVE did not answer with a list of implants", status=500)

    esi_item_ids = set()
    valid_items = {}
    for row in payload:
        item_id = row.get("type_id") if isinstance(row, dict) else None
        if not isinstance(item_id, int):
            continue
        item = eos.db.getItem(item_id)
        if item is None or not getattr(item, "isImplant", False):
            continue
        esi_item_ids.add(item_id)
        valid_items[item_id] = item

    from eos.saveddata.implant import Implant

    current_ids = {implant.itemID for implant in character.implants}
    previous_esi = _esi_rows(character.ID)
    # The implants the pilot deliberately removed locally even though the clone
    # still carries them: marked on the previous pull, absent from the character
    # list. They stay simulated away.
    locally_removed = previous_esi - current_ids

    # Drop implants that came from ESI but are gone in game now. Locally added
    # implants (never recorded in the source table) are kept.
    for implant in list(character.implants):
        if implant.itemID in previous_esi and implant.itemID not in esi_item_ids:
            character.implants.remove(implant)

    # Add implants newly reported by ESI, skipping implants the pilot removed on
    # purpose while the clone still had them (those stop being skipped once the
    # game itself no longer reports the implant -- the marker is then gone and a
    # later re-implantation adds it afresh). makeRoom handles a same-slot clash
    # with a local simulation implant, which yields to the in-game truth.
    for item_id in esi_item_ids:
        if item_id in locally_removed and item_id in previous_esi:
            continue
        if item_id not in current_ids:
            implant = Implant(valid_items[item_id])
            character.implants.makeRoom(implant)
            character.implants.append(implant)

    eos.db.commit()
    _replace_esi_rows(character.ID, esi_item_ids)
    return list_implants(character)


