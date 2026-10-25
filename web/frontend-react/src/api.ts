/**
 * Typed client for the pyfa-web API (FastAPI backend, port 8100).
 *
 * Shapes were captured live from the running server; see the Vue frontend's
 * `api.ts` for the same catalogue. The fit editor is server-authoritative: every
 * edit runs one command and the answer is the whole refreshed fit.
 */

export interface ImageRef {
  kind: "icons" | "renders" | "gui"
  id: number
}

/** One item from the game data, as the server serializes it. */
export interface Item {
  id: number
  name: string
  iconId: number | null
  graphicId: number | null
  image: ImageRef | null
  group: string
  category: string
  itemKind: string
  metaGroup: string | null
  description?: string | null
  marketGroup?: { id: number; name: string } | null
  volume?: number | null
  published?: boolean
  /** Slot-scope searches carry a size class (1 small .. 4 extra large, null: none) */
  size?: number | null
}

export type ModuleState = "offline" | "online" | "active" | "overheated"

/** One row of the market browser tree (see ``GET /api/items/market-tree``). */
export interface MarketTreeItem {
  id: number
  name: string
  /** English name, so the search box matches in either language. */
  nameEn: string
  kind: string
  metaGroupId: number | null
  slotType: "Low" | "Medium" | "High" | "Rig" | "SubSystem" | "Service" | null
}

/** One market group of the browser tree: children groups and its own items. */
export interface MarketGroup {
  id: number
  name: string
  groups: MarketGroup[]
  items: MarketTreeItem[]
}

/** One row of a rack. The server serializes every slot, empty ones included. */
export interface Module {
  position: number
  slot: string
  isEmpty: boolean
  itemId: number | null
  item: Item | null
  state: ModuleState
  amount: number
  charge?: { item: Item; amount: number } | null
  chargeItemId?: number | null
  canFitCharges?: boolean
  hardpoint?: string | null
  isMutated?: boolean
  isValidState?: boolean
  canOverheat?: boolean
  maxRange?: number | null
}

export interface Drone {
  position: number
  itemId: number | null
  item: Item | null
  amount: number
  state: ModuleState
  isMutated?: boolean
}

export interface Fighter {
  position: number
  itemId: number | null
  item: Item | null
  amount: number
  state: ModuleState
  abilities?: unknown[]
}

export interface CargoItem {
  itemId: number
  item: Item | null
  amount: number
}

export interface Implant {
  position: number
  itemId: number | null
  item: Item | null
  state: ModuleState
}

/** One implant on a character's own implant list (the implant simulator). */
export interface CharacterImplant {
  itemId: number
  item: Item | null
  /** implantness slot, 0 for cypher/booster-style slot-0 implants */
  slot: number
  active: boolean
  /** "esi": the clone carries it in game; "custom": added locally as a simulation */
  source: "esi" | "custom"
}

/** GET /api/characters/{id}/implants */
export interface CharacterImplants {
  id: number
  name: string
  implants: CharacterImplant[]
  /** True for the built-in All 5 / All 0 presets (their skill sheet is read-only;
   *  their implant list is still editable and applies to fits using the preset). */
  preset: boolean
  /** Whether this character has a stored EVE login to pull implants with. */
  hasSso: boolean
}

export interface Booster {
  position: number
  itemId: number | null
  item: Item | null
  active: boolean
  sideEffects: { id: number; name: string; active: boolean }[]
}

/** One switchable ship mode (tactical destroyer Defense/Propulsion/Sharpshooter, ...). */
export interface ShipMode {
  itemId: number
  item: Item
  /** Whether this is the mode the fit currently runs. */
  active: boolean
}

/** A fit summary row, as the fits list and the ship detail answer. */
export interface FitSummary {
  id: number
  name: string
  booster: boolean
  shipId: number
  shipName: string
  shipIconId: number | null
  shipGraphicId: number | null
  shipImage: ImageRef | null
  modified: string | null
  notes: string | null
  fromGame: boolean
  importedToGame: boolean
  esiFittingId: number | null
}

/** One option in the character strip: a skill preset or a signed-in EVE pilot. */
export interface MetaCharacter {
  id: number
  name: string
  kind: "preset" | "sso"
  default: boolean
}

