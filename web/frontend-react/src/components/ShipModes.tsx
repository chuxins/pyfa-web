import React from "react"
import { useFittingStore } from "../store/fitting"
import type { ShipMode } from "../api"
import { t } from "../i18n"

/**
 * Tactical destroyer (and Anhinga) mode switch.
 *
 * The engine ships the available modes on fit.ship.modes and already accepts the
 * ``changeShipMode`` command (pyfa's own undoable GuiChangeShipModeCommand); the
 * only missing piece was a UI. Every mode is drawn on one row below the hull, so
 * a single click switches to it: the active pill is highlighted, the clicked one
 * turns amber while the command is in flight, and the desktop's right-click
 * "Tactical Mode" submenu needs no extra dialog.
 */
export const ShipModes = () => {
  const fit = useFittingStore((state) => state.fit)
  const busy = useFittingStore((state) => state.busy)
  const send = useFittingStore((state) => state.send)

  const modes = fit?.ship.modes ?? null
  const hullName = fit?.ship.item.name ?? ""
  const active = modes?.find((mode) => mode.active) ?? modes?.[0] ?? null
  // Optimistically highlight the clicked pill until the server round-trip lands.
  const [pending, setPending] = React.useState<number | null>(null)

  if (!modes || modes.length === 0 || !active) return <></>

  const choose = async (mode: ShipMode) => {
    if (mode.active || busy) return
    setPending(mode.itemId)
    try {
      await send("changeShipMode", { itemId: mode.itemId })
    } finally {
      setPending(null)
    }
  }

  const currentId = pending ?? active.itemId

  return (
    <div className="sfModes" role="group" aria-label={t("Tactical Mode")} title={t("Switch tactical mode")}>
      {modes.map((mode) => {
        const current = mode.itemId === currentId
        return (
          <button
            key={mode.itemId}
            type="button"
            className={"sfMode" + (current ? " sfModeActive" : "") + (mode.itemId === pending ? " sfModePending" : "")}
            disabled={busy}
            aria-pressed={current}
            title={mode.item.name}
            onClick={() => {
              void choose(mode)
            }}
          >
            {modeLabel(mode, hullName)}
          </button>
        )
      })}
    </div>
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
