"""Per-fit custom skill pins, stored in the owner's ``saveddata.db``.

The desktop database knows nothing about this feature, so the pins live in a
small web-only table next to pyfa's own schema::

    CREATE TABLE fitCustomSkills (
        fitID    INTEGER NOT NULL,
        skillID  INTEGER NOT NULL,
        position INTEGER NOT NULL,
        PRIMARY KEY (fitID, skillID)
    )

There is deliberately no foreign key to ``fits``: pyfa's own tables do not
enable foreign-key enforcement for this relation either, and keeping the table
free-standing means importing, deleting or restoring fits through the desktop
schema never blocks on the web table. Orphaned rows after a fit is deleted are
harmless (they only surface through the fit's own id) and cheap to ignore.

The table is created on demand by :func:`ensure_table`, which the user
database open path also calls once so normal requests never pay the check.
"""

from sqlalchemy import text

import eos.db

TABLE_NAME = "fitCustomSkills"

_CREATE = text(
    """
    CREATE TABLE IF NOT EXISTS {name} (
        fitID    INTEGER NOT NULL,
        skillID  INTEGER NOT NULL,
        position INTEGER NOT NULL,
        PRIMARY KEY (fitID, skillID)
    )
    """.format(name=TABLE_NAME)
)


def ensure_table():
    """Create the web-only table when it does not exist yet (idempotent).

    The user database open path already calls this once per database; the
    function stays here for code paths (tests, admin imports) that use a
    session without going through that open path.
    """
    eos.db.saveddata_session.execute(_CREATE)
    eos.db.saveddata_session.commit()


def list_custom(fit_id):
    """Pinned skill ids of one fit, in the order they were added."""
    rows = eos.db.saveddata_session.execute(
        text("SELECT skillID FROM {name} WHERE fitID = :f ORDER BY position".format(name=TABLE_NAME)),
        {"f": fit_id},
    ).fetchall()
    return [row[0] for row in rows]


def add_custom(fit_id, skill_id):
    """Pin one skill to a fit. Returns False when it was already pinned."""
    session = eos.db.saveddata_session
    existing = session.execute(
        text("SELECT 1 FROM {name} WHERE fitID = :f AND skillID = :s".format(name=TABLE_NAME)),
        {"f": fit_id, "s": skill_id},
    ).first()
    if existing is not None:
        return False
    next_position = session.execute(
        text("SELECT COALESCE(MAX(position) + 1, 0) FROM {name} WHERE fitID = :f".format(name=TABLE_NAME)),
        {"f": fit_id},
    ).scalar()
    session.execute(
        text("INSERT INTO {name} (fitID, skillID, position) VALUES (:f, :s, :p)".format(name=TABLE_NAME)),
        {"f": fit_id, "s": skill_id, "p": next_position},
    )
    session.commit()
    return True


def remove_custom(fit_id, skill_id):
    """Unpin one skill from a fit. Returns False when it was not pinned."""
    session = eos.db.saveddata_session
    result = session.execute(
        text("DELETE FROM {name} WHERE fitID = :f AND skillID = :s".format(name=TABLE_NAME)),
        {"f": fit_id, "s": skill_id},
    )
    session.commit()
    return result.rowcount > 0


def search_skills(query, limit=20, exclude_ids=()):
    """Search the game data for skill types by (localised) name.

    Wraps ``eos.db.searchSkills`` (already restricted to category 16 and the
    active name column) with a tighter limit, an unpublished filter and an
    exclusion set so the add-skill autocomplete does not suggest pins that are
    already on the fit.
    """
    from eos.db.gamedata.queries import searchSkills

    excluded = set(exclude_ids)
    result = []
    for item in searchSkills(query):
        if not getattr(item, "published", True):
            continue
        if item.ID in excluded:
            continue
        result.append(item)
        if len(result) >= limit:
            break
    return result
