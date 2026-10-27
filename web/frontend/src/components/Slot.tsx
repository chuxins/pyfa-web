import React from "react"
import { Icon } from "./Icon"
import { useFittingStore } from "../store/fitting"
import { useUiStore } from "../store/ui"
import type { Module } from "../api"
import { imageUrl } from "../api"
import { handleModuleDrop, isItemDrag } from "../dragdrop"
import { t } from "../i18n"

export type SlotType = "High" | "Medium" | "Low" | "Rig" | "SubSystem"

const RACK_BY_TYPE: Record<SlotType, string> = {
  High: "high",
  Medium: "med",
  Low: "low",
  Rig: "rig",
  SubSystem: "subsystem",
}

const PLACEHOLDER_ICON: Record<SlotType, "fitting-hislot" | "fitting-medslot" | "fitting-lowslot" | "fitting-rig-subsystem"> = {
  High: "fitting-hislot",
  Medium: "fitting-medslot",
  Low: "fitting-lowslot",
  Rig: "fitting-rig-subsystem",
  SubSystem: "fitting-rig-subsystem",
}

/** pyfa state names -> the eveship.fit slot state vocabulary. */
const ESF_STATE: Record<string, string> = { offline: "Offline", online: "Online", active: "Active", overheated: "Overload" }

