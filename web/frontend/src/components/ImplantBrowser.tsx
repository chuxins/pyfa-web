import React from "react"
import { api, type Item } from "../api"
import { TypeIcon } from "../images"
import { t } from "../i18n"

/**
 * The left-hand "available implants" list of the implant simulator.
 *
 * It mirrors the desktop implant editor: the full catalogue is shown before
 * anything is typed, with a search box and a slot filter above it. Browsing is
 * grouped into collapsible set cards -- the high/mid/low-grade sets, the
 * attribute implant tiers and the branded hardwiring lines -- and every card
 * starts collapsed. Search results and slot-filtered rows stay a flat list so
 * a typed query shows its matches immediately. Clicking a row plugs that
 * implant into the selected character (the server's ``makeRoom`` replaces
 * whatever shares the slot), and rows already on the character are marked and
 * left disabled.
 *
 * The catalogue is static game data, so it is fetched once and kept at module
 * level; reopening the dialog does not query the server again.
 */
let catalogueCache: Item[] | null = null

type ImplantSetKind = "grade" | "attribute" | "special" | "brand" | "other"

interface ImplantSet {
  id: string
  kind: ImplantSetKind
  key: string
  label: string
  items: Item[]
}

const ATTRIBUTE_BASES = [
  "Ocular Filter",
  "Memory Augmentation",
  "Neural Boost",
  "Cybernetic Subprocessor",
  "Social Adaptation Chip",
]

const SET_KIND_ORDER: Record<ImplantSetKind, number> = {
  grade: 0,
  attribute: 1,
  special: 2,
  brand: 3,
  other: 4,
}

const GRADE_ORDER: Record<string, number> = { High: 0, Mid: 1, Low: 2 }

const GRADE_SET = /^(High|Mid|Low)-grade\s+(\S+)\s+(?:Alpha|Beta|Gamma|Delta|Epsilon|Omega)$/
const BRAND_SET = /^(.*?)\s+'([^']+)'/

interface ClassifiedImplant {
  kind: ImplantSetKind
  key: string
}

/**
 * The set a catalogue row belongs to, from its stable English name.
 *
 * Grade sets (``High-grade Snake Alpha``) are the sets players mean by
 * "implant set"; branded lines (``Zainou 'Deadeye' ...``) are grouped by their
 * maker and quoted line; the five attribute implants group their Standard /
 * Improved / Limited tiers together. Everything else shares one "other" card.
 */
function classifyImplant(item: Item): ClassifiedImplant {
  const name = item.nameEn || item.name

  const grade = GRADE_SET.exec(name)
  if (grade) {
    return { kind: "grade", key: `${grade[1]}-grade ${grade[2]}` }
  }

  if (name.startsWith("Genolution Core Augmentation CA-")) {
    return { kind: "special", key: "Genolution Core Augmentation" }
  }

  const stripped = name.startsWith("Limited ") ? name.slice("Limited ".length) : name
  const base = stripped.replace(/\s+-\s+(?:Basic|Standard|Improved|Beta)$/, "")
  if (ATTRIBUTE_BASES.includes(base)) {
    return { kind: "attribute", key: base }
  }

  const brand = BRAND_SET.exec(name)
  if (brand) {
    const prefix = brand[1].trim()
    const quoted = brand[2].trim()
    // The two Source implants have different first words but are one line.
    if (quoted === "Source") return { kind: "brand", key: "'Source'" }
    return { kind: "brand", key: `${prefix} '${quoted}'` }
  }

  return { kind: "other", key: "Other implants" }
}

/** Longest prefix every displayed name shares, used to label a localized set. */
function sharedPrefix(values: string[]) {
  if (values.length === 0) return ""
  let prefix = values[0]
  for (const value of values.slice(1)) {
    while (prefix !== "" && !value.startsWith(prefix)) {
      prefix = prefix.slice(0, -1)
    }
  }
  return prefix
}

