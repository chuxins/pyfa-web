"""Fit import and export, reusing pyfa's ``service.port`` headless.

The desktop reaches these through clipboard callbacks and threads; the web calls
them synchronously (M0 pinned down that every ``callback`` parameter is optional
and returns the text instead). What this module adds on top is only what a
server needs:

* importing pasted / uploaded text, either as new fits (saved like the desktop's
  paste does) or applied to an existing fit through the undoable command stack;
* exporting a saved fit in every text format the desktop offers;
* the XML backup/restore round trip, and parsing mutated-item strings.

Known web-side limits recorded in the design doc: ``optimizePrices`` routes
through ``Price.getPrices``/``PriceWorkerThread`` which has no saveddata context
here (M0), so it is refused until the P2 price work lands; HTML export is
wx-bound in the desktop and is implemented by the frontend instead.
"""

import re
from datetime import date

from logbook import Logger

from web.services.serialize import serialize_fit_summary

pyfalog = Logger(__name__)

#: importAuto importType -> the ``format`` value the API answers with
FORMAT_MAP = {
    "EFT": "eft",
    "EFT Config": "eftConfig",
    "XML": "xml",
    "JSON": "esiJson",
    "DNA": "dna",
    "DNA-alt": "dnaAlt",
    "FittingItem": "mutant",
    "AdditionsDrones": "drones",
    "AdditionsFighters": "fighters",
    "AdditionsImplants": "implants",
    "AdditionsBoosters": "boosters",
    "AdditionsCargo": "cargo",
}

#: importTypes that mean "items to put into the given fit", not a new fit
ADDITIONS_TYPES = frozenset((
    "FittingItem", "AdditionsDrones", "AdditionsFighters",
    "AdditionsImplants", "AdditionsBoosters", "AdditionsCargo"))

#: The export formats this server can produce. HTML is a frontend concern (the
#: desktop implementation is wx-bound), and optimizePrices is P2 (price worker).
EXPORT_FORMATS = frozenset(("eft", "dna", "multibuy", "shipstats", "efs", "esiJson"))

_FILENAME_BAD = re.compile(r'[^A-Za-z0-9._\-\u4e00-\u9fff ]')


class PortError(Exception):
    """A client mistake while importing/exporting.

    ``code`` is one of the design-doc error vocabulary (importUnreadable,
    importUnsupported, exportUnsupported, ...) and ``status`` the HTTP status.
    """

    def __init__(self, code, message, status=400):
        super().__init__(message)
        self.code = code
        self.status = status

    def detail(self):
        return {"message": str(self), "code": self.code}


def _service_fit():
    from service.fit import Fit

    return Fit.getInstance()


def _save_imported_fits(fits, draft=False):
    """Persist fits exactly like the desktop paste path (importFitFromBuffer).

    Sets the caller's character / damage pattern / target profile and the
    implant-location default before ``db.save``.

    ``draft=True`` writes the rows already marked as "not saved yet": the insert
    carries ``fits.draft = 1`` from the start, so the fit is never briefly visible
    as a library fit (see :func:`import_text` and eos/db/saveddata/queries.py).
    """
    from eos.const import ImplantLocation

    import eos.db

    sFit = _service_fit()
    for fit in fits:
        if fit is None:
            continue
        fit.character = sFit.character
        fit.damagePattern = sFit.pattern
        fit.targetProfile = sFit.targetProfile
        if len(fit.implants) > 0:
            fit.implantLocation = ImplantLocation.FIT
        else:
            useCharImplants = sFit.serviceFittingOptions["useCharacterImplantsByDefault"]
            fit.implantLocation = ImplantLocation.CHARACTER if useCharImplants else ImplantLocation.FIT
        fit.draft = draft
        eos.db.save(fit)
    return fits


def purge_draft_fits(keep=()):
    """删掉这一次会话里还没保存的导入草稿（换一份导入时调用）。

    草稿只在「导入 → 看/改 → 保存」这段时间有意义，换一份新的导入时旧的就没用了；
    留着只会占库（虽然它们不出现在任何列表里）。``keep`` 里的装配 id 是要保留的，
    也就是刚导入的那几份 —— 先建后删，这样新草稿不会捡到旧草稿释放出来的 id。
    """
    import eos.db

    keep = set(keep)
    drafts = [fit for fit in eos.db.getDraftFits() if fit.ID not in keep]
    if not drafts:
        return 0
    sFit = _service_fit()
    for fit in drafts:
        sFit.deleteFit(fit.ID)
    eos.db.commit_now()
    return len(drafts)


