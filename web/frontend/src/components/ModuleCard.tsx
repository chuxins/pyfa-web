import React from "react"
import { createPortal } from "react-dom"
import { api, type ModuleEffect, type ModuleEffectRow } from "../api"
import { useFittingStore } from "../store/fitting"
import { useUiStore } from "../store/ui"
import { formatAmount } from "../format"
import { t } from "../i18n"

/**
 * The hover card of a fitted module: what the module does in the fit's own numbers.
 *
 * The rows come from `GET /api/fits/{id}/modules/{pos}/effect`, which reads the
 * fitted module through the engine (so skills, implants, rigs and the module's state
 * are all in the answer) and only reports the effects a module actually has: damage
 * per second with its type split and range for a weapon, capacitor drained for a
 * neutralizer, hit points for a repairer, and so on.
 *
 * The card is drawn in a portal at the pointer because the fitting ring wraps every
 * slot in a rotated container.
 */

/**
 * Effects are cached per fit object. The store replaces that object for every update
 * (a command's answer, an SSE event), so a WeakMap keyed on it drops the cache exactly
 * when the numbers may have changed -- and never leaks an entry for an unloaded fit.
 */
const cache = new WeakMap<object, Map<number, ModuleEffect>>()

function cacheFor(fit: object): Map<number, ModuleEffect> {
  let entries = cache.get(fit)
  if (!entries) {
    entries = new Map()
    cache.set(fit, entries)
  }
  return entries
}

const DAMAGE_TYPES = [
  { key: "em", label: "EM", color: "#4f8fd6" },
  { key: "thermal", label: "Thermal", color: "#cf5a4a" },
  { key: "kinetic", label: "Kinetic", color: "#9aa0a6" },
  { key: "explosive", label: "Explosive", color: "#cf8f3d" },
] as const

const amount = (value: number, prec = 3) => formatAmount(value, { prec, lowest: 0, highest: 0 })

/** Metres as the fitting window writes distances: 750 m, 6.45 km. */
function distance(metres: number | undefined): string {
  if (!metres) return ""
  if (metres < 1000) return `${Math.round(metres)} m`
  return `${formatAmount(metres / 1000, { prec: 3, lowest: 0, highest: 0 })} km`
}

function rangeOf(row: { optimal?: number; falloff?: number }): string {
  const optimal = distance(row.optimal)
  const falloff = distance(row.falloff)
  if (optimal && falloff) return `${optimal} + ${falloff}`
  return optimal || falloff || ""
}

/** The label a repair row goes by: target first, remote repairers say so. */
function repairLabel(row: { target: "armor" | "shield" | "hull"; remote: boolean }): string {
  const target = row.target
  if (row.remote) {
    return target === "armor" ? "Remote armor repaired" : target === "shield" ? "Remote shield boosted" : "Remote hull repaired"
  }
  return target === "armor" ? "Armor repaired" : target === "shield" ? "Shield boosted" : "Hull repaired"
}

