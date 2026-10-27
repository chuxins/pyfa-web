import React from "react"
import { useFittingStore } from "../store/fitting"
import { imageUrl, type Drone } from "../api"
import { formatAmount } from "../format"
import { t } from "../i18n"

/**
 * The drone bay overlay: one box per drone in a stack, and each box launches or recalls
 * exactly one drone of it (click a flying box to put that one away, click an empty box
 * to launch up to it).
 *
 * The boxes a hull cannot fly -- because its drone bandwidth or its drone-control limit
 * is used up -- are drawn dimmed and do not click. The server refuses those too
 * (`droneBandwidthExceeded` / `droneControlLimitExceeded`), so this is the explanation,
 * not the rule.
 */
export const DroneBay = () => {
  const fit = useFittingStore((state) => state.fit)
  const setDroneActive = useFittingStore((state) => state.setDroneActive)
  const removeDrone = useFittingStore((state) => state.removeDrone)

  if (!fit) return <></>

  const drones = fit.drones.filter((d) => d.itemId !== null)
  const resources = fit.stats?.resources.drones
  const activeCount = drones.reduce((sum, d) => sum + (d.amountActive ?? 0), 0)
  const maxActive = resources?.maxActive ?? 0
  const bandwidthUsed = resources?.bandwidthUsed ?? 0
  const bandwidthTotal = resources?.bandwidthTotal ?? 0
  const bandwidthLeft = Math.max(0, bandwidthTotal - bandwidthUsed)

  if (drones.length === 0) {
    return <div className="droneBay">{t("No drones in the bay")}</div>
  }

  return (
    <div className="droneBay">
      <div className="droneBayHeader">
        <span>
          {t("Active drones")}: {activeCount} / {maxActive}
        </span>
        <span className="droneBayBandwidth" title={t("Drone bandwidth")}>
          {t("Bandwidth")}: {formatAmount(bandwidthUsed, { prec: 3, lowest: 0, highest: 0 })} /{" "}
          {formatAmount(bandwidthTotal, { prec: 3, lowest: 0, highest: 0 })} Mbit/s
        </span>
      </div>
      {drones.map((drone) => (
        <DroneBayEntry
          key={drone.position}
          drone={drone}
          activeCount={activeCount}
          maxActive={maxActive}
          bandwidthLeft={bandwidthLeft}
          bandwidthTotal={bandwidthTotal}
          onPick={(amount) => void setDroneActive(drone.position, amount)}
          onRemove={() => void removeDrone(drone.position)}
        />
      ))}
      <div className="dim" style={{ marginTop: 4 }}>
        {t("Tip: drag drones to the ship to add them")}
      </div>
    </div>
  )
}

const DroneBayEntry = ({
  drone,
  activeCount,
  maxActive,
  bandwidthLeft,
  bandwidthTotal,
  onPick,
  onRemove,
}: {
  drone: Drone
  activeCount: number
  maxActive: number
  bandwidthLeft: number
  bandwidthTotal: number
  onPick: (amount: number) => void
  onRemove: () => void
}) => {
  const total = Math.max(1, drone.amount)
  const active = drone.amountActive ?? (drone.state === "active" ? drone.amount : 0)
  const perDrone = drone.bandwidthUsed ?? 0

  /** Why the box at `wanted` cannot be launched, or null when it can. */
  const blockedBecause = (wanted: number): string | null => {
    const extra = wanted - active
    if (extra <= 0) return null // putting drones away is always allowed
    if (maxActive > 0 && activeCount + extra > maxActive) return t("The ship cannot keep more drones in space")
    if (bandwidthTotal > 0 && perDrone * extra > bandwidthLeft + 1e-6) return t("No drone bandwidth left")
    return null
  }

  return (
    <div className="droneBayEntry">
      <div className="droneBayAmount">{total} x</div>
      <div>
        <img src={imageUrl(drone.item?.image, 1) ?? undefined} alt="" />
      </div>
      <div className="droneBayMiddle">
        <div className="droneBayName">{drone.item?.name ?? ""}</div>
        <div className="droneBaySelected">
          {t("Selected")}:
          {Array.from({ length: total }, (_, i) => {
            const flying = i < active
            // Clicking a flying box puts that one back; clicking an empty one launches
            // up to and including it.
            const wanted = flying ? i : i + 1
            const blocked = flying ? null : blockedBecause(wanted)
            const className =
              "droneBayEntrySelected" +
              (flying ? " droneBayActive" : "") +
              (blocked ? " droneBayBlocked" : "")
            return (
              <div
                key={i}
                className={className}
                onClick={blocked ? undefined : () => onPick(wanted)}
                title={blocked ?? (flying ? t("Deactivate") : t("Activate"))}
              >
                {flying ? "X" : "\u00a0"}
              </div>
            )
          })}
        </div>
      </div>
      <div className="droneBayClose" onClick={onRemove}>
        X
      </div>
    </div>
  )
}