def import_text(text, target_fit_id=None, userData=None, channel=None, save=True):
    """Import ``text``, desktop paste semantics.

    Without ``target_fit_id`` every recognised fit is saved as new. With one,
    item-level text (mutated module, drones, implants, ...) is applied to that
    fit through the undoable command stack; a whole-fit text still creates new
    fits, exactly like the desktop paste into an open fit does.

    ``save=False`` turns the import into a *draft*: the browser's "import from
    clipboard" opens the pasted fit directly instead of adding it to the library.
    A new fit is still written to the database (it needs an id to be opened,
    edited and undone), but from the very first insert it carries ``fits.draft``,
    which keeps it out of every fit listing, search and backup until the user
    clicks Save; discarding deletes the row (eos/db/saveddata/queries.py,
    web/api/commands.py). Item-level text pasted onto an open fit has no row of its
    own, so it keeps using the plain "uncommitted edits" draft (``defer_commit``)
    that the editing commands use.
    """
    import xml.parsers.expat

    from service.port.port import Port

    if not text or not text.strip():
        raise PortError("importUnreadable", "nothing to import")

    if target_fit_id is not None:
        fit = _service_fit().getFit(target_fit_id)
        if fit is None:
            raise PortError("importUnreadable", "fit not found", status=404)

    context = getattr(userData, "context", None)

    try:
        result = Port.importAuto(text, activeFit=target_fit_id)
    except xml.parsers.expat.ExpatError:
        raise PortError("importUnreadable", "malformed XML in import text")
    except (KeyboardInterrupt, SystemExit):
        raise
    except Exception as ex:
        pyfalog.warning("Import failed: {}", ex)
        raise PortError("importUnreadable", "{}: {}".format(type(ex).__name__, ex))

    if result is None:
        raise PortError("importUnsupported", "no importable fit format recognised")
    import_type, makes_new_fits, import_data = result

    if target_fit_id is not None and import_type in ADDITIONS_TYPES:
        if not save and context is not None:
            # 只改内存：命令里的 commit 被降级成 flush，等用户点保存才落盘
            context.defer_commit = True
        applied = _apply_to_fit(import_type, import_data, target_fit_id, userData, channel)
        if not save and context is not None:
            context.draft_fit_id = target_fit_id
        return {"format": FORMAT_MAP[import_type], "created": [],
                "appliedToFitId": target_fit_id, "skipped": applied["skipped"]}

    imported = _save_imported_fits(import_data, draft=not save)
    created = [serialize_fit_summary(f) for f in imported]
    if not save:
        # 新的剪贴板导入取代上一份还没保存的导入（先建后删，免得 id 被复用）
        purge_draft_fits(keep=[fit.ID for fit in imported])
    if not save and context is not None and created:
        # 打开的就是第一个新建的装配，所以只有它被标成「未保存」
        context.draft_fit_id = created[0]["id"]
    elif save:
        import eos.db

        eos.db.commit_now()
    return {"format": FORMAT_MAP.get(import_type, import_type), "created": created,
            "appliedToFitId": None, "skipped": []}


def _apply_to_fit(import_type, import_data, fit_id, userData, channel):
    """Put item-level import data into ``fit_id`` through the undo stack.

    Mirrors ``gui/mainFrame.importFromClipboard``: the same ``Gui*Command``
    classes the desktop submits are used, so the import is one undo step.
    """
    from web.events import publishing_as
    from web.services import commands as commandService

    def cmd():
        import gui.fitCommands as fitCommands

        return fitCommands

    payload = import_data[0]
    if import_type == "FittingItem":
        base_item, mutaplasmid_item, mutations = payload
        if mutaplasmid_item is not None:
            if base_item.isDrone:
                command = cmd().GuiImportLocalMutatedDroneCommand(
                    fit_id, base_item, mutaplasmid_item, mutations, amount=1)
            else:
                command = cmd().GuiImportLocalMutatedModuleCommand(
                    fit_id, base_item, mutaplasmid_item, mutations)
        else:
            command = cmd().GuiAddLocalModuleCommand(fit_id, base_item.ID)
    else:
        gui_name = {
            "AdditionsDrones": "GuiImportLocalDronesCommand",
            "AdditionsFighters": "GuiImportLocalFightersCommand",
            "AdditionsImplants": "GuiImportImplantsCommand",
            "AdditionsBoosters": "GuiImportBoostersCommand",
            "AdditionsCargo": "GuiImportCargosCommand",
        }[import_type]
        items = [(i.ID, a, m) for i, a, m in payload]
        command = getattr(cmd(), gui_name)(fit_id, items)

    processor = commandService.processor_for(userData, fit_id)
    with publishing_as(channel):
        success = processor.Submit(command)
    if not success:
        raise PortError("importPartial", "the fit refused the imported items", status=409)
    return {"skipped": []}


def _safe_filename(name, ext):
    """A download filename safe for browsers: alphanumerics plus a few extras."""
    cleaned = _FILENAME_BAD.sub("_", name).strip(" ._") or "fit"
    return "{}.{}".format(cleaned, ext)