function EffectRow({ row }: { row: ModuleEffectRow }) {
  switch (row.kind) {
    case "damage":
      return (
        <>
          <div className="mcLine mcStrong">
            <span>{t("DPS")}</span>
            <span>{amount(row.dps, 4)}</span>
          </div>
          <div className="mcDamage">
            {DAMAGE_TYPES.filter((type) => row[type.key] > 0).map((type) => (
              <span key={type.key} className="mcDamageType">
                <i style={{ backgroundColor: type.color }} />
                {t(type.label)} {amount(row[type.key], 3)}
              </span>
            ))}
          </div>
          <div className="mcLine">
            <span>{t("Volley")}</span>
            <span>{amount(row.volley, 4)}</span>
          </div>
          <div className="mcLine">
            <span>{t("Cycle")}</span>
            <span>{amount(row.cycle, 3)} s</span>
          </div>
        </>
      )
    case "range":
      return (
        <div className="mcLine">
          <span>{t("Range")}</span>
          <span>
            {distance(row.optimal) || "--"}
            {row.falloff > 0 && ` + ${distance(row.falloff)}`}
          </span>
        </div>
      )
    case "capDrain":
      return (
        <div className="mcLine">
          <span>{row.nosferatu ? t("Capacitor drained (nos)") : t("Capacitor neutralized")}</span>
          <span>
            {amount(row.amount)} GJ
            {row.perSecond > 0 && ` (${amount(row.perSecond)}/s)`}
            {rangeOf(row) && ` · ${rangeOf(row)}`}
          </span>
        </div>
      )
    case "capTransfer":
      return (
        <div className="mcLine">
          <span>{t("Capacitor transferred")}</span>
          <span>
            {amount(row.amount)} GJ
            {row.perSecond > 0 && ` (${amount(row.perSecond)}/s)`}
            {rangeOf(row) && ` · ${rangeOf(row)}`}
          </span>
        </div>
      )
    case "repair":
      return (
        <div className="mcLine">
          <span>{t(repairLabel(row))}</span>
          <span>
            {amount(row.amount)} HP
            {row.perSecond > 0 && ` (${amount(row.perSecond)}/s)`}
            {rangeOf(row) && ` · ${rangeOf(row)}`}
          </span>
        </div>
      )
    case "warpScrambler":
      return (
        <div className="mcLine">
          <span>{t("Warp disruption")}</span>
          <span>
            {amount(row.strength, 2)}
            {rangeOf(row) && ` · ${rangeOf(row)}`}
          </span>
        </div>
      )
    case "web":
      return (
        <div className="mcLine">
          <span>{t("Target speed")}</span>
          <span>
            {amount(row.speedFactor, 3)}%
            {rangeOf(row) && ` · ${rangeOf(row)}`}
          </span>
        </div>
      )
    case "propulsion":
      return (
        <div className="mcLine">
          <span>{t("Velocity bonus")}</span>
          <span>
            +{amount(row.speedFactor - 100, 3)}% (×{amount(row.speedFactor / 100, 3)})
          </span>
        </div>
      )
    case "capBoost":
      return (
        <div className="mcLine">
          <span>{t("Capacitor restored")}</span>
          <span>{t("Every {cycle} s · {amount} GJ", { cycle: amount(row.cycle, 3), amount: amount(row.amount, 4) })}</span>
        </div>
      )
    case "bonus":
      return (
        <div className="mcLine">
          <span>{t(row.label)}</span>
          <span>
            {row.value > 0 ? "+" : ""}
            {amount(row.value, 3)}
            {row.percent ? "%" : ""}
          </span>
        </div>
      )
    case "active":
      // Takes charges but holds none: its numbers come from what gets loaded
      return <div className="mcActive">{t("Active module")}</div>
    case "resistances": {
      const keys = ["em", "thermal", "kinetic", "explosive"] as const
      const names = { em: "EM", thermal: "Thermal", kinetic: "Kinetic", explosive: "Explosive" } as const
      const values = keys.map((key) => row.values[key] ?? 0)
      const same = values.every((value) => value === values[0] && value !== 0)
      return (
        <div className="mcLine">
          <span>{t(layerLabel(row.layer))}</span>
          <span>
            {same
              ? `${amount(values[0], 3)}%`
              : keys
                  .filter((key, index) => values[index] !== 0)
                  .map((key) => `${t(names[key])} ${amount(row.values[key], 3)}%`)
                  .join("  ")}
          </span>
        </div>
      )
    }
    case "ecm": {
      const sensors = ["gravimetric", "ladar", "magnetometric", "radar"] as const
      const names = {
        gravimetric: "Gravimetric",
        ladar: "Ladar",
        magnetometric: "Magnetometric",
        radar: "Radar",
      } as const
      const values = sensors.map((sensor) => row.values[sensor] ?? 0)
      const same = values.every((value) => value === values[0])
      return (
        <div className="mcLine">
          <span>{t("ECM strength")}</span>
          <span>
            {same
              ? amount(values[0], 3)
              : sensors
                  .map((sensor) => `${t(names[sensor])} ${amount(row.values[sensor], 3)}`)
                  .join("  ")}
          </span>
        </div>
      )
    }
    default:
      return null
  }
}

