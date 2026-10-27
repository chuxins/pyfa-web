import React from "react"
import { Icon } from "./Icon"
import { RadialMenu } from "./RadialMenu"
import { Slot, type SlotType } from "./Slot"
import { Usage } from "./Usage"
import { ShipModes } from "./ShipModes"
import { imageUrl } from "../api"
import { useFittingStore } from "../store/fitting"
import { useUiStore } from "../store/ui"
import { t } from "../i18n"
import { handleRingDrop } from "../dragdrop"

/** How many ring slots eveship.fit draws per rack (the rest are dimmed out). */
const SLOT_COUNT: Record<SlotType, number> = { High: 8, Medium: 8, Low: 8, Rig: 3, SubSystem: 4 }

const RING_OUTER = (
  <svg viewBox="24 24 464 464" xmlns="http://www.w3.org/2000/svg" className="sfRingOuter">
    <g>
      <circle style={{ fill: "none", stroke: "#000000", strokeWidth: 16 }} cx="256" cy="256" r="224" />
      <rect style={{ fill: "#000000" }} width="17" height="17" x="98" y="89" />
      <rect style={{ fill: "#000000" }} width="17" height="17" x="401" y="93" />
      <rect style={{ fill: "#000000" }} width="17" height="17" x="402" y="401" />
      <rect style={{ fill: "#000000" }} width="17" height="17" x="94" y="402" />
      <rect style={{ fill: "#000000" }} width="12" height="12" x="196" y="82" transform="rotate(56)" />
    </g>
  </svg>
)

const RING_INNER = (
  <svg viewBox="24 24 464 464" xmlns="http://www.w3.org/2000/svg" className="sfRingInner">
    <defs>
      <mask id="slot-corners">
        <rect style={{ fill: "#ffffff" }} width="512" height="512" x="0" y="0" />
        <rect style={{ fill: "#000000" }} width="17" height="17" x="133" y="126" />
        <rect style={{ fill: "#000000" }} width="17" height="17" x="366" y="129" />
        <rect style={{ fill: "#000000" }} width="17" height="17" x="366" y="366" />
        <rect style={{ fill: "#000000" }} width="17" height="17" x="132" y="369" />
        <rect style={{ fill: "#000000" }} width="12" height="12" x="230" y="44" transform="rotate(56)" />
      </mask>
    </defs>
    <g>
      <circle
        style={{ fill: "none", stroke: "#000000", strokeWidth: 46, strokeOpacity: 0.6 }}
        cx="256"
        cy="256"
        r="195"
        mask="url(#slot-corners)"
      />
    </g>
  </svg>
)

/** The ring slot items: a wrapper that rotates each item into place. */
const RingTopItem = (props: { children: React.ReactNode; rotation: number; background?: boolean }) => {
  const style = { "--rotation": `${props.rotation}deg` } as React.CSSProperties
  return (
    <div className={"sfRingTopItem" + (props.background ? " sfBackground" : "")} style={style}>
      {props.children}
    </div>
  )
}

