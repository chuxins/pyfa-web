import React from "react"
import { ModalDialog } from "./ModalDialog"
import { useUiStore } from "../store/ui"
import { useFittingStore } from "../store/fitting"
import { usePortStore } from "../store/port"
import type { ExportFormat } from "../api"
import { t } from "../i18n"

type Tab = "import" | "export" | "backup"

const FORMATS: { id: ExportFormat; label: string; options?: { id: string; label: string }[] }[] = [
  { id: "eft", label: "EFT" },
  { id: "dna", label: "DNA" },
  { id: "smiley", label: "Smiley" },
  { id: "xml", label: "XML" },
  { id: "efs", label: "EFS JSON" },
  {
    id: "esi",
    label: "ESI JSON",
    options: [
      { id: "includeCharges", label: t("Loaded charges") },
      { id: "includeFormatting", label: t("Formatting tags") },
    ],
  },
]

export const ImportExportDialog = () => {
  const open = useUiStore((state) => state.importExportOpen)
  const close = useUiStore((state) => state.closeImportExport)
  const fit = useFittingStore((state) => state.fit)
  const busy = usePortStore((state) => state.busy)
  const error = usePortStore((state) => state.error)
  const notice = usePortStore((state) => state.notice)
  const importText = usePortStore((state) => state.importText)
  const exportFit = usePortStore((state) => state.exportFit)
  const exportBackup = usePortStore((state) => state.exportBackup)
  const importBackup = usePortStore((state) => state.importBackup)

  const [tab, setTab] = React.useState<Tab>("import")
  const [text, setText] = React.useState("")
  const [format, setFormat] = React.useState<ExportFormat>("eft")
  const [options, setOptions] = React.useState<Record<string, boolean>>({ includeCharges: true, includeFormatting: false })

  React.useEffect(() => {
    if (open) {
      setTab("import")
      setText("")
    }
  }, [open])

  if (!open) return null

  const currentFormat = FORMATS.find((entry) => entry.id === format)

  function download(filename: string, content: string, contentType: string) {
    const blob = new Blob([content], { type: contentType })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  async function onImport() {
    if (!text.trim()) return
    await importText(text)
    setText("")
  }

  async function onExport() {
    if (!fit) return
    const file = await exportFit(fit.id, format, options)
    if (file) download(file.filename, file.text, file.contentType)
  }

  async function onExportBackup() {
    const file = await exportBackup()
    if (file) download(file.filename, file.text, file.contentType)
  }

  async function onRestoreBackup() {
    if (!text.trim()) return
    await importBackup(text)
    setText("")
  }

  return (
    <ModalDialog title={t("Import / Export")} onClose={close} width={620}>
      <div className="tabs">
        {(["import", "export", "backup"] as Tab[]).map((key) => (
          <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>
            {t(key === "import" ? "Import" : key === "export" ? "Export as" : "XML")}
          </button>
        ))}
      </div>

      {error && <div className="banner-error">{error}</div>}
      {notice && <div className="banner-notice">{notice}</div>}

      {tab === "import" && (
        <div className="dialogPanel">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t("Paste an EFT, DNA, Smiley, XML or ESI fit below, or pick a file")}
            rows={10}
            spellCheck={false}
          />
          <div className="dialogActions">
            <button className="btn primary" onClick={() => void onImport()} disabled={busy || !text.trim()}>
              {t("Import")}
            </button>
          </div>
        </div>
      )}

      {tab === "export" && (
        <div className="dialogPanel">
          {fit ? (
            <>
              <div className="formatList">
                {FORMATS.map((entry) => (
                  <label key={entry.id} className="formatRow">
                    <input
                      type="radio"
                      name="format"
                      checked={format === entry.id}
                      onChange={() => setFormat(entry.id)}
                    />
                    {t(entry.label)}
                  </label>
                ))}
              </div>
              {currentFormat?.options && (
                <div className="optionList">
                  {currentFormat.options.map((option) => (
                    <label key={option.id} className="formatRow">
                      <input
                        type="checkbox"
                        checked={!!options[option.id]}
                        onChange={(event) => setOptions({ ...options, [option.id]: event.target.checked })}
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              )}
              <div className="dialogActions">
                <button className="btn primary" onClick={() => void onExport()} disabled={busy}>
                  {t("Download")}
                </button>
              </div>
            </>
          ) : (
            <p className="dim">{t("No fit open")}</p>
          )}
        </div>
      )}

      {tab === "backup" && (
        <div className="dialogPanel">
          <div className="dialogActions">
            <button className="btn primary" onClick={() => void onExportBackup()} disabled={busy}>
              {t("Export backup")}
            </button>
          </div>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t("Paste the backup XML below, or pick a file")}
            rows={8}
            spellCheck={false}
          />
          <div className="dialogActions">
            <button className="btn primary" onClick={() => void onRestoreBackup()} disabled={busy || !text.trim()}>
              {t("Restore backup")}
            </button>
          </div>
        </div>
      )}
    </ModalDialog>
  )
}
