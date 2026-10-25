/**
 * Ship browser and item search state: the tree, the selected ship and its fits,
 * and the item-details pane (attributes / charges / variations / skills).
 */
import { create } from "zustand"
import {
  api,
  type AttributeRow,
  type DetailTab,
  type EsiImportResult,
  type FitSummary,
  type FittedKind,
  type Item,
  type RequirementRow,
  type ShipCategory,
  type ShipSummary,
} from "../api"
import { errorText } from "../errors"
import { t } from "../i18n"
import { useSessionStore } from "./session"

/** How a race row is remembered collapsed: by category, group and race. */
export function raceKey(categoryKey: string, groupName: string, raceName: string): string {
  return `${categoryKey}/${groupName}/${raceName}`
}

interface BrowserState {
  categories: ShipCategory[]
  collapsedCategories: Record<string, boolean>
  collapsedRaces: Record<string, boolean>
  shipFilter: string
  shipSearchResults: ShipSummary[] | null
  allFits: FitSummary[]
  shipId: number | null
  ship: Item | null
  shipSlots: Record<string, number>
  shipFits: FitSummary[]
  shipFitsById: Record<number, FitSummary>
  loadingTree: boolean
  importing: boolean
  importNotice: string | null
  quietUntil: number
  // item search
  itemQuery: string
  itemScope: string
  itemResults: Item[]
  itemSearching: boolean
  itemSearchError: string
  // item details
  selectedItem: Item | null
  selectedTab: DetailTab
  detailLoading: boolean
  selectedAttributes: AttributeRow[]
  selectedAttributesModified: boolean
  selectedCharges: Item[]
  selectedVariations: Item[]
  selectedRequirements: RequirementRow[]
  // ui
  error: string
  notice: string

  loadTree: () => Promise<void>
  toggleCategory: (key: string) => void
  toggleRace: (key: string) => void
  selectShip: (shipId: number) => Promise<void>
  searchShips: (query: string) => Promise<void>
  importFromEsi: (silent?: boolean) => Promise<void>
  autoImportFromEsi: () => Promise<void>
  refreshFits: () => Promise<void>
  loadAllFits: () => Promise<void>
  invalidateFit: (fitId: number) => void
  noteFitAdded: (shipId: number) => void
  searchItems: (query: string) => Promise<void>
  selectItem: (
    item: Item,
    fit?: { id: number; position?: number | null; kind?: FittedKind },
    tab?: DetailTab,
  ) => Promise<void>
  clearItem: () => void
  setError: (error: unknown) => void
  showNotice: (text: string, timeout?: number) => void
}

