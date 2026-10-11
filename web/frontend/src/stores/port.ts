/**
 * Fit text import/export, XML backup/restore and mutated-item parsing
 * (`/api/port`, `/api/fits/{id}/export`, `/api/backup`, `/api/items/mutant/parse`).
 *
 * The dialog owns most of the state -- which tab, what was pasted, the chosen
 * format -- so this store only carries the shared busy flag, the last import
 * result the dialog reports, and the actions. Importing is a write that changes
 * the set of fits, so a successful import refreshes the ship tree the way the
 * ESI import does, and reloads the open fit when item text was applied to it
 * (the apply goes through the undo stack, so the fit's own history changed too).
 */
import { defineStore } from 'pinia'
import { api, ExportFormat, PortImportResult } from '@/api'
import { errorText } from '@/errors'
import { t } from '@/i18n'
import { useBrowserStore } from '@/stores/browser'
import { useFittingStore } from '@/stores/fitting'

export const usePortStore = defineStore('port', {
  state: () => ({
    busy: false,
    error: '' as string,
    notice: '' as string,
    /** What the last import did, for the dialog's result area */
    lastImport: null as PortImportResult | null,
  }),

  actions: {
    setError(error: unknown) {
      this.error = errorText(error)
      window.setTimeout(() => {
        if (this.error) this.error = ''
      }, 8000)
    },

    showNotice(text: string, timeout = 8000) {
      this.notice = text
      window.setTimeout(() => {
        if (this.notice === text) this.notice = ''
      }, timeout)
    },

    /**
     * Import fit text. Without `targetFitId` every recognised fit is saved as
     * new; with one, item-level text (mutated module, drones, implants, ...) is
     * applied to that fit through the undoable command stack, exactly like the
     * desktop paste into an open fit. Returns the result, or null on a refusal.
     */
    async importText(text: string, targetFitId: number | null = null): Promise<PortImportResult | null> {
      this.busy = true
      try {
        const result = await api.portImport(text, targetFitId)
        this.lastImport = result
        // Our own `fits.imported` SSE echo is already on its way; this refresh is
        // the reliable one, and `quietUntil` keeps that handler from repeating it.
        const browser = useBrowserStore()
        browser.quietUntil = Date.now() + 3000
        void browser.refreshFits()
        if (result.appliedToFitId !== null) {
          const fitting = useFittingStore()
          if (fitting.fit?.id === result.appliedToFitId) await fitting.reload()
        }
        return result
      } catch (error) {
        this.setError(error)
        return null
      } finally {
        this.busy = false
      }
    },

    /** Export a saved fit as text; the dialog downloads it or copies it. */
    async exportFit(fitId: number, format: ExportFormat, options: Record<string, boolean> = {}) {
      this.busy = true
      try {
        return await api.exportFit(fitId, format, options)
      } catch (error) {
        this.setError(error)
        return null
      } finally {
        this.busy = false
      }
    },

    /** Every fit of this user as one XML document, for the browser to save. */
    async exportBackup() {
      this.busy = true
      try {
        return await api.backupExport()
      } catch (error) {
        this.setError(error)
        return null
      } finally {
        this.busy = false
      }
    },

    /** Restore fits from a backup XML document. */
    async importBackup(text: string) {
      this.busy = true
      try {
        const result = await api.backupImport(text)
        const browser = useBrowserStore()
        browser.quietUntil = Date.now() + 3000
        void browser.refreshFits()
        this.showNotice(t('Backup restored {count} fit(s)', { count: result.imported }))
        return result
      } catch (error) {
        this.setError(error)
        return null
      } finally {
        this.busy = false
      }
    },
  },
})
