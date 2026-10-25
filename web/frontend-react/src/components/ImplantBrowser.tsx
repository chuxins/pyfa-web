import React from "react"
import { api, type Item } from "../api"
import { TypeIcon } from "../images"
import { t } from "../i18n"

/**
 * The left-hand "available implants" list of the implant simulator.
 *
 * It mirrors the desktop implant editor: the full catalogue is shown before
 * anything is typed, grouped by implantness slot, with a search box and a slot
 * filter above it. Clicking a row plugs that implant into the selected
 * character (the server's ``makeRoom`` replaces whatever shares the slot), and
 * rows already on the character are marked and left disabled.
 *
 * The catalogue is static game data, so it is fetched once and kept at module
 * level; reopening the dialog does not query the server again.
 */
let catalogueCache: Item[] | null = null

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
  const source = browsing ? catalogue ?? [] : results ?? []
  const busy = browsing ? loading : searching
  const implanted = React.useMemo(() => new Set(implantedIds), [implantedIds])

  const slots = React.useMemo(() => {
    const values = new Set<number>()
    for (const item of catalogue ?? []) {
      if (typeof item.slot === "number") values.add(item.slot)
    }
    return [...values].sort((a, b) => a - b)
  }, [catalogue])

  const visible = React.useMemo(
    () => (slot === null ? source : source.filter((item) => item.slot === slot)),
    [source, slot],
  )

  // Browsing in slot order makes quiet group headers useful; search results are
  // ordered by relevance instead, so they stay a flat list.
  const grouped = React.useMemo(() => {
    const groups: { slot: number; items: Item[] }[] = []
    if (!browsing || slot !== null) return groups
    for (const item of visible) {
      const itemSlot = item.slot ?? 0
      const last = groups[groups.length - 1]
      if (last !== undefined && last.slot === itemSlot) last.items.push(item)
      else groups.push({ slot: itemSlot, items: [item] })
    }
    return groups
  }, [browsing, slot, visible])

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
      <div className="scroll implantBrowserList">
        {busy && <div className="dim implantBrowserNote">{t("working…")}</div>}
        {!busy && visible.length === 0 && (
          <div className="dim implantBrowserNote">
            {browsing ? t("No implants available") : t("No matching implants")}
          </div>
        )}
        {!busy &&
          (grouped.length > 0
            ? grouped.map((group) => (
                <React.Fragment key={group.slot}>
                  <div className="implantGroupHeader">
                    {t("Slot {slot}", { slot: slotText(group.slot) })}
                  </div>
                  {group.items.map(pickRow)}
                </React.Fragment>
              ))
            : visible.map(pickRow))}
      </div>
    </div>
  )
}