function setLabel(kind: ImplantSetKind, key: string, items: Item[]) {
  if (kind === "other") return t("Other implants")
  if (kind === "attribute") return t(key)
  // Branded line names are proper nouns and read best in English; grade sets
  // get their localized prefix ("高级蝰蛇") from the item names themselves.
  if (kind === "brand") return key

  let label = sharedPrefix(items.map((item) => item.name))
    .replace(/[\s\-–—]+$/, "")
    .trim()
  if (kind === "special") label = label.replace(/\s+CA$/i, "").trim()
  return label || key
}

function gradeParts(key: string) {
  const [grade, ...family] = key.split("-grade ")
  return { family: family.join("-grade "), grade: GRADE_ORDER[grade] ?? 9 }
}

function compareSets(a: ImplantSet, b: ImplantSet) {
  const kind = SET_KIND_ORDER[a.kind] - SET_KIND_ORDER[b.kind]
  if (kind !== 0) return kind

  if (a.kind === "grade" && b.kind === "grade") {
    const left = gradeParts(a.key)
    const right = gradeParts(b.key)
    return left.family.localeCompare(right.family) || left.grade - right.grade
  }
  if (a.kind === "attribute" && b.kind === "attribute") {
    return ATTRIBUTE_BASES.indexOf(a.key) - ATTRIBUTE_BASES.indexOf(b.key)
  }
  return a.label.localeCompare(b.label)
}

/** Group the browsable catalogue into set cards, ordered for scanning. */
function buildImplantSets(items: Item[]): ImplantSet[] {
  const groups = new Map<string, ImplantSet>()

  for (const item of items) {
    const { kind, key } = classifyImplant(item)
    const id = `${kind}:${key}`
    const existing = groups.get(id)
    if (existing) existing.items.push(item)
    else groups.set(id, { id, kind, key, label: key, items: [item] })
  }

  function moveToOther(moved: Item[]) {
    const id = "other:Other implants"
    const existing = groups.get(id)
    if (existing) existing.items.push(...moved)
    else groups.set(id, { id, kind: "other", key: "Other implants", label: "", items: [...moved] })
  }

  // A one-off branded implant is not a set of its own; it belongs in "other".
  for (const [id, group] of [...groups]) {
    if (group.kind === "brand" && group.items.length === 1) {
      groups.delete(id)
      moveToOther(group.items)
    }
  }

  const sets = [...groups.values()]
  for (const set of sets) {
    set.items.sort(
      (a, b) => (a.slot ?? 0) - (b.slot ?? 0) || a.name.localeCompare(b.name),
    )
    set.label = setLabel(set.kind, set.key, set.items)
  }
  sets.sort(compareSets)
  return sets
}