/** The full serialized fit. */
export interface Fit {
  id: number
  name: string
  notes: string | null
  booster: boolean
  created: string | null
  modified: string | null
  timestamp: number
  calculated: boolean
  factorReload: boolean
  ignoreRestrictions: boolean
  fromGame: boolean
  importedToGame: boolean
  esiFittingId: number | null
  implantLocation: number
  systemSecurity: number
  pilotSecurity: number | null
  isStructure: boolean
  ship: {
    id: number
    item: Item
    slots: Record<string, number>
    traits?: string | null
    /** Switchable ship modes (tactical destroyers / Anhinga); null for other hulls. */
    modes?: ShipMode[] | null
  }
  character: { id: number; name: string; isDefault: boolean } | null
  damagePattern: {
    id: number
    name: string
    em: number
    thermal: number
    kinetic: number
    explosive: number
  } | null
  targetProfile: unknown
  racks: Record<string, Module[]>
  drones: Drone[]
  fighters: Fighter[]
  cargo: CargoItem[]
  implants: Implant[]
  appliedImplants: Implant[]
  boosters: Booster[]
  projected: {
    modules: unknown[]
    drones: unknown[]
    fighters: unknown[]
    fits: unknown[]
    commandFits: unknown[]
  }
  modCount: number
  stats?: Stats
  history?: History
}

export interface DamageTypes {
  em: number
  thermal: number
  kinetic: number
  explosive: number
  pure?: number
  total?: number
}

export interface SpooledDamage {
  value: DamageTypes
  preSpool: DamageTypes
  fullSpool: DamageTypes
}

export interface TankRow {
  passiveShield: number
  shieldRepair: number
  armorRepair: number
  hullRepair: number
  armorRepairPreSpool: number
  armorRepairFullSpool: number
}

/** Market valuation of one fit (see GET /api/fits/{id}/price). */
export interface FitPrice {
  fitId: number
  currency: string
  totals: {
    ship: number
    fittings: number
    drones: number
    cargoBay: number
    character: number
    total: number
  }
  lines: {
    itemId: number
    name: string
    qty: number
    unitPrice: number | null
    total: number | null
    status: "ok" | "noData" | "notSupported" | "unavailable"
  }[]
  missingCount: number
  missing: number[]
  /** True when at least one cached row is stale/absent and a refresh helps. */
  updating: boolean
  staleCount: number
  source: string
  region: string
  updated: number | null
}

export interface Stats {
  resources: {
    hardpoints: { turret: { used: number; total: number }; launcher: { used: number; total: number } }
    calibration: { used: number; total: number }
    cpu: { used: number; total: number }
    powergrid: { used: number; total: number }
    drones: {
      active: number
      maxActive: number
      bayUsed: number
      bayTotal: number
      bandwidthUsed: number
      bandwidthTotal: number
    }
    fighters: { tubesUsed: number; tubesTotal: number; bayUsed: number; bayTotal: number }
    cargo: { used: number; total: number }
    droneControlRange: number
  }
  firepower: {
    weapon: SpooledDamage
    drone: SpooledDamage
    volley: SpooledDamage
    dps: SpooledDamage
    defaultSpoolValue: number
    hasTargetProfile: boolean
  }
  mining: {
    miner: { yield: number; drain: number }
    drone: { yield: number; drain: number }
    total: { yield: number; drain: number }
  }
  capacitor: {
    capacity: number
    delta: number
    recharge: number
    rechargeRate: number
    used: number
    stable: boolean
    state: number
    resistance: number
    effectiveCapacity: number
  }
  tank: {
    normal: TankRow
    effective: TankRow
    sustained: TankRow
    effectiveSustained: TankRow
  }
  resistances: {
    hp: { shield: number; armor: number; hull: number; total: number }
    ehp: { shield: number; armor: number; hull: number; total: number }
    resistances: Record<"shield" | "armor" | "hull", Record<"em" | "thermal" | "kinetic" | "explosive", number>>
    damagePattern: { em: number; thermal: number; kinetic: number; explosive: number } | null
    damagePatternName: string | null
    targetProfileName: string | null
  }
  targeting: {
    targets: number
    maxTargetRange: number
    scanResolution: number
    sensorStrength: number
    scanType: string
    jamChance: number
    droneControlRange: number
    speed: number
    alignTime: number
    signatureRadius: number
    warpSpeed: number
    maxWarpDistance: number
    mass: number
    agility: number
    probeSize: number | null
    warpCoreStrength: number
    holds: { attr: string; label: string; capacity: number }[]
    lockTimes: { name: string; radius: number; time: number }[]
  }
  remoteReps: {
    value: { shield: number; armor: number; hull: number; capacitor: number }
    preSpool: { shield: number; armor: number; hull: number; capacitor: number }
    fullSpool: { shield: number; armor: number; hull: number; capacitor: number }
  }
  errors: Record<string, string>
}

