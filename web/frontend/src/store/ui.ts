/**
 * Small UI state: which dialogs are open, which slot's picker is up, and which fitted
 * module the pointer is over (for the effect card).
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

/**
 * The fitted module the pointer is over, plus where the pointer was when it got
 * there. The card is drawn from here rather than from the slot itself: the ring
 * wraps every slot in a rotated container, so a card rendered inside one would be
 * rotated with it.
 */
export interface ModuleHoverState {
  position: number
  itemId: number
  x: number
  y: number
}

/** 页面内确认框的一次提问：几个出口由调用方决定。 */
export interface ConfirmChoice {
  id: string
  label: string
  primary?: boolean
  danger?: boolean
}

export interface ConfirmRequest {
  title: string
  message: string
  choices: ConfirmChoice[]
  resolve: (choice: string) => void
}

interface UiState {
  confirm: ConfirmRequest | null
  /** 弹一个页面内确认框，返回用户点的那个出口 id。 */
  ask: (request: { title: string; message: string; choices: ConfirmChoice[] }) => Promise<string>
  answerConfirm: (choice: string) => void
  importExportOpen: boolean
  slotPicker: SlotPickerState | null
  preview: PreviewState | null
  moduleHover: ModuleHoverState | null
  openImportExport: () => void
  closeImportExport: () => void
  openSlotPicker: (slot: string, position: number) => void
  closeSlotPicker: () => void
  setPreview: (preview: PreviewState | null) => void
  setModuleHover: (hover: ModuleHoverState | null) => void
}

export const useUiStore = create<UiState>((set, get) => ({
  confirm: null,

  ask: (request) =>
    new Promise<string>((resolve) => {
      set({ confirm: { ...request, resolve } })
    }),

  answerConfirm: (choice) => {
    const current = get().confirm
    set({ confirm: null })
    current?.resolve(choice)
  },

  importExportOpen: false,
  slotPicker: null,
  preview: null,
  moduleHover: null,
  openImportExport: () => set({ importExportOpen: true }),
  closeImportExport: () => set({ importExportOpen: false }),
  openSlotPicker: (slot, position) => set({ slotPicker: { slot, position } }),
  closeSlotPicker: () => set({ slotPicker: null }),
  setPreview: (preview) => set({ preview }),
  setModuleHover: (moduleHover) => set({ moduleHover }),
}))