export const ImplantBrowser = ({
  implantedIds,
  onPick,
}: {
  implantedIds: number[]
  onPick: (item: Item) => void
}) => {
  const [query, setQuery] = React.useState("")
  const [slot, setSlot] = React.useState<number | null>(null)
  const [catalogue, setCatalogue] = React.useState<Item[] | null>(catalogueCache)
  const [results, setResults] = React.useState<Item[] | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [searching, setSearching] = React.useState(false)
  // Every set starts folded; the discovery path is search or opening a card.
  const [openSets, setOpenSets] = React.useState<Set<string>>(() => new Set())

  React.useEffect(() => {
    if (catalogue !== null) return
    let cancelled = false
    setLoading(true)
    api
      .searchImplants("", [], 1000)
      .then((payload) => {
        if (cancelled) return
        catalogueCache = payload.results
        setCatalogue(payload.results)
      })
      .catch(() => {
        if (!cancelled) setCatalogue([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [catalogue])

  React.useEffect(() => {
    const text = query.trim()
    if (text === "") {
      setResults(null)
      setSearching(false)
      return
    }
    let cancelled = false
    setSearching(true)
    setResults(null)
    const handle = window.setTimeout(() => {
      api
        .searchImplants(text, [], 400)
        .then((payload) => {
          if (!cancelled) setResults(payload.results)
        })
        .catch(() => {
          if (!cancelled) setResults([])
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 200)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [query])

  const browsing = query.trim() === ""
  // 这一行会随 render 生成新数组，useMemo 的依赖因此每次都不一样；直接在 memo 里算，
  // 否则 memo 形同虚设（eslint 的 react-hooks 也是这么提示的）。
  const busy = browsing ? loading : searching
  const implanted = React.useMemo(() => new Set(implantedIds), [implantedIds])

  const slots = React.useMemo(() => {
    const values = new Set<number>()
    for (const item of catalogue ?? []) {
      if (typeof item.slot === "number") values.add(item.slot)
    }
    return [...values].sort((a, b) => a - b)
  }, [catalogue])

  const visible = React.useMemo(() => {
    const source = browsing ? catalogue ?? [] : results ?? []
    return slot === null ? source : source.filter((item) => item.slot === slot)
  }, [browsing, catalogue, results, slot])

  // Cards are for browsing the whole catalogue. A search is ordered by
  // relevance and a slot filter leaves one row per set, so both stay flat.
  const showSets = browsing && slot === null
  const sets = React.useMemo(
    () => (showSets ? buildImplantSets(visible) : []),
    [showSets, visible],
  )

  function toggleSet(id: string) {
    setOpenSets((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function slotText(value: number) {
    return value === 0 ? "00" : String(value)
  }

  function pickRow(item: Item) {
    const plugged = implanted.has(item.id)
    return (
      <button
        key={item.id}
        type="button"
        className={"implantPickRow" + (plugged ? " plugged" : "")}
        disabled={plugged}
        title={plugged ? t("Already implanted") : t("Add this implant")}
        onClick={() => onPick(item)}
      >
        <TypeIcon typeId={item.id} size={24} />
        <span className="implantPickName">{item.name}</span>
        <span className="implantSlot">{slotText(item.slot ?? 0)}</span>
      </button>
    )
  }

  return (
    <div className="implantBrowser">
      <input
        className="implantSearch"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("Search implants…")}
        spellCheck={false}
      />
      <div className="implantSlotFilter">
        <button
          type="button"
          className={"implantSlotChip" + (slot === null ? " selected" : "")}
          onClick={() => setSlot(null)}
        >
          {t("All slots")}
        </button>
        {slots.map((value) => (
          <button
            key={value}
            type="button"
            className={"implantSlotChip" + (slot === value ? " selected" : "")}
            onClick={() => setSlot(value)}
          >
            {slotText(value)}
          </button>
        ))}
      </div>
      <div className={"scroll implantBrowserList" + (showSets ? " implantSetGrid" : "")}>
        {busy && <div className="dim implantBrowserNote">{t("working…")}</div>}
        {!busy && visible.length === 0 && (
          <div className="dim implantBrowserNote">
            {browsing ? t("No implants available") : t("No matching implants")}
          </div>
        )}
        {!busy && showSets &&
          sets.map((set) => {
            const opened = openSets.has(set.id)
            return (
              <section key={set.id} className={"implantSetCard" + (opened ? " open" : "")}>
                <button
                  type="button"
                  className="implantSetHeader"
                  aria-expanded={opened}
                  title={`${set.label} · ${t("{count} implants", { count: set.items.length })}`}
                  onClick={() => toggleSet(set.id)}
                >
                  <span className="implantSetChevron" aria-hidden="true">
                    ▶
                  </span>
                  <span className="implantSetName">{set.label}</span>
                  <span className="implantSetCount">{set.items.length}</span>
                </button>
                {opened && <div className="implantSetItems">{set.items.map(pickRow)}</div>}
              </section>
            )
          })}
        {!busy && !showSets && visible.map(pickRow)}
      </div>
    </div>
  )
}