export interface History {
  canUndo: boolean
  canRedo: boolean
  depth: number
  undoName: string | null
  redoName: string | null
}

// -- tree ----------------------------------------------------------------

export interface ShipSummary {
  id: number
  name: string
  iconId: number | null
  graphicId: number | null
  image: ImageRef | null
  fitCount: number
  race?: { id: number | null; name: string; order: number } | null
}

export interface ShipGroup {
  id: number
  name: string
  ships: ShipSummary[]
}

export interface ShipCategory {
  key: string
  name: string
  groups: ShipGroup[]
}

// -- details / browser ----------------------------------------------------

export interface AttributeRow {
  id: number
  name: string
  displayName: string
  value: number
  baseValue?: number
  unit: string | null
  highIsGood: boolean
  description?: string | null
}

export interface ChargeRow {
  item: Item
  amount: number | null
}

export interface RequirementRow {
  skillId: number
  name: string
  level: number
}

/** One skill that affects a fit (see GET /api/fits/{id}/skills). */
export interface FitSkillRow {
  id: number
  name: string
  image: ImageRef | null
  /** Highest level any fitted item (or prerequisite chain) demands. */
  requiredLevel: number
  /** The fit character's current level in the skill. */
  currentLevel: number
  met: boolean
  /** True when the skill is needed only through another skill's prerequisites. */
  prerequisiteOnly: boolean
  /** True for skills the pilot pinned to the fit by hand (custom section). */
  custom?: boolean
  /** True when the level is an unsaved simulation edit (differs from the saved sheet). */
  dirty?: boolean
  /** Fitted item names that require the skill directly. */
  sources: string[]
}

export interface FitSkills {
  id: number
  skills: FitSkillRow[]
  /** Skills the pilot pinned by hand; only the current level is shown. */
  custom: FitSkillRow[]
  missing: number
  total: number
  customTotal: number
  /** False for the built-in All 0 / All 5 presets, whose levels cannot be edited. */
  characterEditable: boolean
  /** Number of skills whose level is temporarily simulated (unsaved). */
  dirtyTotal: number
  /** Present on add responses: false when the skill was already pinned. */
  added?: boolean
}

export type DetailTab = "attributes" | "charges" | "variations" | "skills"

/** Which row of a fit an attribute click was on (see FittedKind). */
export type FittedKind = "module" | "drone" | "fighter" | "cargo" | "implant" | "booster" | "moduleCharge"

// -- import / export ------------------------------------------------------

export interface PortImportResult {
  /** The format the text was read as: eft, dna, smiley, xml, esi, ... */
  format: string
  /** The new fits the text created, one summary each. */
  created: FitSummary[]
  /** When item-level text was applied to an existing fit, its id. */
  appliedToFitId: number | null
  skipped: { reason: string; name: string }[]
}

export type ExportFormat = "eft" | "dna" | "smiley" | "xml" | "efs" | "esi"

export interface ExportedFile {
  filename: string
  contentType: string
  text: string
}

export interface EsiImportResult {
  character: { id: number; name: string }
  imported: { fitId: number; name: string }[]
  skipped: { reason: "alreadyImported" | "unknownShip" | "unreadable"; name: string }[]
}

export interface EsiExportResult {
  name: string
  character: { id: number; name: string }
  esiFittingId: number
}

