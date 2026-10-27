import React from "react"
import { ModalDialog } from "./ModalDialog"
import { useFittingStore } from "../store/fitting"
import { useUiStore } from "../store/ui"
import { usePortStore } from "../store/port"
import { useSessionStore } from "../store/session"
import { t } from "../i18n"

/**
 * The eveship.fit fit button bar: Save / Clipboard / Share / Rename, each with
 * hover popups. Every action maps onto the server-authoritative backend.
 */
export const FitButtonBar = () => {
  const fit = useFittingStore((state) => state.fit)
  const saveAs = useFittingStore((state) => state.saveAs)
  const save = useFittingStore((state) => state.save)
  const dirty = useFittingStore((state) => state.dirty)
  const rename = useFittingStore((state) => state.rename)
  const fitText = useFittingStore((state) => state.fitText)
  const showNotice = useFittingStore((state) => state.showNotice)
  const openImportExport = useUiStore((state) => state.openImportExport)
  const importText = usePortStore((state) => state.importText)
  const busy = usePortStore((state) => state.busy)
  // Signed in: this slot saves the current fit into the pilot's in-game fittings.
  // Signed out: it stays the plain share-link copy button.
  const user = useSessionStore((state) => state.user)
  const exportToGame = useFittingStore((state) => state.exportToGame)
  const exporting = useFittingStore((state) => state.exporting)

  const [saveOpen, setSaveOpen] = React.useState(false)
  const [clipboardOpen, setClipboardOpen] = React.useState(false)
  const [pasteOpen, setPasteOpen] = React.useState(false)
  const [pasteText, setPasteText] = React.useState("")
  const [pasteError, setPasteError] = React.useState<string | undefined>(undefined)
  const [renameOpen, setRenameOpen] = React.useState(false)
  const [renameText, setRenameText] = React.useState("")
  const [copied, setCopied] = React.useState(false)

  async function copyEft() {
    const text = await fitText()
    if (text === null) return
    await navigator.clipboard?.writeText(text).catch(() => undefined)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
    setClipboardOpen(false)
  }

  async function copyShareLink() {
    const text = await fitText()
    if (text === null) return
    const link = `${window.location.origin}/?fit=${encodeURIComponent(text)}`
    await navigator.clipboard?.writeText(link).catch(() => undefined)
    showNotice(t("Fit share URL copied"), 3000)
  }

  async function doPaste() {
    setPasteError(undefined)
    if (!pasteText.trim()) return
    const result = await importText(pasteText)
    if (result === null) {
      setPasteError(t("the import text could not be read; check the format and try again"))
      return
    }
    setPasteText("")
    setPasteOpen(false)
    setClipboardOpen(false)
  }

  function openRename() {
    if (!fit) return
    setRenameText(fit.name)
    setRenameOpen(true)
  }

  /** 主按钮 = 保存到当前装配方案（编辑期间的改动此刻才落盘）。 */
  async function doSave() {
    await save()
    setSaveOpen(false)
  }

  /** 弹出菜单里的另存为：复制出一个新的装配。 */
  async function doSaveAs() {
    const copy = await saveAs()
    setSaveOpen(false)
    if (copy) showNotice(t("Saved a copy as {name}", { name: copy.name }), 3000)
  }

  return (
    <>
      <div className="fitbar">
        <div className="fpopupButton" onMouseOver={() => setSaveOpen(true)} onMouseOut={() => setSaveOpen(false)}>
          <div className="fbutton" onClick={() => void doSave()}>{t("Save")}</div>
          <div className={"fpopup" + (saveOpen ? "" : " fpopupCollapsed")}>
            <div>
              <div className="fbutton fbuttonSmall" onClick={() => void doSave()}>
                {dirty ? t("Save (unsaved changes)") : t("Save")}
              </div>
              <div className="fbutton fbuttonSmall" onClick={() => void doSaveAs()}>
                {t("Save As")}
              </div>
            </div>
          </div>
        </div>

        <div className="fpopupButton" onMouseOver={() => setClipboardOpen(true)} onMouseOut={() => setClipboardOpen(false)}>
          <div className="fbutton" onClick={() => void copyEft()}>{copied ? t("In Clipboard") : t("Clipboard")}</div>
          <div className={"fpopup" + (clipboardOpen ? "" : " fpopupCollapsed")}>
            <div>
              <div
                className="fbutton"
                onClick={() => {
                  setPasteError(undefined)
                  setPasteText("")
                  setPasteOpen(true)
                }}
              >
                {t("Import from Clipboard")}
              </div>
              <div className="fbutton fbuttonMax" onClick={() => void copyEft()}>
                {t("Copy to Clipboard")}
              </div>
              <div className="fbutton fbuttonMax" onClick={() => openImportExport()}>
                {t("Advanced Import/Export…")}
              </div>
            </div>
          </div>
        </div>

        <div className="fpopupButton">
          {user ? (
            <div className="fbutton" onClick={() => void exportToGame()}>
              {exporting ? t("working…") : t("Save to EVE")}
            </div>
          ) : (
            <div className="fbutton" onClick={() => void copyShareLink()}>{t("Share Link")}</div>
          )}
        </div>

        <div className="fbutton" onClick={() => openRename()}>{t("Rename")}</div>
      </div>

      <ModalDialog visible={pasteOpen} onClose={() => setPasteOpen(false)} className="fpaste" title={t("Import from Clipboard")}>
        <div>
          <div>{t("Paste your fit here")}</div>
          <div>
            <textarea autoFocus className="fpasteTextarea" value={pasteText} onChange={(e) => setPasteText(e.target.value)} spellCheck={false} />
          </div>
          <span className="fbutton fbuttonSmall" onClick={() => void doPaste()} style={{ display: "inline-block" }}>
            {busy ? t("working…") : t("Import")}
          </span>
          {pasteError && <div className="fimportError">{pasteError}</div>}
        </div>
      </ModalDialog>

      <ModalDialog visible={renameOpen} onClose={() => setRenameOpen(false)} title={t("Fit Name")}>
        <div>
          <span className="frenameEdit">
            <input type="text" autoFocus value={renameText} onChange={(e) => setRenameText(e.target.value)} />
          </span>
          <span
            className="fbutton fbuttonSmall"
            onClick={() => {
              void rename(renameText)
              setRenameOpen(false)
            }}
            style={{ display: "inline-block" }}
          >
            {t("Save")}
          </span>
        </div>
      </ModalDialog>
    </>
  )
}
