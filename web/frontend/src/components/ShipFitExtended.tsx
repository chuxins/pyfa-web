import React from "react"
import { Icon } from "./Icon"
import { ShipFit } from "./ShipFit"
import { CargoBay } from "./CargoBay"
import { DroneBay } from "./DroneBay"
import { FitHistory } from "./FitHistory"
import { ModuleCard } from "./ModuleCard"
import { FighterBay } from "./FighterBay"
import { useFittingStore } from "../store/fitting"
import { t } from "../i18n"
import { handleRingDrop } from "../dragdrop"

/** The eveship.fit extended fit panel: the ring plus fit name, cargo/drone holds,
 *  CPU/PG usage and the simulation history. */
export const ShipFitExtended = () => {
  const fit = useFittingStore((state) => state.fit)

  if (!fit) {
    return (
      <div className="sfxFit">
        <EmptyRingDrop />
      </div>
    )
  }

  return (
    <div className="sfxFit">
      {/* Hovering a slot opens this: what the module does in the fit's own numbers */}
      <ModuleCard />
      <ShipFit withStats />

      <div className="sfxFitName">
        <div className="sfxFitNameTitle">{t("Name")}</div>
        <div>{fit.name}</div>
      </div>

      <div className="sfxCargoHold">
        <ShipCargoHold />
        <ShipDroneBay />
        <ShipFighterBay />
      </div>

      <div className="sfxHistory">
        <FitHistory />
      </div>

      <div className="sfxCpuPg">
        <CpuPg title="CPU">
          <AttrFree used={fit.stats?.resources.cpu.used ?? 0} total={fit.stats?.resources.cpu.total ?? 0} fixed={1} />
        </CpuPg>
        <CpuPg title={t("Power Grid")}>
          <AttrFree used={fit.stats?.resources.powergrid.used ?? 0} total={fit.stats?.resources.powergrid.total ?? 0} fixed={1} />
        </CpuPg>
      </div>
    </div>
  )
}

/** The no-fit state: the same central ring as a drop target, so dragging a ship
 *  here creates a fit and dragging an existing fit here opens it. */
const EmptyRingDrop = () => {
  const [dragOver, setDragOver] = React.useState(false)
  return (
    <div className="sfxEmpty">
      <div
        className={"sfxDropRing" + (dragOver ? " sfxDropRingOver" : "")}
        onDragEnter={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          handleRingDrop(e)
          setDragOver(false)
        }}
      >
        <div className="sfxDropRingText">{t("Drop a ship here to create a fit, or drag a fit here to open it")}</div>
      </div>
    </div>
  )
}

const CpuPg = (props: { title: string; children: React.ReactNode }) => (
  <>
    <div className="sfxCpuPgTitle">{props.title}</div>
    <div className="sfxCpuPgContent">{props.children}</div>
  </>
)

/** "free / total" with the same fixed-decimal formatting eveship.fit uses. */
const AttrFree = ({ used, total, fixed }: { used: number; total: number; fixed: number }) => {
  const fmt = (v: number) =>
    v.toLocaleString("en", { minimumFractionDigits: fixed, maximumFractionDigits: fixed })
  return (
    <>
      {fmt(Math.max(0, total - used))}/{fmt(total)}
    </>
  )
}

const ShipCargoHold = () => {
  const fit = useFittingStore((state) => state.fit)
  const [isOpen, setIsOpen] = React.useState(false)
  const used = fit?.stats?.resources.cargo.used ?? 0
  const total = fit?.stats?.resources.cargo.total ?? 0

  if (used === 0 && isOpen) setIsOpen(false)

  return (
    <>
      <div onClick={() => setIsOpen(used !== 0 && !isOpen)} className={used !== 0 ? "sfxCargoBay" : ""}>
        <div className="sfxCargoIcon">
          <Icon name="cargo-hold" size={32} />
        </div>
        <div className="sfxCargoText">
          <div>{used.toFixed(1)}</div>
          <div> / {total.toFixed(1)}</div>
        </div>
        <div className="sfxCargoPostfix">m3</div>
      </div>
      <div className={"sfxCargoBayOverlay" + (isOpen ? " sfxCargoBayVisible" : "")}>
        <CargoBay />
      </div>
    </>
  )
}

const ShipDroneBay = () => {
  const fit = useFittingStore((state) => state.fit)
  const [isOpen, setIsOpen] = React.useState(false)
  const droneCount = fit?.drones.filter((d) => d.itemId !== null).length ?? 0
  const bayUsed = fit?.stats?.resources.drones.bayUsed ?? 0
  const bayTotal = fit?.stats?.resources.drones.bayTotal ?? 0

  if (droneCount === 0 && isOpen) setIsOpen(false)

  // A carrier has no drone bay at all (it flies fighters instead): showing a "0.0 / 0.0 m3"
  // chip there only looks like a bug, so it is left out unless the hull really holds drones.
  if (bayTotal === 0 && droneCount === 0) return <></>

  return (
    <>
      <div onClick={() => setIsOpen(droneCount !== 0 && !isOpen)} className={droneCount !== 0 ? "sfxDroneBay" : ""}>
        <div className="sfxCargoIcon">
          <Icon name="drone-bay" size={32} />
        </div>
        <div className="sfxCargoText">
          <div>{bayUsed.toFixed(1)}</div>
          <div> / {bayTotal.toFixed(1)}</div>
        </div>
        <div className="sfxCargoPostfix">m3</div>
      </div>
      <div className={"sfxDroneBayOverlay" + (isOpen ? " sfxDroneBayVisible" : "")}>
        <DroneBay />
      </div>
    </>
  )
}

const ShipFighterBay = () => {
  const fit = useFittingStore((state) => state.fit)
  const [isOpen, setIsOpen] = React.useState(false)
  const fighters = (fit?.fighters ?? []).filter((fighter) => fighter.itemId !== null)
  const resources = fit?.stats?.resources.fighters
  const bayUsed = resources?.bayUsed ?? 0
  const bayTotal = resources?.bayTotal ?? 0
  const tubes = resources?.tubesTotal ?? 0

  // Not every hull carries squadrons: hide the chip unless there are tubes or a bay
  if (tubes <= 0 && bayTotal <= 0) return <></>

  if (fighters.length === 0 && isOpen) setIsOpen(false)

  return (
    <>
      <div
        onClick={() => setIsOpen(fighters.length !== 0 && !isOpen)}
        className={"sfxFighterBay" + (fighters.length !== 0 ? " sfxFighterBayReady" : "")}
        title={t("Fighter squadrons")}
      >
        <div className="sfxCargoIcon">
          <Icon name="hardpoint-launcher" size={32} />
        </div>
        <div className="sfxCargoText">
          <div>{bayUsed.toFixed(1)}</div>
          <div> / {bayTotal.toFixed(1)}</div>
        </div>
        <div className="sfxCargoPostfix">m3</div>
      </div>
      <div className={"sfxFighterBayOverlay" + (isOpen ? " sfxFighterBayVisible" : "")}>
        <FighterBay />
      </div>
    </>
  )
}