def export_fit(fit_id, format, options=None):
    """Export a saved fit as text. Returns ``(content, filename, content_type)``.

    The fit comes from ``getFit`` (reloaded from the database, so the in-memory
    ``EmptyModule`` padding from ``fill()`` is not walked -- see design risk #8).
    """
    from service.const import PortDnaOptions, PortEftOptions, PortMultiBuyOptions
    from service.port.efs import EfsPort
    from service.port.port import Port

    options = options or {}
    fit = _service_fit().getFit(fit_id)
    if fit is None:
        raise PortError("importUnreadable", "fit not found", status=404)
    if format not in EXPORT_FORMATS:
        raise PortError("exportUnsupported", "export format {!r} is not available".format(format))

    if format == "eft":
        content = Port.exportEft(fit, {
            PortEftOptions.IMPLANTS: bool(options.get("implants", True)),
            PortEftOptions.MUTATIONS: True,
            PortEftOptions.LOADED_CHARGES: bool(options.get("charges", True)),
            PortEftOptions.CARGO: bool(options.get("cargo", True)),
            PortEftOptions.BOOSTERS: bool(options.get("boosters", True)),
        })
        return content, _safe_filename(fit.name, "txt"), "text/plain"
    if format == "dna":
        content = Port.exportDna(fit, {
            PortDnaOptions.FORMATTING: bool(options.get("formatting", False))})
        return content, _safe_filename(fit.name, "txt"), "text/plain"
    if format == "multibuy":
        if options.get("optimizePrices"):
            raise PortError(
                "exportUnsupported",
                "optimizePrices needs the price worker, which is not wired up yet (P2)")
        content = Port.exportMultiBuy(fit, {
            PortMultiBuyOptions.LOADED_CHARGES: bool(options.get("charges", True)),
            PortMultiBuyOptions.CARGO: bool(options.get("cargo", True)),
            PortMultiBuyOptions.IMPLANTS: bool(options.get("implants", True)),
            PortMultiBuyOptions.BOOSTERS: bool(options.get("boosters", True)),
            PortMultiBuyOptions.OPTIMIZE_PRICES: False,
        })
        return content, _safe_filename(fit.name, "txt"), "text/plain"
    if format == "shipstats":
        content = Port.exportFitStats(fit)
        return content, _safe_filename(fit.name, "txt"), "text/plain"
    if format == "efs":
        content = EfsPort.exportEfs(fit, 0, None)
        return content, _safe_filename(fit.name, "json"), "application/json"
    if format == "esiJson":
        content = Port.exportESI(
            fit,
            exportCharges=bool(options.get("charges", True)),
            exportImplants=bool(options.get("implants", True)),
            exportBoosters=bool(options.get("boosters", True)))
        return content, _safe_filename(fit.name, "json"), "application/json"
    raise PortError("exportUnsupported", "export format {!r} is not available".format(format))


def export_backup():
    """All the caller's fits as one XML document (desktop backup semantics)."""
    from service.port.port import Port

    fits = _service_fit().getAllFits()
    content = Port.exportXml(fits, None)
    filename = "pyfa-backup-{}.xml".format(date.today().isoformat())
    return content, filename


def import_backup(text):
    """Restore fits from a backup XML; returns the number of fits saved."""
    import xml.parsers.expat

    from service.port.port import Port

    if not text or not text.strip():
        raise PortError("importUnreadable", "nothing to import")
    try:
        fits = Port.importXml(text, None)
    except xml.parsers.expat.ExpatError:
        raise PortError("importUnreadable", "malformed XML in backup")
    except (KeyboardInterrupt, SystemExit):
        raise
    except Exception as ex:
        pyfalog.warning("Backup import failed: {}", ex)
        raise PortError("importUnreadable", "{}: {}".format(type(ex).__name__, ex))
    saved = [f for f in _save_imported_fits(fits) if f is not None]
    return {"imported": len(saved)}


def parse_mutant(text):
    """Parse a mutated-item paste; returns a JSON-safe description or raises.

    Network-linked item links (``<url=showinfo:...>``) cannot be resolved
    without an ESI round trip; only the local text form is supported here.
    """
    from service.port.muta import parseMutant

    if not text or not text.strip():
        raise PortError("importUnreadable", "nothing to parse")
    lines = text.splitlines()
    try:
        base_item, mutaplasmid_item, mutations = parseMutant(lines)
    except Exception as ex:
        pyfalog.warning("Mutant parse failed: {}", ex)
        raise PortError("importUnreadable", "{}: {}".format(type(ex).__name__, ex))
    if base_item is None:
        raise PortError("importUnreadable", "could not resolve the base item name")
    return {
        "baseItemId": base_item.ID,
        "baseItemName": base_item.name,
        "mutaplasmidId": mutaplasmid_item.ID if mutaplasmid_item is not None else None,
        "mutations": {str(k): v for k, v in mutations.items()},
    }
