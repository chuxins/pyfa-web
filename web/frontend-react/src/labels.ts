/**
 * Shared rack / state vocabulary. The English keys are what pyfa's own catalogue
 * uses, so `t()` renders the Chinese word for each.
 */
import { t } from "./i18n"

export const RACK_ORDER = ["high", "med", "low", "rig", "subsystem", "service", "mode", "system"] as const

export const RACK_LABELS: Record<string, string> = {
  high: "High power",
  med: "Medium power",
  low: "Low power",
  rig: "Rig slot",
  subsystem: "Subsystem",
  service: "Service",
  mode: "Mode",
  system: "System",
}

export const STATE_LABELS: Record<string, string> = {
  offline: "offline",
  online: "online",
  active: "active",
  overheated: "overheated",
}

export function rackLabel(name: string): string {
  return t(RACK_LABELS[name] ?? name)
}

export function stateLabel(state: string): string {
  return t(STATE_LABELS[state] ?? state)
}