export interface BackupImportResult {
  imported: number
}

export interface MutantParseResult {
  item: Item
  mutaplasmid: Item
  attributes: Record<string, number>
}

// -- graph ----------------------------------------------------------------

export interface GraphList {
  graphs: { id: string; name: string; xLabel: string | null; yLabel: string | null }[]
}

export interface GraphPlot {
  title: string
  xLabel: string | null
  yLabel: string | null
  series: { name: string; points: { x: number; y: number }[] }[]
}

export interface GraphPoint {
  title: string
  x: number
  y: number
  label: string
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/** The 401 hook: the session died while in use, ask for a login again. */
export let unauthorizedHandler: (() => void) | null = null
export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler
}

export class ApiError extends Error {
  status: number
  detail: { code: string; message: string; params: Record<string, string | number> } | null

  constructor(
    status: number,
    message: string,
    detail: { code: string; message: string; params: Record<string, string | number> } | null = null,
  ) {
    super(message)
    this.status = status
    this.detail = detail
  }
}

function parseBody(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function throwFor(response: Response, body: unknown): never {
  if (response.status === 401) unauthorizedHandler?.()
  const detail = body && typeof body === "object" ? (body as any).detail : body
  if (typeof detail === "string") throw new ApiError(response.status, detail)
  if (detail && typeof detail === "object" && typeof detail.message === "string") {
    throw new ApiError(response.status, detail.message, {
      message: detail.message,
      code: typeof detail.code === "string" ? detail.code : "engineRefused",
      params: detail.params ?? {},
    })
  }
  throw new ApiError(response.status, response.statusText)
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: init.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  })
  if (!response.ok) throwFor(response, parseBody(await response.text()))
  if (response.status === 204) return undefined as T
  // Some endpoints answer with plain text (EFT exports, ...): fall back to the
  // raw body when it is not JSON, like the Vue frontend's parseBody did.
  return parseBody(await response.text()) as T
}

/** A file the server answered with: the text plus its filename in Content-Disposition. */
async function requestFile(path: string, init: RequestInit = {}): Promise<ExportedFile> {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: init.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  })
  if (!response.ok) throwFor(response, parseBody(await response.text()))
  const disposition = response.headers.get("Content-Disposition") ?? ""
  const match = /filename="?([^";]+)"?/.exec(disposition)
  return {
    filename: match?.[1] ?? "export",
    contentType: response.headers.get("Content-Type") ?? "text/plain",
    text: await response.text(),
  }
}

/** The query that reads one row of a fit, or nothing when there is no fit. */
function fitQuery(fitId?: number, position?: number, kind?: FittedKind): string {
  if (fitId === undefined || position === undefined) return ""
  const query = new URLSearchParams({ fitId: String(fitId), position: String(position) })
  if (kind !== undefined) query.set("kind", kind)
  return `?${query}`
}

export function imageUrl(image: ImageRef | null | undefined, size: 1 | 2): string | null {
  if (!image) return null
  return `/img/${image.kind}/${image.id}@${size}x`
}

