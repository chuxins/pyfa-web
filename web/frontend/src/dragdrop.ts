import type { DragEvent } from "react"
import { useFittingStore } from "./store/fitting"

/**
 * The one place the app accepts a drop: the central ring of the fit panel.
 *
 * - an existing fit  -> opens it
 * - a ship           -> creates a fresh fit for it
 * - anything else    -> auto-fitted (modules into a free slot, charges into a
 *                        module, drones into the drone bay, ...)
 *
 * A drop the engine refuses (an item that cannot be equipped) becomes the
 * fitting store's error state, which the app draws as the red banner on top.
 * No other element in the UI is a drop target, so dragging anywhere else does
 * nothing.
 */
export const MIME_FIT_ID = "application/esf-fit-id"
export const MIME_TYPE_ID = "application/esf-type-id"
export const MIME_KIND = "application/esf-kind"
export const MIME_SLOT_INDEX = "application/esf-slot-index"

export interface RingDropPayload {
  /** A dragged existing fit's id, or null. */
  fitId: number | null
  /** A dragged item/ship type id, or null. */
  typeId: number | null
  /** What was dragged: "ship", "module", "charge", "drone", ... */
  kind: string
  /** Whether the drag came from a fitted module (already equipped). */
  fromSlot: boolean
}

export function readRingDrop(e: DragEvent): RingDropPayload {
  const readInt = (mime: string): number | null => {
    const value = parseInt(e.dataTransfer.getData(mime))
    return Number.isInteger(value) ? value : null
  }
  return {
    fitId: readInt(MIME_FIT_ID),
    typeId: readInt(MIME_TYPE_ID),
    kind: e.dataTransfer.getData(MIME_KIND) || "",
    fromSlot: readInt(MIME_SLOT_INDEX) !== null,
  }
}

/** Handle a drop on the central ring; see the module comment. */
export function handleRingDrop(e: DragEvent): void {
  e.preventDefault()
  const { fitId, typeId, kind, fromSlot } = readRingDrop(e)
  const fitting = useFittingStore.getState()

  // An existing fit: open it.
  if (fitId !== null) {
    void fitting.open(fitId)
    return
  }
  if (typeId === null) return

  // A ship: create a fresh fit for it.
  if (kind === "ship") {
    void fitting.create(typeId)
    return
  }

  // A module dragged out of its slot is already fitted; dropping it back is a no-op.
  if (fromSlot) return

  if (kind === "drone") void fitting.addDroneStack(typeId)
  else void fitting.addItem({ id: typeId, itemKind: kind })
}

/**
 * Handle a drop on one fitted module.
 *
 * Ammunition is the one thing a module takes: dropping it there loads it into *that*
 * module only (not into the selected one, and not into every module that would accept
 * it). Everything else -- a module dragged from the browser, a ship, a fit -- keeps
 * behaving exactly like a drop on the ring.
 *
 * A charge the module cannot load is answered by the server with a refusal code, which
 * the fitting store turns into the red banner.
 *
 * ``position`` of -1 means the slot holds nothing: the drop then goes to the ring, which
 * is what an empty slot used to do.
 */
export function handleModuleDrop(e: DragEvent, position: number): void {
  const kind = e.dataTransfer.getData(MIME_KIND)
  if (kind !== "charge" || position < 0) {
    handleRingDrop(e)
    return
  }
  // The drop is answered here, so the ring below must not also act on it (that would
  // load the charge a second time, into the selected module or into every taker).
  e.preventDefault()
  e.stopPropagation()
  const chargeItemId = parseInt(e.dataTransfer.getData(MIME_TYPE_ID))
  if (!Number.isInteger(chargeItemId)) return
  void useFittingStore.getState().loadChargeInto(position, chargeItemId)
}

/** True when this drag carries something of ours, so a slot may accept it. */
export function isItemDrag(e: DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes(MIME_KIND)
}