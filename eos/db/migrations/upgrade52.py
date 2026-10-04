"""
Migration 52

- added ``esiFittingId`` to ``fits``: the id EVE assigned a fitting. A fit the game
  also holds (imported from it, or saved into it) is now deletable from the web,
  and this id is what tells the game's list which fitting to delete alongside the
  web's row (see web/api/fits.py and web/services/esiFittings.py).
"""


def upgrade(saveddata_engine):
    saveddata_engine.execute("ALTER TABLE fits ADD COLUMN esiFittingId INTEGER")