export const api = {
  meta: () =>
    request<{
      pyfaVersion: string
      webVersion: string
      language: string
      gamedata: { build: string; date: string }
      sso: { server: string; configured: boolean; devBypass: boolean }
      user: { id: number; characterId: number; characterName: string } | null
      characters: MetaCharacter[]
    }>("/api/meta"),

  me: () => request<{ authenticated: boolean; user?: any }>("/api/auth/me"),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),

  shipTree: () => request<{ categories: ShipCategory[] }>("/api/ships/tree"),
  searchShips: (q: string) => request<{ results: ShipSummary[] }>(`/api/ships/search?q=${encodeURIComponent(q)}`),
  ship: (shipId: number) =>
    request<{ ship: Item; slots: Record<string, number>; fits: FitSummary[] }>(`/api/ships/${shipId}`),

  fits: (shipId?: number) =>
    request<{ fits: FitSummary[]; count: number }>(`/api/fits${shipId === undefined ? "" : `?shipId=${shipId}`}`),
  searchFits: (q: string) => request<{ fits: FitSummary[] }>(`/api/fits?q=${encodeURIComponent(q)}`),
  fit: (fitId: number, stats = true) => request<Fit>(`/api/fits/${fitId}?stats=${stats}`),
  stats: (fitId: number) => request<{ id: number; stats: Stats }>(`/api/fits/${fitId}/stats`),
  fitPrice: (fitId: number) => request<FitPrice>(`/api/fits/${fitId}/price`),
  refreshFitPrice: (fitId: number) =>
    request<FitPrice>(`/api/fits/${fitId}/price/refresh`, { method: "POST" }),
  fitSkills: (fitId: number) => request<FitSkills>(`/api/fits/${fitId}/skills`),
  searchSkills: (q: string, limit = 20) =>
    request<{ query: string; results: Item[] }>(
      `/api/fits/skills/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    ),
  addCustomSkill: (fitId: number, skillId: number) =>
    request<FitSkills>(`/api/fits/${fitId}/custom-skills`, {
      method: "POST",
      body: JSON.stringify({ skillId }),
    }),
  removeCustomSkill: (fitId: number, skillId: number) =>
    request<FitSkills>(`/api/fits/${fitId}/custom-skills/${skillId}`, { method: "DELETE" }),
  /** Temporarily simulate a skill level on the fit's character (not persisted). */
  setSkillLevel: (fitId: number, skillId: number, level: number) =>
    request<FitSkills>(`/api/fits/${fitId}/skills/${skillId}/level`, {
      method: "PUT",
      body: JSON.stringify({ level }),
    }),
  /** Restore the character's saved skill sheet, discarding simulated levels. */
  resetSkills: (fitId: number) =>
    request<FitSkills>(`/api/fits/${fitId}/skills/reset`, { method: "POST" }),

  // -- character implants (implant simulator) ---------------------------------

  /** Search the implant catalogue for the add-implant picker. */
  searchImplants: (q: string, excludeIds: number[] = []) =>
    request<{ query: string; results: Item[] }>(
      `/api/implants/search?q=${encodeURIComponent(q)}&limit=50&exclude=${excludeIds.join(",")}`,
    ),
  /** The implants stored on one character (the list a fit applies when its
   *  implant location is "character"). */
  characterImplants: (characterId: number) =>
    request<CharacterImplants>(`/api/characters/${characterId}/implants`),
  /** Add one implant to a character's own list. Returns the updated list (and
   *  the refreshed fit when fitId is given and it uses character implants). */
  addCharacterImplant: (characterId: number, itemId: number, fitId?: number) =>
    request<CharacterImplants & { added?: boolean; fit?: Fit }>(
      `/api/characters/${characterId}/implants${fitId === undefined ? "" : `?fitId=${fitId}`}`,
      { method: "POST", body: JSON.stringify({ itemId }) },
    ),
  /** Remove one implant from a character's own list. */
  removeCharacterImplant: (characterId: number, itemId: number, fitId?: number) =>
    request<CharacterImplants & { removed?: boolean; fit?: Fit }>(
      `/api/characters/${characterId}/implants/${itemId}${fitId === undefined ? "" : `?fitId=${fitId}`}`,
      { method: "DELETE" },
    ),
  /** Pull the implants the pilot's clone carries in game and reconcile. */
  syncCharacterImplants: (characterId: number, fitId?: number) =>
    request<CharacterImplants & { fit?: Fit }>(
      `/api/characters/${characterId}/implants/sync-esi${fitId === undefined ? "" : `?fitId=${fitId}`}`,
      { method: "POST" },
    ),
  graphList: (fitId: number) => request<GraphList>(`/api/fits/${fitId}/graphs`),
  graphPlot: (fitId: number, graphId: string, params: Record<string, string>) =>
    request<GraphPlot>(`/api/fits/${fitId}/graphs/${graphId}/plot?${new URLSearchParams(params)}`),
  graphPoint: (fitId: number, graphId: string, params: Record<string, string>) =>
    request<GraphPoint>(`/api/fits/${fitId}/graphs/${graphId}/point?${new URLSearchParams(params)}`),
  createFit: (shipId: number, name?: string) =>
    request<Fit>("/api/fits", { method: "POST", body: JSON.stringify({ shipId, name }) }),
  updateFit: (fitId: number, patch: Partial<{ name: string; notes: string; factorReload: boolean }>) =>
    request<Fit>(`/api/fits/${fitId}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteFit: (fitId: number) => request<void>(`/api/fits/${fitId}`, { method: "DELETE" }),
  duplicateFit: (fitId: number) => request<FitSummary>(`/api/fits/${fitId}/duplicate`, { method: "POST" }),

  importEsiFittings: () => request<EsiImportResult>("/api/esi/fittings/import", { method: "POST" }),
  exportFitTxt: (fitId: number) => request<string>(`/api/fits/${fitId}/export-txt`),
  exportFitToGame: (fitId: number) =>
    request<EsiExportResult>("/api/esi/fittings/export", { method: "POST", body: JSON.stringify({ fitId }) }),

  portImport: (text: string, targetFitId: number | null = null) =>
    request<PortImportResult>("/api/port/import", { method: "POST", body: JSON.stringify({ text, targetFitId }) }),
  exportFit: (fitId: number, format: ExportFormat, options: Record<string, boolean> = {}) =>
    requestFile(`/api/fits/${fitId}/export`, { method: "POST", body: JSON.stringify({ format, options }) }),
  backupExport: () => requestFile("/api/backup/export", { method: "POST" }),
  backupImport: (text: string) =>
    request<BackupImportResult>("/api/backup/import", { method: "POST", body: JSON.stringify({ text }) }),
  mutantParse: (text: string) =>
    request<MutantParseResult>("/api/items/mutant/parse", { method: "POST", body: JSON.stringify({ text }) }),

  commands: () =>
    request<{
      commands: { name: string; summary: string; requires: string[]; args: Record<string, string> }[]
    }>("/api/commands"),
  runCommand: (fitId: number, command: string, args: Record<string, unknown>) =>
    request<Fit>(`/api/fits/${fitId}/commands`, { method: "POST", body: JSON.stringify({ command, args }) }),
  undo: (fitId: number) => request<Fit>(`/api/fits/${fitId}/undo`, { method: "POST" }),
  redo: (fitId: number) => request<Fit>(`/api/fits/${fitId}/redo`, { method: "POST" }),
  resetFit: (fitId: number) => request<void>(`/api/fits/${fitId}/reset`, { method: "POST" }),
  history: (fitId: number) => request<History>(`/api/fits/${fitId}/history`),
  chargeTargets: (fitId: number, chargeItemId: number) =>
    request<{ fitId: number; chargeItemId: number; targets: { position: number; itemId: number; name: string | null }[] }>(
      `/api/fits/${fitId}/charge-targets?chargeItemId=${chargeItemId}`,
    ),

  searchItems: (q: string, scope = "market", limit = 50, fitId?: number) =>
    request<{ query: string; scope: string; results: Item[] }>(
      `/api/items/search?q=${encodeURIComponent(q)}&scope=${encodeURIComponent(scope)}&limit=${limit}${
        fitId === undefined ? "" : `&fitId=${fitId}`
      }`,
    ),
  marketTree: () => request<{ groups: MarketGroup[] }>("/api/items/market-tree"),
  item: (itemId: number) => request<Item>(`/api/items/${itemId}`),
  attributes: (itemId: number, fitId?: number, position?: number, kind?: FittedKind) =>
    request<{ itemId: number; modified: boolean; rows: AttributeRow[] }>(
      `/api/items/${itemId}/attributes${fitQuery(fitId, position, kind)}`,
    ),
  charges: (itemId: number, fitId?: number, position?: number) =>
    request<{ charges: ChargeRow[] }>(`/api/items/${itemId}/charges${fitQuery(fitId, position, "module")}`),
  variations: (itemId: number, includeCharge = false) =>
    request<{ itemId: number; variations: Item[] }>(
      `/api/items/${itemId}/variations?includeCharge=${includeCharge ? "true" : "false"}`,
    ),
  requirements: (itemId: number) =>
    request<{ itemId: number; skills: RequirementRow[] }>(`/api/items/${itemId}/requirements`),
}