/** "Armor resistance" and friends, from the layer the server named. */
function layerLabel(layer: "armor" | "shield" | "hull"): string {
  return layer === "armor" ? "Armor resistance" : layer === "shield" ? "Shield resistance" : "Hull resistance"
}

/**
 * The one-line state label.
 *
 * White means "switched on but not running anything": a passive module is like that from
 * the moment it is fitted, and so is an active module that has been switched on but not
 * activated yet. Green is reserved for an active module that *is* activated, grey for
 * either kind once it is switched off, and red for an overheated active module.
 */
function stateOf(effect: ModuleEffect): { text: string; className: string } {
  if (effect.state === "overheated") return { text: t("Overheated active module"), className: "mcStateOverheated" }
  if (effect.state === "active") return { text: t("Activated active module"), className: "mcStateActivated" }
  if (effect.state === "offline") {
    return {
      text: effect.canActivate ? t("Disabled active module") : t("Disabled passive module"),
      className: "mcStateOff",
    }
  }
  // "online": fitted and switched on, but nothing is activated
  return {
    text: effect.canActivate ? t("Enabled active module") : t("Enabled passive module"),
    className: "mcStateEnabled",
  }
}

export const ModuleCard = () => {
  const hover = useUiStore((state) => state.moduleHover)
  const fit = useFittingStore((state) => state.fit)
  const [effect, setEffect] = React.useState<ModuleEffect | null>(null)
  const [failed, setFailed] = React.useState(false)

  const fitId = fit?.id
  const position = hover?.position
  const itemId = hover?.itemId

  React.useEffect(() => {
    setEffect(null)
    setFailed(false)
    if (!fit || position === undefined || itemId === undefined) return
    // Keyed on the fit *object*: the store hands out a fresh one for every update (an
    // edit, an SSE event), so loading or unloading a charge invalidates the card by
    // itself. `fit.timestamp` is stamped once at construction and would have cached the
    // pre-edit numbers forever.
    const entries = cacheFor(fit)
    const cached = entries.get(position)
    if (cached) {
      setEffect(cached)
      return
    }
    let alive = true
    void api
      .moduleEffect(fit.id, position)
      .then((data) => {
        entries.set(position, data)
        if (alive) setEffect(data)
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [fit, position, itemId])

  if (!hover || fitId === undefined || failed) return null

  // The slot may have been emptied or the module swapped since the pointer entered
  const stillFitted = Object.values(fit?.racks ?? {})
    .flat()
    .some((module) => module.position === hover.position && !module.isEmpty && module.itemId === hover.itemId)
  if (!stillFitted) return null

  // Keep the card on screen whatever corner the slot is in
  const width = 270
  const height = 210
  const left = Math.max(8, Math.min(hover.x + 18, window.innerWidth - width - 8))
  const top = Math.max(8, Math.min(hover.y + 18, window.innerHeight - height - 8))

  const header = effect?.name ?? ""

  return createPortal(
    <div className="moduleCard" style={{ left, top, width }} role="tooltip">
      <div className="mcHead">
        <span className="mcName">{header}</span>
        {effect?.charge && (
          <span className="mcCharge">
            {effect.charge.name}
            {effect.charge.amount ? ` ×${effect.charge.amount}` : ""}
          </span>
        )}
      </div>
      {effect === null ? (
        <div className="mcPending dim">{t("working…")}</div>
      ) : (
        <>
          <div className={"mcState " + stateOf(effect).className}>{stateOf(effect).text}</div>
          {effect.rows.length === 0 ? (
            <div className="mcNone dim">{t("No direct effect")}</div>
          ) : (
            effect.rows.map((row, index) => <EffectRow key={`${row.kind}${index}`} row={row} />)
          )}
        </>
      )}
    </div>,
    document.body,
  )
}
