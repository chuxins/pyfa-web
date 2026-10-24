/**
 * Small UI state: which dialogs are open and which slot's picker is up.
 * Kept separate from the data stores so dialogs can be opened from anywhere.
 */
import { create } from "zustand"

export interface SlotPickerState {
  slot: string
  position: number
}

export interface PreviewState {
  itemId: number | null
  slotType: string | null
  kind: string
}

interface UiState {
  importExportOpen: boolean
  slotPicker: SlotPickerState | null
  preview: PreviewState | null
  openImportExport: () => void
  closeImportExport: () => void
  openSlotPicker: (slot: string, position: number) => void
  closeSlotPicker: () => void
  setPreview: (preview: PreviewState | null) => void
}

export const useUiStore = create<UiState>((set) => ({
  importExportOpen: false,
  slotPicker: null,
  preview: null,
  openImportExport: () => set({ importExportOpen: true }),
  closeImportExport: () => set({ importExportOpen: false }),
  openSlotPicker: (slot, position) => set({ slotPicker: { slot, position } }),
  closeSlotPicker: () => set({ slotPicker: null }),
  setPreview: (preview) => set({ preview }),
}))
