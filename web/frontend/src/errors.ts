/**
 * Refused edits, said in the reader's language.
 *
 * web/services/commands.py answers a refused edit with an English sentence plus a
 * `code` naming the reason and the values that belong in the sentence; the
 * templates below are keyed by code so the catalogue can translate them.
 */
import { ApiError } from "./api"
import { t } from "./i18n"

const TEMPLATES: Record<string, string> = {
  engineRefused: "the engine refused to run '{command}'; the item may not fit, or the target is invalid",
  unknownItem: "there is no item with id {itemId} in the game data",
  isACharge: "'{name}' is ammunition ({group}), not a module: load it into a fitted module instead",
  notAModule: "'{name}' is a {group}, not a module, so it cannot go into a slot",
  noSlot: "'{name}' has no slot to fit into",
  noFreeSlot: "the fit has no free {rack} slot for '{name}'",
  notAllowedOnShip: "'{name}' is restricted to certain hulls and cannot be fitted to a {ship}",
  tooBig: "'{name}' is a capital-size module and is too big for a {ship}",
  wrongRigSize: "'{name}' is the wrong size for the rig slots of a {ship}",
  noHardpoint: "the fit has no free {hardpoint} hardpoint for '{name}'",
  doesNotFit: "'{name}' does not fit this fit",
  stateUnchanged: "'{name}' is already {state}",
  undoFailed: "undo failed; the fit may have changed underneath",
  redoFailed: "redo failed; the fit may have changed underneath",
  droneBandwidthExceeded:
    "'{name}' needs {needed} Mbit/s of drone bandwidth; this fit has {available} of {total} left",
  droneControlLimitExceeded: "the ship can keep {limit} drones in space at once and {active} already are",
  noCharacter: "this account has no {server} EVE login stored on the server; sign in with EVE again",
  missingScope:
    "the login does not include permission to read implants; sign out and sign in with EVE again to approve it",
  tokenRefused: "EVE no longer accepts the stored login; sign in with EVE again",
  esiUnreachable: "EVE's ESI could not be reached; try again in a moment",
  esiRefused: "EVE refused to hand over the fittings ({reason})",
  esiUnusable: "EVE did not answer with a list of fittings, so none were imported",
  esiFailed: "the fittings could not be imported; the server log has the reason",
  fitMissing: "the fit to export was not found; it may have been deleted",
  fitEmpty: "the fit has nothing fitted, so there is nothing to export",
  esiSaveRefused: "EVE refused to save the fitting ({reason})",
  esiExportFailed: "the fitting could not be exported; the server log has the reason",
  noGameFittingId: "this fit came in before the web kept its in-game id; delete it in the game first, then here",
  esiDeleteRefused: "EVE refused to delete the fitting ({reason}); nothing was deleted",
  notInGame: "this fit is not saved in EVE, so there is nothing to delete from the game",
  importUnreadable: "the import text could not be read; check the format and try again",
  importUnsupported: "no importable fit format was recognised in that text",
  importPartial: "the fit refused the imported items; nothing was applied",
  exportUnsupported: "that export format is not available for this fit",
}

const RACK_WORDS: Record<string, string> = {
  high: "High",
  med: "Med",
  low: "Low",
  rig: "Rig",
  subsystem: "Subsystem",
  service: "Service",
  mode: "Mode",
  system: "System",
}

const HARDPOINT_WORDS: Record<string, string> = {
  turret: "turret",
  launcher: "launcher",
}

const STATE_WORDS: Record<string, string> = {
  offline: "offline",
  online: "online",
  active: "active",
  overheated: "overheated",
}

const SSO_ERRORS: Record<string, string> = {
  loginExpired: "the sign-in took too long or was already used; start again",
  loginCancelled: "the sign-in was cancelled at EVE",
  ssoUnreachable: "EVE's login service could not be reached; try again in a moment",
  loginFailed: "EVE did not accept the sign-in; the server log has the reason",
}

/** The sentence for a `?sso_error=` code, or null when there is nothing to say. */
export function ssoErrorText(code: string | null): string | null {
  if (!code) return null
  return t(SSO_ERRORS[code] ?? "the sign-in did not complete")
}

/** The text to show for a failed call: the server's own words when it did not say why. */
export function errorText(error: unknown): string {
  if (error instanceof ApiError && error.detail) {
    const template = TEMPLATES[error.detail.code]
    if (template) {
      const params: Record<string, string | number> = { ...error.detail.params }
      if (typeof params.rack === "string") params.rack = t(RACK_WORDS[params.rack] ?? params.rack)
      if (typeof params.hardpoint === "string") params.hardpoint = t(HARDPOINT_WORDS[params.hardpoint] ?? params.hardpoint)
      if (typeof params.state === "string") params.state = t(STATE_WORDS[params.state] ?? params.state)
      return t(template, params)
    }
  }
  if (error instanceof Error) return error.message
  return String(error)
}
