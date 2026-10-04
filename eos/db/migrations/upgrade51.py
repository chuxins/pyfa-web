"""
Migration 51

- added ``fromGame`` / ``importedToGame`` flags to ``fits``: the web refuses to delete
  a fit that came out of the EVE client, or that was saved into it (see web/api/fits.py)
"""


def upgrade(saveddata_engine):
    saveddata_engine.execute("ALTER TABLE fits ADD COLUMN fromGame BOOLEAN NOT NULL DEFAULT 0")
    saveddata_engine.execute("ALTER TABLE fits ADD COLUMN importedToGame BOOLEAN NOT NULL DEFAULT 0")
