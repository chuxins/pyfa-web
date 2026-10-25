/**
 * The open fit, and everything that changes it.
 *
 * Every edit is one API call that submits one of pyfa's own commands; the response
 * is the whole refreshed fit plus the undo state, so there is no client-side model
 * of a fit that could drift from the engine's.
 */
import { create } from "zustand"
import { api, type Fit, type FitSummary, type History, type Module } from "../api"
import { errorText } from "../errors"
import { t } from "../i18n"
import { useBrowserStore } from "./browser"
import { useSessionStore } from "./session"

const RACK_ORDER = ["high", "med", "low", "rig", "subsystem", "service", "mode", "system"] as const

const LAST_FIT_KEY = "pyfa.lastFit"

function rememberFit(fitId: number) {
  try {
    window.localStorage.setItem(LAST_FIT_KEY, String(fitId))
  } catch {
    // Private mode, or storage turned off: remembered for this page only
  }
}

function rememberedFit(): number | null {
  try {
    const stored = window.localStorage.getItem(LAST_FIT_KEY)
    const fitId = stored === null ? Number.NaN : Number(stored)
    return Number.isInteger(fitId) ? fitId : null
  } catch {
    return null
  }
}

/** The (rack, position) pairs that hold an item, for diffing a fit before/after a command. */
function filledPositions(fit: Fit): Set<string> {
  const set = new Set<string>()
  for (const [rack, modules] of Object.entries(fit.racks ?? {})) {
    for (const module of modules ?? []) {
      if (!module.isEmpty) set.add(`${rack}:${module.position}`)
    }
  }
  return set
}

/** The slot a freshly added module landed in (the pair not present before). */
function firstNewPosition(before: Set<string>, fit: Fit): { rack: string; position: number } | null {
  for (const [rack, modules] of Object.entries(fit.racks ?? {})) {
    for (const module of modules ?? []) {
      if (!module.isEmpty && !before.has(`${rack}:${module.position}`)) return { rack, position: module.position }
    }
  }
  return null
}

export interface FittingState {
  fit: Fit | null
  history: History
  loading: boolean
  busy: boolean
  exporting: boolean
  error: string
  notice: string
  armedDeleteId: number | null
  selectedModule: number | null
  weaponGroups: boolean
  quietUntil: number
  stream: EventSource | null

  open: (fitId: number) => Promise<void>
  applyFit: (fit: Fit) => void
  openLast: () => Promise<void>
  reload: () => Promise<void>
  refreshStats: () => Promise<void>
  create: (shipId: number, name?: string) => Promise<number | null>
  send: (command: string, args?: Record<string, unknown>) => Promise<Fit | null>
  changeCharacter: (characterId: number) => Promise<Fit | null>
  undo: () => Promise<void>
  redo: () => Promise<void>
  reset: () => Promise<void>
  rename: (name: string) => Promise<void>
  fitText: () => Promise<string | null>
  exportTxt: () => Promise<string | null>
  exportToGame: () => Promise<unknown>
  removeFit: (fitId: number, fit: FitSummary, opts?: { confirmed?: boolean }) => Promise<boolean>
  armDelete: (fitId: number) => void
  disarmDelete: () => void
  remove: () => Promise<number | null>
  saveAs: () => Promise<FitSummary | null>
  addItem: (item: { id: number; itemKind: string }) => Promise<Fit | null>
  promptForMissingFit: () => null
  loadCharge: (chargeItemId: number) => Promise<Fit | null>
  moduleAt: (position: number) => Module | null
  groupMates: (module: { position: number; itemId?: number | null }) => number[]
  toggleWeaponGroups: () => void
  cycleModuleState: (
    module: { position: number; itemId: number | null },
    click: "cycle" | "left" | "right" | "ctrl",
  ) => Promise<Fit | null>
  removeModule: (module: { position: number }) => Promise<Fit | null>
  swapModules: (position1: number, position2: number) => Promise<Fit | null>
  addModuleToSlot: (itemId: number, targetPosition: number | null, targetRack: string | null) => Promise<Fit | null>
  loadChargeAt: (position: number, chargeItemId: number | null) => Promise<Fit | null>
  addCargoStack: (itemId: number, amount?: number) => Promise<Fit | null>
  addDroneStack: (itemId: number, amount?: number) => Promise<Fit | null>
  setDroneAmount: (position: number, amount: number) => Promise<Fit | null>
  toggleDrone: (position: number) => Promise<Fit | null>
  removeDrone: (position: number) => Promise<Fit | null>
  removeCargo: (itemId: number) => Promise<Fit | null>
  setCargoAmount: (itemId: number, amount: number) => Promise<Fit | null>
  toggleImplant: (position: number) => Promise<Fit | null>
  removeImplant: (position: number) => Promise<Fit | null>
  toggleBooster: (position: number) => Promise<Fit | null>
  removeBooster: (position: number) => Promise<Fit | null>
  setError: (error: unknown) => void
  showNotice: (text: string, timeout?: number) => void
  connect: () => void
  disconnect: () => void
}

