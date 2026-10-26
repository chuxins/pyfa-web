import React from "react"
import { api } from "../api"
import { useUiStore } from "../store/ui"
import { useFittingStore } from "../store/fitting"
import { TypeIcon } from "../images"
import { rackLabel } from "../labels"
import { t } from "../i18n"
import { ModalDialog } from "./ModalDialog"

const SLOT_SCOPES = ["high", "med", "low", "rig", "subsystem", "service"]

/**
 * The item picker for one rack slot (eveship.fit / pyfa-web mobile slot picker).
 * It browses or searches the modules of that slot's scope, filtered by the open
 * fit's ship, and fits the picked module into the slot that was tapped.
 */
export const SlotPicker = () => {
  const picker = useUiStore((state) => state.slotPicker)
  const close = useUiStore((state) => state.closeSlotPicker)
  const fit = useFittingStore((state) => state.fit)
  const addModuleToSlot = useFittingStore((state) => state.addModuleToSlot)
  const send = useFittingStore((state) => state.send)

  const [query, setQuery] = React.useState("")
  const [results, setResults] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    if (!picker) return
    setQuery("")
    void browse("")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picker])

  async function browse(text: string) {
    if (!picker || !fit) return
    setLoading(true)
    try {
      const { results } = await api.searchItems(text, picker.slot as any, 500, fit.id)
      setResults(results)
    } catch {
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  if (!picker || !fit) return null

  async function pick(itemId: number) {
    if (!picker) return
    // A real slot (>= 0) gets the module swapped into place; a synthetic empty row
    // of the mobile rack list (-1) just lets the server take the first free slot.
    if (picker.position >= 0) await addModuleToSlot(itemId, picker.position, picker.slot)
    else await send("addLocalModule", { itemId })
    close()
  }

  return (
    <ModalDialog
      title={picker.position >= 0 ? `${rackLabel(picker.slot)} · ${picker.position}` : rackLabel(picker.slot)}
      onClose={close}
      width={520}
    >
      <div className="search">
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            void browse(event.target.value)
          }}
          placeholder={t("Search items…")}
          spellCheck={false}
          autoFocus
        />
      </div>
      <div className="scroll pickerList">
        {loading && <div className="dim">{t("working…")}</div>}
        {!loading &&
          results.map((item) => (
            <button key={item.id} className="pickerrow" onClick={() => void pick(item.id)}>
              <TypeIcon typeId={item.id} size={26} />
              <span className="itemrowname">{item.name}</span>
              {item.size != null && <span className="tag">T{item.size}</span>}
            </button>
          ))}
      </div>
    </ModalDialog>
  )
}

// Keep SLOT_SCOPES referenced so the mapping is explicit and greppable.
void SLOT_SCOPES
