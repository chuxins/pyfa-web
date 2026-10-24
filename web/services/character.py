"""Pilot characters for the fitting view.

The character strip lists the two skill presets every database has (All 5 and
All 0) plus the EVE characters the pilot has signed in with. ``web.auth`` stores
the SSO tokens as ``SsoCharacter`` rows in the user's own database; this module
makes sure a pyfa ``Character`` row exists for each one (the fit engine changes
fits to a *character*, not to SSO tokens) and keeps its skill sheet in sync
with EVE, mirroring what the desktop's ``gui/esiFittings.py`` ssoLogin handler
does.
"""

from logbook import Logger

import config as pyfaConfig
import eos.db
from eos.saveddata.character import Character as es_Character
from eos.saveddata.ssocharacter import SsoCharacter
from service.character import Character
from service.esi import Esi

pyfalog = Logger(__name__)


def list_characters(userData):  # noqa: ARG001
    """The characters the strip offers: the presets, then the signed-in pilots.

    Presets always exist (``Character.getAll5``/``getAll0`` create their rows on
    first use). SSO characters are the pyfa ``Character`` rows bound to the
    ``SsoCharacter`` rows this account has stored (see ``ensure_sso_character``).
    """
    all5 = es_Character.getAll5()
    all0 = es_Character.getAll0()
    characters = [
        {"id": all5.ID, "name": all5.name, "kind": "preset", "default": True},
        {"id": all0.ID, "name": all0.name, "kind": "preset", "default": False},
    ]
    for sso in sorted(_sso_characters(), key=lambda row: row.characterName.lower()):
        for char in sso.characters:
            characters.append({
                "id": char.ID,
                "name": char.name,
                "kind": "sso",
                "default": False,
            })
    return characters


def ensure_sso_character(userData, character_id, character_name, server_name):  # noqa: ARG001
    """The Character row behind an SSO login, with a fresh skill sheet.

    Called from the SSO callback so the pilot's own character appears in the
    strip right away and its fits use real skills. EVE being unreachable or
    the skill scope missing must not fail the login: the row stays (skills
    fall back to the previous sheet, or to an empty one on first login) and
    the problem is only logged.
    """
    sChar = Character.getInstance()
    char = sChar.getCharacter(character_name)
    if char is None:
        char = sChar.new(character_name)

    client_hash = pyfaConfig.getClientSecret()
    sso = eos.db.saveddata_session.query(SsoCharacter).filter(
        SsoCharacter.characterID == int(character_id),
        SsoCharacter.client == client_hash,
        SsoCharacter.server == server_name,
    ).first()
    if sso is not None:
        # Signing in again must not re-bind the pilot: ``setSsoCharacter`` appends
        # to the Character's sso list, and HandledSsoCharacterList.append responds
        # to a repeat by dropping and re-adding the same row -- which the flush then
        # runs against the still-present ssoCharacterMap row and trips its unique
        # constraint. The map row from the first login already exists, so there is
        # nothing to bind; skip it and keep the commit (no-op) for a clean session.
        if char.getSsoCharacter(client_hash) is None:
            char.setSsoCharacter(sso, client_hash)
        eos.db.commit()

    _refresh_skills(char)
    return char.ID


def _sso_characters():
    """The SSO characters of the bound database (this client's only)."""
    return eos.db.getSsoCharacters(pyfaConfig.getClientSecret())


def _refresh_skills(char):
    """Fetch the pilot's skills from EVE into the Character row.

    Kept separate from :func:`ensure_sso_character` so the login never fails
    because EVE was slow or the skill scope was missing.
    """
    try:
        sso = Character.getInstance().getSsoCharacter(char.ID)
        if sso is None:
            return
        sheet = Esi.getInstance().getSkills(sso.ID)
        sec = Esi.getInstance().getSecStatus(sso.ID)
        # EVE answers the skills endpoint with ``skill_id``/``trained_skill_level``
        # (the same rows the desktop's skill import feeds the sheet with), while the
        # sheet builder wants ``typeID``/``level`` -- translate, or the pilot's row
        # comes back empty and every fit on that character is an all-zero fit.
        rows = [
            {"typeID": row["skill_id"], "level": row["trained_skill_level"]}
            for row in sheet.get("skills", [])
        ]
        char.apiUpdateCharSheet(rows, sec.get("security_status", 0.0))
        # ``apiUpdateCharSheet`` only fills the character's in-memory skill
        # collection; for a character that is already persisted, SQLAlchemy does
        # not cascade those appends into the session (it warns and skips the add),
        # so the commit alone would write nothing. Add the new rows explicitly.
        for skill in char.skills:
            eos.db.saveddata_session.add(skill)
        eos.db.commit()
    except Exception as ex:
        pyfalog.warn("Could not refresh skills for {}: {}", char.name, ex)
        eos.db.commit()
