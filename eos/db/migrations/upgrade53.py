"""
Migration 53

- added ``draft`` to ``fits``: a fit that came from the browser's "import from
  clipboard" and has not been saved yet. Such a row is opened directly instead of
  being added to the library -- it is hidden from every fit listing until the user
  clicks Save, and deleted when the user discards it (see web/services/port.py,
  web/api/commands.py and eos/db/saveddata/queries.py).
"""


def upgrade(saveddata_engine):
    saveddata_engine.execute("ALTER TABLE fits ADD COLUMN draft BOOLEAN NOT NULL DEFAULT 0")
