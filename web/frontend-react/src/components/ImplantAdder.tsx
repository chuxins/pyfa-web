import React from "react"
import { api, type Item } from "../api"
import { TypeIcon } from "../images"
import { t } from "../i18n"

/**
 * The add-implant box inside the implant simulator: type to search the implant
 * catalogue (debounced), click a result to add it to the selected character.
 * Items already on the character are excluded server-side so a row is never
 * offered twice.
 */
export const ImplantAdder = ({
  excludeIds,
  onPick,
}: {
  excludeIds: number[]
  onPick: (item: Item) => void
}) => {
  const [query, setQuery] = React.useState("")
  const [results, setResults] = React.useState<Item[]>([])
  const [loading, setLoading] = React.useState(false)
  const [pickedId, setPickedId] = React.useState<number | null>(null)

  React.useEffect(() => {
    const text = query.trim()
    if (text.length === 0) {
      setResults([])
      return
    }
    let cancelled = false
    setLoading(true)
    const handle = window.setTimeout(() => {
      api
        .searchImplants(text, excludeIds)
        .then((payload) => {
          if (!cancelled) setResults(payload.results)
        })
        .catch(() => {
          if (!cancelled) setResults([])
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 200)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  function pick(item: Item) {
    setPickedId(item.id)
    onPick(item)
    setQuery("")
    setResults([])
    window.setTimeout(() => setPickedId(null), 400)
  }

  return (
    <div className="implantAdder">
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("Search implants to add…")}
        spellCheck={false}
      />
      <div className="scroll implantPickerList">
        {loading && <div className="dim">{t("working…")}</div>}
        {!loading &&
          query.trim() !== "" &&
          results.length === 0 && <div className="dim">{t("No matching implants")}</div>}
        {!loading &&
          results.map((item) => (
            <button
              key={item.id}
              type="button"
              className={"pickerrow" + (pickedId === item.id ? " picked" : "")}
              onClick={() => pick(item)}
            >
              <TypeIcon typeId={item.id} size={26} />
              <span className="itemrowname">{item.name}</span>
            </button>
          ))}
      </div>
    </div>
  )
}
