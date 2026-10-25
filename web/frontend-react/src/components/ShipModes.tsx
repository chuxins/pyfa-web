import React from "react"
import { ModalDialog } from "./ModalDialog"
import { useFittingStore } from "../store/fitting"
import type { ShipMode } from "../api"
import { t } from "../i18n"

/**
 * Tactical destroyer (and Anhinga) mode switch.
 *
 * The engine ships the available modes on fit.ship.modes and already accepts the
 * ``changeShipMode`` command (pyfa's own undoable GuiChangeShipModeCommand); the
 * only missing piece was a UI. The current mode is drawn as a small badge below
 * the hull; clicking it opens a radio-choice dialog just like the desktop's
 * right-click "Tactical Mode" submenu.
 */
export const ShipModes = () => {
  const fit = useFittingStore((state) => state.fit)
  const busy = useFittingStore((state) => state.busy)
  const send = useFittingStore((state) => state.send)
  const [open, setOpen] = React.useState(false)

  const modes = fit?.ship.modes ?? null
  const hullName = fit?.ship.item.name ?? ""
  const active = modes?.find((mode) => mode.active) ?? modes?.[0] ?? null
  const [pending, setPending] = React.useState<ShipMode | null>(null)

  if (!modes || modes.length === 0 || !active) return <></>

  const choose = async (mode: ShipMode) => {
    if (mode.active) {
      setOpen(false)
      return
    }
    setPending(mode)
    setOpen(false)
    await send("changeShipMode", { itemId: mode.itemId })
    setPending(null)
  }

  return (
    <>
      <div className="sfModeBadge" title={t("Switch tactical mode")} onClick={() => setOpen(true)}>
        <span className="sfModeBadgeLabel">{t("Mode")}</span>
        <span className={"sfModeBadgeName" + (pending ? " sfModeBadgePending" : "")}>
          {modeLabel(pending ?? active, hullName)}
        </span>
      </div>

      <ModalDialog visible={open} onClose={() => setOpen(false)} className="fconfirm" width={360} title={t("Tactical Mode")}>
        <div className="sfModeList">
          {modes.map((mode) => (
            <label
              key={mode.itemId}
              className={"sfModeOption" + (mode.active ? " sfModeOptionActive" : "")}
            >
              <input
                type="radio"
                name="shipMode"
                checked={mode.active}
                disabled={busy}
                onChange={() => {
                  void choose(mode)
                }}
              />
              <span>{modeLabel(mode, hullName)}</span>
            </label>
          ))}
        </div>
        <div className="fconfirmButtons">
          <span className="fbutton fbuttonSmall" onClick={() => setOpen(false)}>
            {t("Cancel")}
          </span>
        </div>
      </ModalDialog>
    </>
  )
}

/**
 * The short mode word, localized by the server's game data:
 *   English: "Confessor Sharpshooter Mode"   -> "Sharpshooter"
 *            "Anhinga Primary Mode"          -> "Primary"
 *   Chinese: "忏悔者级狙击模式" (hull 忏悔者级) -> "狙击"
 *            "蛇鹈号主模式"       (hull 蛇鹈号)   -> "主"
 * Falls back to the full item name when neither pattern matches.
 */
function modeLabel(mode: ShipMode, hullName: string): string {
  const name = mode.item.name
  const parts = name.split(/\s+/)
  // "<hull words> <mode word(s)> Mode" -> strip the hull prefix and the Mode suffix.
  if (parts.length >= 3 && parts[parts.length - 1].toLowerCase() === "mode") {
    const hullWords = hullName.trim().split(/\s+/).filter(Boolean).length
    const start = hullWords > 0 && parts.slice(0, hullWords).join(" ") === hullName.trim() ? hullWords : 1
    return parts.slice(start, -1).join(" ")
  }
  // Chinese: "<hull><word>模式" -> the word between the hull prefix and 模式.
  if (hullName && name.startsWith(hullName) && name.endsWith("模式") && name.length > hullName.length + 2) {
    return name.slice(hullName.length, -"模式".length)
  }
  return name
}
