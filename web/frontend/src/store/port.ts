/**
 * Fit text import/export, XML backup/restore and mutated-item parsing
 * (/api/port, /api/fits/{id}/export, /api/backup, /api/items/mutant/parse).
 */
import { create } from "zustand"
import { api, type ExportFormat, type ExportedFile, type PortImportResult } from "../api"
import { errorText } from "../errors"
import { t } from "../i18n"
import { useBrowserStore } from "./browser"
import { useFittingStore } from "./fitting"

interface PortState {
  busy: boolean
  error: string
  notice: string
  lastImport: PortImportResult | null

  setError: (error: unknown) => void
  showNotice: (text: string, timeout?: number) => void
  importText: (text: string, targetFitId?: number | null) => Promise<PortImportResult | null>
  exportFit: (fitId: number, format: ExportFormat, options?: Record<string, boolean>) => Promise<ExportedFile | null>
  exportBackup: () => Promise<ExportedFile | null>
  importBackup: (text: string) => Promise<unknown>
}

export const usePortStore = create<PortState>((set, get) => ({
  busy: false,
  error: "",
  notice: "",
  lastImport: null,

  setError(error: unknown) {
    const text = errorText(error)
    set({ error: text })
    window.setTimeout(() => {
      if (get().error === text) set({ error: "" })
    }, 8000)
  },

  showNotice(text: string, timeout = 8000) {
    set({ notice: text })
    window.setTimeout(() => {
      if (get().notice === text) set({ notice: "" })
    }, timeout)
  },

  /** Import fit text. Without targetFitId every recognised fit is saved as new. */
  async importText(text: string, targetFitId: number | null = null) {
    set({ busy: true })
    try {
      const result = await api.portImport(text, targetFitId)
      set({ lastImport: result })
      const browser = useBrowserStore.getState()
      browser.quietUntil = Date.now() + 3000
      void browser.refreshFits()
      if (result.appliedToFitId !== null) {
        const fitting = useFittingStore.getState()
        if (fitting.fit?.id === result.appliedToFitId) await fitting.reload()
      }
      return result
    } catch (error) {
      get().setError(error)
      return null
    } finally {
      set({ busy: false })
    }
  },

  /** Export a saved fit as text; the dialog downloads it or copies it. */
  async exportFit(fitId: number, format: ExportFormat, options: Record<string, boolean> = {}) {
    set({ busy: true })
    try {
      return await api.exportFit(fitId, format, options)
    } catch (error) {
      get().setError(error)
      return null
    } finally {
      set({ busy: false })
    }
  },

  /** Every fit of this user as one XML document, for the browser to save. */
  async exportBackup() {
    set({ busy: true })
    try {
      return await api.backupExport()
    } catch (error) {
      get().setError(error)
      return null
    } finally {
      set({ busy: false })
    }
  },

  /** Restore fits from a backup XML document. */
  async importBackup(text: string) {
    set({ busy: true })
    try {
      const result = await api.backupImport(text)
      const browser = useBrowserStore.getState()
      browser.quietUntil = Date.now() + 3000
      void browser.refreshFits()
      get().showNotice(t("Backup restored {count} fit(s)", { count: result.imported }))
      return result
    } catch (error) {
      get().setError(error)
      return null
    } finally {
      set({ busy: false })
    }
  },
}))