export const useBrowserStore = create<BrowserState>((set, get) => ({
  categories: [],
  collapsedCategories: {},
  collapsedRaces: {},
  shipFilter: "",
  shipSearchResults: null,
  allFits: [],
  shipId: null,
  ship: null,
  shipSlots: {},
  shipFits: [],
  shipFitsById: {},
  loadingTree: false,
  importing: false,
  importNotice: null,
  quietUntil: 0,
  itemQuery: "",
  itemScope: "market",
  itemResults: [],
  itemSearching: false,
  itemSearchError: "",
  selectedItem: null,
  selectedTab: "attributes",
  detailLoading: false,
  selectedAttributes: [],
  selectedAttributesModified: false,
  selectedCharges: [],
  selectedVariations: [],
  selectedRequirements: [],
  error: "",
  notice: "",

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

  async loadTree() {
    if (get().loadingTree || get().categories.length) return
    set({ loadingTree: true })
    try {
      const { categories } = await api.shipTree()
      set({ categories })
    } catch (error) {
      get().setError(error)
    } finally {
      set({ loadingTree: false })
    }
  },

  toggleCategory(key: string) {
    set((state) => ({ collapsedCategories: { ...state.collapsedCategories, [key]: !state.collapsedCategories[key] } }))
  },

  toggleRace(key: string) {
    set((state) => ({ collapsedRaces: { ...state.collapsedRaces, [key]: !state.collapsedRaces[key] } }))
  },

  async selectShip(shipId: number) {
    set({ shipId, shipSearchResults: null, shipFilter: "" })
    try {
      const { ship, slots, fits } = await api.ship(shipId)
      const byId: Record<number, FitSummary> = {}
      for (const fit of fits) byId[fit.id] = fit
      set({ ship, shipSlots: slots, shipFits: fits, shipFitsById: byId })
    } catch (error) {
      get().setError(error)
    }
  },

  async searchShips(query: string) {
    set({ shipFilter: query })
    if (!query.trim()) {
      set({ shipSearchResults: null })
      return
    }
    try {
      const { results } = await api.searchShips(query.trim())
      set({ shipSearchResults: results })
    } catch (error) {
      get().setError(error)
    }
  },

  async importFromEsi(silent = false) {
    set({ importing: true })
    try {
      const result = await api.importEsiFittings()
      // The auto import on startup stays quiet unless it actually brought new
      // fits in; a manual import always reports (including "none in EVE").
      if (!silent || result.imported.length > 0) get().showNotice(importNotice(result), 12000)
      get().quietUntil = Date.now() + 3000
      await get().refreshFits()
      await get().loadAllFits()
    } catch (error) {
      // Startup must never show an ESI outage banner; a manual import does.
      if (!silent) get().setError(error)
    } finally {
      set({ importing: false })
    }
  },

  /** Signing in loads the pilot's in-game fittings automatically, once per startup. */
  async autoImportFromEsi() {
    const { user } = useSessionStore.getState()
    if (!user) return
    await get().importFromEsi(true)
  },

  async refreshFits() {
    const shipId = get().shipId
    if (shipId === null) return
    try {
      const { fits } = await api.fits(shipId)
      const byId: Record<number, FitSummary> = {}
      for (const fit of fits) byId[fit.id] = fit
      set({ shipFits: fits, shipFitsById: byId })
    } catch {
      // the ship may have been deselected; that is not worth an error banner
    }
  },

  invalidateFit(fitId: number) {
    const byId = { ...get().shipFitsById }
    delete byId[fitId]
    set({ shipFitsById: byId, shipFits: Object.values(byId) })
    void get().loadAllFits()
  },

  /** Every fit of this session (per character), for the Hull & Fits tree. */
  async loadAllFits() {
    try {
      const { fits } = await api.fits()
      set({ allFits: fits })
    } catch {
      // the fits list is not critical; the tree still works without it
    }
  },

  noteFitAdded(shipId: number) {
    if (shipId === get().shipId) void get().refreshFits()
  },

  async searchItems(query: string) {
    set({ itemQuery: query })
    if (!query.trim()) {
      set({ itemResults: [] })
      return
    }
    set({ itemSearching: true, itemSearchError: "" })
    try {
      const { results } = await api.searchItems(query.trim(), get().itemScope)
      set({ itemResults: results })
    } catch (error) {
      set({ itemResults: [], itemSearchError: error instanceof Error ? error.message : String(error) })
    } finally {
      set({ itemSearching: false })
    }
  },

  async selectItem(item, fit, tab = "attributes") {
    const fitted = fit && fit.position != null ? fit : null
    const moduleRow = fitted && (fitted.kind === undefined || fitted.kind === "module") ? fitted : null
    set({
      selectedItem: item,
      selectedTab: tab,
      detailLoading: true,
      selectedAttributes: [],
      selectedCharges: [],
      selectedVariations: [],
      selectedRequirements: [],
    })
    try {
      const [attributes, charges, variations, requirements] = await Promise.all([
        api.attributes(item.id, fitted?.id, fitted?.position ?? undefined, fitted?.kind),
        api.charges(item.id, moduleRow?.id, moduleRow?.position ?? undefined),
        api.variations(item.id),
        api.requirements(item.id),
      ])
      set({
        selectedAttributes: attributes.rows,
        selectedAttributesModified: attributes.modified,
        selectedCharges: charges.charges.map((entry) => entry.item),
        selectedVariations: variations.variations,
        selectedRequirements: requirements.skills,
      })
    } catch {
      // an item without attributes is not worth surfacing as an error
    } finally {
      set({ detailLoading: false })
    }
  },

  clearItem() {
    set({
      selectedItem: null,
      selectedTab: "attributes",
      selectedAttributes: [],
      selectedCharges: [],
      selectedVariations: [],
      selectedRequirements: [],
    })
  },
}))

/** What to say after an ESI import: what arrived, and why the rest did not. */
function importNotice(result: EsiImportResult): string {
  const skipped: Record<string, number> = {}
  for (const entry of result.skipped) skipped[entry.reason] = (skipped[entry.reason] ?? 0) + 1

  const parts: string[] = []
  if (result.imported.length) {
    parts.push(t("Imported {count} fits from {name}", { count: result.imported.length, name: result.character.name }))
  }
  if (skipped.alreadyImported) parts.push(t("{count} were already in pyfa", { count: skipped.alreadyImported }))
  if (skipped.unknownShip) parts.push(t("{count} are for ships this game data does not know", { count: skipped.unknownShip }))
  if (skipped.unreadable) parts.push(t("{count} could not be read", { count: skipped.unreadable }))
  if (!parts.length) return t("EVE has no fitting saved for {name}", { name: result.character.name })
  return parts.join("; ")
}