export const Slot = (props: { type: SlotType; index: number; fittable: boolean; main?: boolean; readOnly?: boolean }) => {
  const fit = useFittingStore((state) => state.fit)
  const cycleModuleState = useFittingStore((state) => state.cycleModuleState)
  const removeModule = useFittingStore((state) => state.removeModule)
  const loadChargeAt = useFittingStore((state) => state.loadChargeAt)
  const preview = useUiStore((state) => state.preview)
  const setModuleHover = useUiStore((state) => state.setModuleHover)

  const rack = RACK_BY_TYPE[props.type]
  const rackModules = (fit?.racks[rack] ?? []).slice().sort((a, b) => a.position - b.position)
  const slotModule: Module | null = rackModules[props.index - 1] ?? null

  /* The first empty, fittable slot of this rack is where a hovered hardware item
   * previews itself (eveship.fit's addItem-with-preview behaviour, drawn locally). */
  const previewHere =
    preview?.itemId != null &&
    preview.slotType === props.type &&
    props.fittable &&
    (slotModule === null || slotModule.isEmpty) &&
    !rackModules.some((m, i) => i < props.index - 1 && m.isEmpty)

  const hasItem = slotModule !== null && !slotModule.isEmpty
  const active = !!(hasItem && (slotModule.canOverheat || slotModule.state === "active" || slotModule.state === "overheated"))
  const state = hasItem && slotModule.state ? ESF_STATE[slotModule.state] ?? slotModule.state : "Passive"

  const onCycle = React.useCallback(
    (e: React.MouseEvent<HTMLElement, MouseEvent>) => {
      if (!hasItem) return
      void cycleModuleState({ position: slotModule.position, itemId: slotModule.itemId }, e.shiftKey ? "left" : "cycle")
    },
    [cycleModuleState, hasItem, slotModule],
  )

  const onUnfit = React.useCallback(
    (e: React.MouseEvent<SVGSVGElement, MouseEvent>) => {
      e.stopPropagation()
      if (!hasItem) return
      void removeModule({ position: slotModule.position })
    },
    [removeModule, hasItem, slotModule],
  )

  const onUncharge = React.useCallback(
    (e: React.MouseEvent<SVGSVGElement, MouseEvent>) => {
      e.stopPropagation()
      if (!hasItem) return
      void loadChargeAt(slotModule.position, null)
    },
    [loadChargeAt, hasItem, slotModule],
  )

  /* Hovering a fitted module opens the effect card (damage, range, capacitor drain...).
   * The pointer position travels with it because the card is drawn in a portal: the
   * ring puts every slot inside a rotated wrapper. */
  const onEnter = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
      if (!hasItem || slotModule?.itemId == null) {
        setModuleHover(null)
        return
      }
      setModuleHover({ position: slotModule.position, itemId: slotModule.itemId, x: e.clientX, y: e.clientY })
    },
    [hasItem, slotModule, setModuleHover],
  )

  const onLeave = React.useCallback(() => {
    setModuleHover(null)
  }, [setModuleHover])

  /* A fitted module is a drop target of its own: dropping ammunition on it loads that
   * one module (see handleModuleDrop). Any other drag falls through to the ring's own
   * behaviour, and the slot only lights up while a drag of ours is over it. */
  const [dropTarget, setDropTarget] = React.useState(false)

  const onDragOverSlot = React.useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!isItemDrag(e)) return
      e.preventDefault()
      if (hasItem) setDropTarget(true)
    },
    [hasItem],
  )

  const onDragLeaveSlot = React.useCallback(() => setDropTarget(false), [])

  const onDropSlot = React.useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      setDropTarget(false)
      handleModuleDrop(e, hasItem && slotModule !== null ? slotModule.position : -1)
    },
    [hasItem, slotModule],
  )

  const onOffline = React.useCallback(
    (e: React.MouseEvent<SVGSVGElement, MouseEvent>) => {
      e.stopPropagation()
      if (!hasItem) return
      void cycleModuleState({ position: slotModule.position, itemId: slotModule.itemId }, "ctrl")
    },
    [cycleModuleState, hasItem, slotModule],
  )

  /* The slot shape and its marker/option icons are defined once (hidden SVG defs)
   * and reused with <use>. */
  const svgDefs = props.main ? (
    <>
      <svg viewBox="235 40 52 50" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMin slice" style={{ display: "none" }}>
        <g id="slot">
          <path style={{ fillOpacity: 0.1, strokeWidth: 1, strokeOpacity: 0.5 }} d="M 243 46 A 210 210 0 0 1 279 46.7 L 276 84.7 A 172 172 0 0 0 246 84 L 243 46" />
        </g>
        <g id="slot-active">
          <path style={{ fillOpacity: 0.6, strokeWidth: 1 }} d="M 250 84 L 254 79 L 268 79 L 272 84" />
        </g>
        <g id="slot-passive">
          <path style={{ strokeWidth: 1 }} d="M 245 48 A 208 208 0 0 1 250 47.5 L 248 50 L 245 50" />
          <path style={{ strokeWidth: 1 }} d="M 277.5 48.5 A 208 208 0 0 0 273 48 L 275 50.5 L 277.5 50.5" />
          <path style={{ strokeWidth: 1 }} d="M 247 82 A 170 170 0 0 1 252 82 L 250 80 L 246.8 80" />
          <path style={{ strokeWidth: 1 }} d="M 275 82.5 A 170 170 0 0 0 270 82 L 272 80 L 275.2 80" />
        </g>
      </svg>
      <svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" style={{ display: "none" }}>
        <g id="uncharge">
          <path style={{ fill: "none", strokeWidth: 1 }} d="M 4 6 A 8 8 0 1 1 4 14" />
          <path style={{ fill: "none", strokeWidth: 1 }} d="M 11 6 L 6 10 L 11 14" />
          <path style={{ fill: "none", strokeWidth: 1 }} d="M 6 10 L 16 10" />
        </g>
        <g id="unfit">
          <path style={{ fill: "none", strokeWidth: 1 }} d="M 4 6 A 8 8 0 1 1 4 14" />
          <path style={{ fill: "none", strokeWidth: 1 }} d="M 11 6 L 6 10 L 11 14" />
          <path style={{ fill: "none", strokeWidth: 1 }} d="M 6 10 L 16 10" />
        </g>
        <g id="offline">
          <path style={{ fill: "none", strokeWidth: 1 }} d="M 12 4 A 8 8 0 1 1 6 4" />
          <path style={{ fill: "none", strokeWidth: 1 }} d="M 9 2 L 9 12" />
        </g>
      </svg>
    </>
  ) : (
    <></>
  )

  let item: React.ReactNode

  if (previewHere) {
    const previewSrc = imageUrl(preview!.image, 1)
    item = previewSrc ? (
      <img src={previewSrc} title={t("Preview")} className="sfPreview" alt="" />
    ) : (
      <Icon name={PLACEHOLDER_ICON[props.type]} />
    )
  } else if (hasItem && slotModule.item) {
    // 装填了弹药就画弹药的图标（和游戏里一致），否则画模块自己的
    const src = imageUrl(slotModule.charge ? slotModule.charge.item.image : slotModule.item.image, 1)
    item = src ? (
      <img
        src={src}
        title={slotModule.charge ? `${slotModule.item.name}\n${slotModule.charge.item.name}` : slotModule.item.name}
        alt=""
      />
    ) : (
      <Icon name={PLACEHOLDER_ICON[props.type]} />
    )
  } else {
    item = <Icon name={PLACEHOLDER_ICON[props.type]} />
  }

  const svg = (
    <>
      {svgDefs}
      <svg viewBox="235 40 52 50" xmlns="http://www.w3.org/2000/svg" className="sfRingInner" preserveAspectRatio="xMidYMin slice">
        <use href="#slot" />
        {props.fittable && hasItem && active && <use href="#slot-active" />}
        {props.fittable && hasItem && !active && <use href="#slot-passive" />}
      </svg>
    </>
  )

  if (!props.fittable && !hasItem) {
    return (
      <div className="sfSlotOuter" data-hasitem={false}>
        <div className="sfSlot" data-state="Unavailable">
          {svg}
        </div>
      </div>
    )
  }

  return (
    <div
      className={"sfSlotOuter" + (dropTarget ? " sfSlotDropTarget" : "")}
      data-hasitem={hasItem}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onDragOver={onDragOverSlot}
      onDragLeave={onDragLeaveSlot}
      onDrop={onDropSlot}
    >
      <div
        className="sfSlot"
        onClick={props.readOnly !== true ? onCycle : undefined}
        data-state={state}
      >
        {svg}
        <div className={hasItem ? "sfSlotImage" : "sfSlotImagePlaceholder"}>{item}</div>
      </div>
      {props.readOnly !== true && (
        <div className="sfSlotOptions">
          {hasItem && slotModule?.charge !== undefined && slotModule.charge !== null && (
            <svg viewBox="0 0 20 20" width={20} xmlns="http://www.w3.org/2000/svg" onClick={onUncharge}>
              <title>{t("Remove Charge")}</title>
              <use href="#uncharge" />
            </svg>
          )}
          {hasItem && (
            <svg viewBox="0 0 20 20" width={20} xmlns="http://www.w3.org/2000/svg" onClick={onUnfit}>
              <title>{t("Unfit Module")}</title>
              <use href="#unfit" />
            </svg>
          )}
          {hasItem && slotModule?.canOverheat && (
            <svg viewBox="0 0 20 20" width={20} xmlns="http://www.w3.org/2000/svg" onClick={onOffline}>
              <title>{t("Put Offline")}</title>
              <use href="#offline" />
            </svg>
          )}
        </div>
      )}
    </div>
  )
}
