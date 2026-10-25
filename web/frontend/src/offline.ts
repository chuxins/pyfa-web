/**
 * Offline-mode development interface.
 *
 * Offline mode is deliberately NOT implemented yet (the requirement is to keep the
 * interface, not the feature): the app is server-authoritative, and the pyfa-web
 * backend is the single source of fit data and calculation.
 *
 * What is kept, so offline mode can be added later without touching the UI:
 *  - `OFFLINE_DATA_SOURCE`: the seam through which a future offline engine would
 *    answer the same calls the `api` module makes. It currently throws, so any
 *    accidental wiring fails loudly instead of silently returning stale data.
 *  - `VITE_OFFLINE` flag (`import.meta.env.VITE_OFFLINE === "1"`): when set, the
 *    app boots into a banner that says the offline engine is not built, instead of
 *    pretending to work without the server.
 *  - The backend's dev login (`PYFA_WEB_DEV_AUTH_BYPASS=1` / `--dev-login`) is the
 *    supported development-only authentication path; it still uses the server.
 */

export interface OfflineDataSource {
  /** Same shape as the api() client; implement with local data + local engine. */
  meta(): Promise<unknown>
  shipsTree(): Promise<unknown>
  fits(): Promise<unknown>
}

/** The future offline engine. Deliberately absent: see the module docstring. */
export function offlineDataSource(): OfflineDataSource {
  throw new Error("Offline mode is not implemented; VITE_OFFLINE is a dev-only interface")
}

/** Whether the app was started in offline mode. Currently only shows a banner. */
export function offlineModeEnabled(): boolean {
  return import.meta.env.VITE_OFFLINE === "1"
}
