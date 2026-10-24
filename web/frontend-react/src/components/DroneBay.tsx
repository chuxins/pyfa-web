import React from "react"
import { useFittingStore } from "../store/fitting"
import type { Drone } from "../api"
import { t } from "../i18n"

/** The drone bay overlay: stacks grouped by type, each with active/passive
 *  toggles and a remove button. */
export const DroneBay = () => {
  const fit = useFittingStore((state) => state.fit)
  const toggleDrone = useFittingStore((state) => state.toggleDrone)
  const removeDrone = useFittingStore((state) => state.removeDrone)
  const addItem = useFittingStore((state) => state.addItem)

  if (!fit) return <></>

  const drones = fit.drones.filter((d) => d.itemId !== null)
  const activeCount = drones.filter((d) => d.state === "active").reduce((sum, d) => sum + d.amount, 0)
  const maxActive = fit.stats?.resources.drones.maxActive ?? 0

  if (drones.length === 0) {
    return <div className="droneBay">{t("No drones in the bay")}</div>
  }

  return (
    <div className="droneBay">
      <div>
        {t("Active drones")}: {activeCount} / {maxActive}
      </div>
      {drones.map((drone) => (
        <DroneBayEntry key={drone.position} drone={drone} onToggle={() => void toggleDrone(drone.position)} onRemove={() => void removeDrone(drone.position)} />
      ))}
      <div className="dim" style={{ marginTop: 4 }}>
        {t("Tip: drag drones to the ship to add them")}
      </div>
    </div>
  )
}

const DroneBayEntry = ({
  drone,
  onToggle,
  onRemove,
}: {
  drone: Drone
  onToggle: () => void
  onRemove: () => void
}) => {
  const total = Math.max(1, drone.amount)
  const active = drone.state === "active" ? drone.amount : 0
  const passive = total - active

  return (
    <div className="droneBayEntry">
      <div className="droneBayAmount">{total} x</div>
      <div>
        <img src={`https://images.evetech.net/types/${drone.itemId}/icon?size=64`} alt="" />
      </div>
      <div className="droneBayMiddle">
        <div className="droneBayName">{drone.item?.name ?? ""}</div>
        <div className="droneBaySelected">
          {t("Selected")}:
          {Array.from({ length: total }, (_, i) => (
            <div
              key={i}
              className={"droneBayEntrySelected" + (i < active ? " droneBayActive" : "")}
              onClick={i < active ? onToggle : onToggle}
              title={i < active ? t("Deactivate") : t("Activate")}
            >
              {i < active ? "X" : "\u00a0"}
            </div>
          ))}
        </div>
      </div>
      <div className="droneBayClose" onClick={onRemove}>
        X
      </div>
    </div>
  )
}