export const useFittingStore = create<FittingState>((set, get) => ({
  fit: null,
  history: { canUndo: false, canRedo: false, depth: 0, undoName: null, redoName: null },
  loading: false,
  busy: false,
  exporting: false,
  error: "",
  notice: "",
  armedDeleteId: null,
  selectedModule: null,
  weaponGroups: false,
  quietUntil: 0,
  stream: null,

  setError(error: unknown) {
    // A refusal carries a code and its values, so the banner can be in the
    // reader's language rather than the server's (see errors.ts)
    const text = errorText(error)
    set({ error: text })
    window.setTimeout(() => {
      if (get().error === text) set({ error: "" })
    }, 6000)
  },

  showNotice(text: string, timeout = 2500) {
    set({ notice: text })
    window.setTimeout(() => {
      if (get().notice === text) set({ notice: "" })
    }, timeout)
  },

  applyFit(fit: Fit) {
    set({ fit, quietUntil: Date.now() + 1500 })
    if (fit.history) set({ history: fit.history })
  },

  async open(fitId: number) {
    set({ loading: true })
    try {
      const fit = await api.fit(fitId)
      get().applyFit(fit)
      set({ selectedModule: null, weaponGroups: false })
      rememberFit(fitId)
    } catch (error) {
      get().setError(error)
    } finally {
      set({ loading: false })
    }
  },

  async openLast() {
    if (get().fit) return
    let fits: FitSummary[]
    try {
      ;({ fits } = await api.fits())
    } catch (error) {
      get().setError(error)
      return
    }
    const remembered = rememberedFit()
    const chosen = fits.find((entry) => entry.id === remembered) ?? fits[0]
    if (chosen) await get().open(chosen.id)
  },

  async reload() {
    const current = get().fit
    if (!current) return
    const fit = await api.fit(current.id)
    get().applyFit(fit)
  },

  async refreshStats() {
    const current = get().fit
    if (!current) return
    const { stats } = await api.stats(current.id)
    const fit = get().fit
    if (fit) set({ fit: { ...fit, stats } })
  },

  async create(shipId: number, name?: string) {
    set({ busy: true })
    try {
      const fit = await api.createFit(shipId, name)
      get().applyFit(fit)
      set({ weaponGroups: false })
      await get().reload()
      return fit.id
    } catch (error) {
      get().setError(error)
      return null
    } finally {
      set({ busy: false })
    }
  },

  async send(command: string, args: Record<string, unknown> = {}) {
    const current = get().fit
    if (!current) return null
    set({ busy: true })
    try {
      const fit = await api.runCommand(current.id, command, args)
      get().applyFit(fit)
      return fit
    } catch (error) {
      get().setError(error)
      return null
    } finally {
      set({ busy: false })
    }
  },

  async undo() {
    const current = get().fit
    if (!current) return
    set({ busy: true })
    try {
      get().applyFit(await api.undo(current.id))
    } catch (error) {
      get().setError(error)
    } finally {
      set({ busy: false })
    }
  },

  async redo() {
    const current = get().fit
    if (!current) return
    set({ busy: true })
    try {
      get().applyFit(await api.redo(current.id))
    } catch (error) {
      get().setError(error)
    } finally {
      set({ busy: false })
    }
  },

  async reset() {
    const current = get().fit
    if (!current) return
    set({ busy: true })
    try {
      await api.resetFit(current.id)
      await get().reload()
      set({ history: await api.history(current.id) })
      get().showNotice(t("Fit cleared"), 2500)
    } catch (error) {
      get().setError(error)
    } finally {
      set({ busy: false })
    }
  },

  async rename(name: string) {
    await get().send("renameFit", { name })
  },

  /** Switch the fit to another character's skills (a preset or a signed-in pilot). */
  async changeCharacter(characterId: number) {
    const fit = get().fit
    if (!fit || fit.character?.id === characterId) return null
    return get().send("changeChar", { characterId })
  },

  /** Fetch the fit as EFT text without downloading. Open to guests like every other fit action. */
  async fitText() {
    const fit = get().fit
    if (!fit) return null
    try {
      return await api.exportFitTxt(fit.id)
    } catch (error) {
      get().setError(error)
      return null
    }
  },

  /** Download the fit as EFT text. Open to guests like every other fit action. */
  async exportTxt() {
    const fit = get().fit
    if (!fit) return null
    set({ exporting: true })
    try {
      const text = await get().fitText()
      if (text === null) return null
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `${fit.name || "fit"}.txt`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      get().showNotice(t("Exported {name} as text", { name: fit.name }), 4000)
      return text
    } catch (error) {
      get().setError(error)
      return null
    } finally {
      set({ exporting: false })
    }
  },

  /** Save the fit into the EVE client of the pilot's login; asks for a login first. */
  async exportToGame() {
    const fit = get().fit
    if (!fit) return get().promptForMissingFit()
    const session = useSessionStore.getState()
    if (!session.user) {
      session.promptLogin("export")
      return null
    }
    set({ exporting: true })
    try {
      const result = await api.exportFitToGame(fit.id)
      get().showNotice(t("Saved '{name}' to {character} in EVE", { name: result.name, character: result.character.name }), 5000)
      return result
    } catch (error) {
      get().setError(error)
      return null
    } finally {
      set({ exporting: false })
    }
  },

  /** Delete a fit the web owns; game-held fits need an armed second click.
   *  Callers that already showed their own confirmation dialog pass {confirmed:true}
   *  to skip the arm step and the built-in window.confirm. */
  async removeFit(fitId: number, fit: FitSummary, opts?: { confirmed?: boolean }): Promise<boolean> {
    const inGame = fit.fromGame || fit.importedToGame
    const confirmed = opts?.confirmed === true
    if (!confirmed) {
      if (inGame && get().armedDeleteId !== fitId) {
        get().armDelete(fitId)
        get().showNotice(
          t("This fit is also in EVE; deleting it removes it from the website and from the game. Click delete again to confirm."),
          6000,
        )
        return false
      }
      get().disarmDelete()
      if (inGame) {
        if (!window.confirm(t("Delete this fit from the website and from EVE?"))) return false
      } else if (!window.confirm(t("Delete this fit?"))) {
        return false
      }
    } else {
      get().disarmDelete()
    }
    try {
      await api.deleteFit(fitId)
      if (get().fit?.id === fitId) set({ fit: null })
      get().showNotice(inGame ? t("This fit was deleted from the website and from EVE") : t("This fit was deleted"), 4000)
      const browser = useBrowserStore.getState()
      void browser.refreshFits()
      void browser.loadAllFits()
      return true
    } catch (error) {
      get().setError(error)
      return false
    }
  },

  /** Arm a game fit's delete button: the next click on it really deletes. */
  armDelete(fitId: number) {
    set({ armedDeleteId: fitId })
    window.setTimeout(() => {
      if (get().armedDeleteId === fitId) set({ armedDeleteId: null })
    }, 6000)
  },

  disarmDelete() {
    set({ armedDeleteId: null })
  },

  /** The open fit's delete button. */
  async remove() {
    const fit = get().fit
    if (!fit) return null
    const summary: FitSummary = {
      id: fit.id,
      name: fit.name,
      booster: fit.booster,
      shipId: fit.ship.id,
      shipName: fit.ship.item.name,
      shipIconId: fit.ship.item.iconId,
      shipGraphicId: fit.ship.item.graphicId,
      shipImage: fit.ship.item.image,
      modified: fit.modified,
      notes: fit.notes,
      fromGame: fit.fromGame,
      importedToGame: fit.importedToGame,
      esiFittingId: fit.esiFittingId,
    }
    return (await get().removeFit(fit.id, summary)) ? fit.id : null
  },

  /** Save the open fit as a new web fit, and open the copy. */
  async saveAs() {
    const fit = get().fit
    if (!fit) return get().promptForMissingFit()
    try {
      const clone = await api.duplicateFit(fit.id)
      get().showNotice(t("The fit was saved as a new fit"), 4000)
      await get().open(clone.id)
      void useBrowserStore.getState().refreshFits()
      return clone
    } catch (error) {
      get().setError(error)
      return null
    }
  },

  async addItem(item: { id: number; itemKind: string }) {
    if (!get().fit) return get().promptForMissingFit()
    switch (item.itemKind) {
      case "module":
        return get().send("addLocalModule", { itemId: item.id })
      case "drone":
        return get().send("addLocalDrone", { itemId: item.id, amount: 5 })
      case "fighter":
        return get().send("addLocalFighter", { itemId: item.id })
      case "implant":
        return get().send("addImplant", { itemId: item.id })
      case "booster":
        return get().send("addBooster", { itemId: item.id })
      case "charge":
        return get().loadCharge(item.id)
      default:
        return get().send("addCargo", { itemId: item.id, amount: 1 })
    }
  },

  /** A write with no fit open is silently refused: the buttons just stay inert. */
  promptForMissingFit() {
    return null
  },

  /** Load a charge into the selected module, or every module that accepts it. */
  async loadCharge(chargeItemId: number) {
    const current = get().fit
    if (!current) return get().promptForMissingFit()
    const selectedModule = get().selectedModule
    if (selectedModule !== null) {
      const selected = get().moduleAt(selectedModule)
      const positions = selected ? [selected.position, ...get().groupMates(selected)] : [selectedModule]
      const result = await get().send("changeLocalModuleCharges", { positions, chargeItemId })
      if (result) {
        if (positions.length > 1) get().showNotice(t("Loaded into {count} modules", { count: positions.length }), 3000)
        return result
      }
    }
    const { targets } = await api.chargeTargets(current.id, chargeItemId)
    if (!targets.length) {
      get().setError(new Error(t("No fitted module can load this charge")))
      return null
    }
    if (targets.length === 1) {
      return get().send("changeLocalModuleCharges", { positions: [targets[0].position], chargeItemId })
    }
    const positions = targets.map((target) => target.position)
    const result = await get().send("changeLocalModuleCharges", { positions, chargeItemId })
    if (result) get().showNotice(t("Loaded into {count} modules", { count: positions.length }), 3000)
    return result
  },

  /** The module at a position; positions are indices into the fit's module list. */
  moduleAt(position: number): Module | null {
    const fit = get().fit
    if (!fit) return null
    for (const modules of Object.values(fit.racks ?? {})) {
      const found = (modules ?? []).find((module) => module.position === position)
      if (found) return found
    }
    return null
  },

  /** The other weapons that move with this one, when grouping is on and it has a twin. */
  groupMates(module: { position: number; itemId?: number | null }): number[] {
    const fit = get().fit
    if (!get().weaponGroups || module.itemId === null || module.itemId === undefined || !fit) return []
    const byType = new Map<number, number[]>()
    for (const m of fit.racks.high ?? []) {
      if (m.isEmpty || !m.hardpoint || m.itemId === null) continue
      const positions = byType.get(m.itemId) ?? []
      positions.push(m.position)
      byType.set(m.itemId, positions)
    }
    const group = [...byType.entries()].find(([itemId, positions]) => itemId === module.itemId && positions.length > 1)
    if (!group) return []
    return group[1].filter((position) => position !== module.position)
  },

  toggleWeaponGroups() {
    set({ weaponGroups: !get().weaponGroups })
  },

  async cycleModuleState(module, click) {
    return get().send("changeLocalModuleStates", {
      main: { kind: "module", position: module.position },
      positions: get().groupMates(module),
      click,
    })
  },

  async removeModule(module) {
    return get().send("removeLocalModules", { positions: [module.position] })
  },

  async swapModules(position1, position2) {
    return get().send("swapLocalModules", { position1, position2 })
  },

  /** Fit an item into one specific slot. The server puts it in the first free
   *  slot that accepts it; if that is not the requested slot it is swapped there. */
  async addModuleToSlot(itemId, targetPosition, targetRack) {
    const before = get().fit
    if (!before) return get().promptForMissingFit()
    const beforeSet = filledPositions(before)
    const result = await get().send("addLocalModule", { itemId })
    if (!result) return null
    const landed = firstNewPosition(beforeSet, result)
    if (landed !== null && targetPosition !== null && targetRack !== null) {
      const module = result.racks[landed.rack]?.find((m) => m.position === landed.position)
      if (module && module.slot === targetRack && module.position !== targetPosition) {
        return get().send("swapLocalModules", { position1: module.position, position2: targetPosition })
      }
    }
    return result
  },

  async loadChargeAt(position, chargeItemId) {
    if (!get().fit) return get().promptForMissingFit()
    return get().send("changeLocalModuleCharges", { positions: [position], chargeItemId })
  },

  async addCargoStack(itemId, amount = 1) {
    if (!get().fit) return get().promptForMissingFit()
    return get().send("addCargo", { itemId, amount })
  },

  async addDroneStack(itemId, amount = 5) {
    if (!get().fit) return get().promptForMissingFit()
    return get().send("addLocalDrone", { itemId, amount })
  },

  async setDroneAmount(position, amount) {
    return get().send("changeLocalDroneAmount", { position, amount })
  },

  async toggleDrone(position) {
    return get().send("toggleLocalDroneStates", { main: { kind: "drone", position } })
  },

  async removeDrone(position) {
    return get().send("removeLocalDrones", { positions: [position] })
  },

  async removeCargo(itemId) {
    return get().send("removeCargos", { itemIds: [itemId] })
  },

  async setCargoAmount(itemId, amount) {
    return get().send("changeCargosAmount", { itemIds: [itemId], amount })
  },

  async toggleImplant(position) {
    return get().send("toggleImplantStates", { main: { kind: "implant", position } })
  },

  async removeImplant(position) {
    return get().send("removeImplants", { positions: [position] })
  },

  async toggleBooster(position) {
    return get().send("toggleBoosterStates", { main: { kind: "booster", position } })
  },

  async removeBooster(position) {
    return get().send("removeBoosters", { positions: [position] })
  },

  /** Live updates: another tab editing the same fit refreshes this one. */
  connect() {
    if (get().stream) return
    const stream = new EventSource("/api/events")
    stream.addEventListener("fit.changed", (event) => {
      const payload = JSON.parse((event as MessageEvent).data)
      const fit = get().fit
      if (!fit) return
      if (Array.isArray(payload.fitIds) && payload.fitIds.includes(fit.id)) {
        // Skill simulations are unsaved, so they do not bump the fit's modified
        // timestamp; let the skills sidebar know on a dedicated event.
        window.dispatchEvent(new CustomEvent("pyfa:fit-skills-changed", { detail: { fitId: fit.id } }))
        if (Date.now() < get().quietUntil) return
        void get().refreshStats()
      }
    })
    stream.addEventListener("fits.imported", () => {
      const browser = useBrowserStore.getState()
      if (Date.now() < browser.quietUntil) return
      void browser.refreshFits()
      void browser.loadAllFits()
    })
    stream.addEventListener("fit.renamed", (event) => {
      const payload = JSON.parse((event as MessageEvent).data)
      if (get().fit) void get().refreshStats()
      if (typeof payload.fitId === "number") useBrowserStore.getState().invalidateFit(payload.fitId)
    })
    stream.addEventListener("fit.removed", (event) => {
      const payload = JSON.parse((event as MessageEvent).data)
      const current = get().fit
      if (current && Array.isArray(payload.fitIds) && payload.fitIds.includes(current.id)) {
        set({ fit: null })
        get().showNotice(t("This fit was deleted"), 4000)
      }
      for (const fitId of payload.fitIds ?? []) useBrowserStore.getState().invalidateFit(fitId)
    })
    set({ stream })
  },

  disconnect() {
    get().stream?.close()
    set({ stream: null })
  },
}))
