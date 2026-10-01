"""The strings pyfa generates, in the language the server runs as.

Game data text comes from `eve.db`'s per-language columns (see `display_name` in
`web/services/serialize.py`), and pyfa's own strings come from its catalogue. That
catalogue is checked out as the `.po` sources it is written in and `*.mo` -- the compiled
form wxWidgets loads -- is a build artifact this deployment has none of, so
`pyfa_compat.wx_headless` reads the sources. Without that, everything pyfa says itself
stays English: the ship browser's "Limited Issue Ships" group is one the browser shows.
"""

from pathlib import Path

import pytest

from pyfa_compat import wx_headless

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
LOCALE_DIR = REPO_ROOT / "locale"


@pytest.fixture
def catalogs():
    """Configure the shim for one test, then put back what was configured before.

    The catalogue is process-wide state (the server configures it once at startup), so a
    test that changes it has to hand it back as it found it.
    """
    previous = (wx_headless._LOCALE_DIR, wx_headless._LANGUAGE, wx_headless._translation)

    def configure(locale_dir, language):
        return wx_headless.configure_i18n(locale_dir=str(locale_dir), language=language)

    yield configure

    (wx_headless._LOCALE_DIR, wx_headless._LANGUAGE, wx_headless._translation) = previous


def test_the_shipped_chinese_catalogue_translates_pyfa_strings(catalogs):
    """The name of the browser's synthetic group is a pyfa string, not game data."""
    assert catalogs(LOCALE_DIR, "zh_CN") is not None

    assert wx_headless.GetTranslation("Limited Issue Ships") == "限量版舰船"


def test_an_untranslated_string_is_its_own_translation(catalogs):
    catalogs(LOCALE_DIR, "zh_CN")

    assert wx_headless.GetTranslation("No catalogue has this") == "No catalogue has this"


def test_a_language_with_an_incomplete_catalogue_falls_back_per_string(catalogs):
    """`it_IT` is checked out, but the entry pyfa has no Italian for comes back as it is."""
    assert catalogs(LOCALE_DIR, "it_IT") is not None

    assert wx_headless.GetTranslation("Misc") == "Misc"


def test_a_language_without_a_catalogue_at_all_is_the_identity(catalogs):
    """What wxWidgets does for a missing catalog, and what the shim must keep doing."""
    assert catalogs(LOCALE_DIR, "xx_XX") is None

    assert wx_headless.GetTranslation("Limited Issue Ships") == "Limited Issue Ships"


def test_a_catalogue_is_read_the_way_gettext_writes_it(tmp_path, catalogs):
    """Multi-line strings, escapes, plural forms, the header, and fuzzy entries left out.

    A fuzzy msgstr is a translation a translator has not confirmed, and msgfmt leaves
    those out of the catalog it compiles, so the reader has to drop them too.
    """
    catalog_dir = tmp_path / "xy_XY" / "LC_MESSAGES"
    catalog_dir.mkdir(parents=True)
    (catalog_dir / "lang.po").write_text(
        'msgid ""\n'
        'msgstr ""\n'
        '"Content-Type: text/plain; charset=UTF-8\\n"\n'
        '\n'
        '#: service/market.py:266\n'
        'msgid "Limited Issue Ships"\n'
        'msgstr "限量版舰船"\n'
        '\n'
        'msgid "One"\n'
        '" line, then "\n'
        'msgstr "一行，然后\\n第二行"\n'
        '\n'
        'msgid "%d skill point"\n'
        'msgid_plural "%d skill points"\n'
        'msgstr[0] "%d 技能点"\n'
        '\n'
        '#, fuzzy\n'
        'msgid "A guess"\n'
        'msgstr "一个猜测"\n',
        encoding="utf-8",
    )

    assert catalogs(tmp_path, "xy_XY") is not None

    assert wx_headless.GetTranslation("Limited Issue Ships") == "限量版舰船"
    assert wx_headless.GetTranslation("One line, then ") == "一行，然后\n第二行"
    assert wx_headless.GetTranslation("%d skill point") == "%d 技能点"
    # The header block describes the catalog rather than translating a string
    assert wx_headless.GetTranslation("Content-Type: text/plain; charset=UTF-8\n") == \
        "Content-Type: text/plain; charset=UTF-8\n"
    assert wx_headless.GetTranslation("A guess") == "A guess"