/** Render a ship fit similar to how it is done in-game (eveship.fit's ring). */
export const ShipFit = (props: { withStats?: boolean; readOnly?: boolean }) => {
  const fit = useFittingStore((state) => state.fit)
  const setPreview = useUiStore((state) => state.setPreview)
  const [dragOver, setDragOver] = React.useState(false)

  if (!fit) return <></>

  const slots = fit.ship?.slots ?? {}
  const high = slots.high ?? 0
  const medium = slots.med ?? 0
  const low = slots.low ?? 0
  const rig = slots.rig ?? 0
  const subsystem = slots.subsystem ?? 0
  const turretSlots = slots.turretHardpoints ?? 0
  const launcherSlots = slots.launcherHardpoints ?? 0

  let turretSlotsUsed = (fit.racks.high ?? []).filter((m) => !m.isEmpty && m.hardpoint === "turret").length
  let launcherSlotsUsed = (fit.racks.high ?? []).filter((m) => !m.isEmpty && m.hardpoint === "launcher").length

  const stats = fit.stats
  const rigUsed = (fit.racks.rig ?? []).filter((m) => !m.isEmpty).length
  const cpuUsed = stats?.resources.cpu.used ?? 0
  const cpuTotal = stats?.resources.cpu.total ?? 0
  const pgUsed = stats?.resources.powergrid.used ?? 0
  const pgTotal = stats?.resources.powergrid.total ?? 0

  const slotRow = (type: SlotType, count: number, fittable: number, base: number, step: number, main = false) =>
    Array.from({ length: count }, (_, i) => (
      <RingTopItem key={`${type}${i}`} rotation={base + step * i}>
        <Slot type={type} index={i + 1} fittable={fittable >= i + 1} main={main && i === 0} readOnly={props.readOnly} />
      </RingTopItem>
    ))

  return (
    <div className="sfFit">
      {RING_OUTER}
      {RING_INNER}

      <div className="sfHull">
        <img src={imageUrl(fit.ship.item.image, 2) ?? undefined} alt={fit.ship.item.name} />
      </div>
      <ShipModes />
      <FitLink />

      <div className="sfRingTop">
        {props.withStats && (
          <>
            <RingTopItem rotation={-45} background>
              <div className="sfTurretLauncherIcon">
                <Icon name="hardpoint-turret" size={16} />
              </div>
            </RingTopItem>
            {Array.from({ length: turretSlots }, (_, i) => {
              turretSlotsUsed--
              return (
                <RingTopItem key={`t${i}`} rotation={-40 + i * 3} background>
                  <div className={"sfTurretLauncherItem" + (turretSlotsUsed >= 0 ? " sfTurretLauncherItemUsed" : "")}>&nbsp;</div>
                </RingTopItem>
              )
            })}

            <RingTopItem rotation={43} background>
              <div className="sfTurretLauncherIcon">
                <Icon name="hardpoint-launcher" size={16} />
              </div>
            </RingTopItem>
            {Array.from({ length: launcherSlots }, (_, i) => {
              launcherSlotsUsed--
              return (
                <RingTopItem key={`l${i}`} rotation={39 - i * 3} background>
                  <div className={"sfTurretLauncherItem" + (launcherSlotsUsed >= 0 ? " sfTurretLauncherItemUsed" : "")}>&nbsp;</div>
                </RingTopItem>
              )
            })}

            <RingTopItem rotation={-47} background>
              <div className="sfUsage">
                <Usage used={rigUsed} total={rig} angle={-30} intervals={30} markers={2} color="#3d4547" />
              </div>
            </RingTopItem>
            <RingTopItem rotation={134.5} background>
              <div className="sfUsage">
                <Usage used={cpuUsed} total={cpuTotal} angle={-44} intervals={40} markers={5} color="#2a504f" />
              </div>
            </RingTopItem>
            <RingTopItem rotation={135} background>
              <div className="sfUsage">
                <Usage used={pgUsed} total={pgTotal} angle={44} intervals={40} markers={5} color="#541208" />
              </div>
            </RingTopItem>
          </>
        )}

        <RingTopItem rotation={-45} background>
          <RadialMenu type="High" />
        </RingTopItem>
        {slotRow("High", SLOT_COUNT.High, high, -36.5, 71 / 7, true)}

        <RingTopItem rotation={43} background>
          <RadialMenu type="Medium" />
        </RingTopItem>
        {slotRow("Medium", SLOT_COUNT.Medium, medium, 53, 72 / 7)}

        <RingTopItem rotation={133} background>
          <RadialMenu type="Low" />
        </RingTopItem>
        {slotRow("Low", SLOT_COUNT.Low, low, 142, 72 / 7)}

        {slotRow("Rig", SLOT_COUNT.Rig, rig, -74, 21 / 2)}
        {slotRow("SubSystem", SLOT_COUNT.SubSystem, subsystem, -128, 38 / 3)}
      </div>

      <div
        className={"sfHullDraggable" + (dragOver ? " sfHullDraggableOver" : "")}
        style={{ zIndex: 2 }}
        title={t("Drop here to fit")}
        onMouseLeave={() => setPreview(null)}
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
      />
    </div>
  )
}

/** The share link drawn at the bottom of the ring (copies this fit's ?fit= URL). */
const FitLink = () => {
  const fit = useFittingStore((state) => state.fit)
  const fitText = useFittingStore((state) => state.fitText)
  const [link, setLink] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)

  React.useEffect(() => {
    let alive = true
    if (!fit) return
    void fitText().then((text) => {
      if (alive && text) setLink(`${window.location.origin}/?fit=${encodeURIComponent(text)}`)
    })
    return () => {
      alive = false
    }
  }, [fit, fitText])

  if (link === null) return <></>

  return (
    <div className="sfFitLink">
      <svg viewBox="0 0 730 730" xmlns="http://www.w3.org/2000/svg">
        <path id="fitlink" fill="none" d="M18,365 A25,25 0 0,1 712,365" />
        <a
          href={link}
          target="_new"
          onClick={(e) => {
            e.preventDefault()
            navigator.clipboard?.writeText(link).catch(() => undefined)
            setCopied(true)
            window.setTimeout(() => setCopied(false), 2000)
          }}
        >
          <text textAnchor="middle">
            <textPath startOffset="50%" href="#fitlink" fill="#cdcdcd">
              {copied ? t("copied to clipboard") : t("share fit")}
            </textPath>
          </text>
        </a>
      </svg>
    </div>
  )
}
