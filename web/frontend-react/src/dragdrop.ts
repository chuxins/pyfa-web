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
