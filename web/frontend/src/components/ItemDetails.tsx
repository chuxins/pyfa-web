import React from "react"
import { useBrowserStore } from "../store/browser"
import { useFittingStore } from "../store/fitting"
import { TypeIcon } from "../images"
import type { Item } from "../api"
import { formatAmount } from "../format"
import { t } from "../i18n"

/**
 * The details pane for the selected item: its values, its charges, its variants
 * and the skills it needs. When the click came from a fitted module the attribute
 * list shows the values the fit gives that item instead of the type's own.
 */
export const ItemDetails = () => {
  const item = useBrowserStore((state) => state.selectedItem)
  const tab = useBrowserStore((state) => state.selectedTab)
  const attributes = useBrowserStore((state) => state.selectedAttributes)
  const attributesModified = useBrowserStore((state) => state.selectedAttributesModified)
  const charges = useBrowserStore((state) => state.selectedCharges)
  const variations = useBrowserStore((state) => state.selectedVariations)
  const requirements = useBrowserStore((state) => state.selectedRequirements)
  const detailLoading = useBrowserStore((state) => state.detailLoading)
  const clearItem = useBrowserStore((state) => state.clearItem)
  const loadCharge = useFittingStore((state) => state.loadCharge)
  const send = useFittingStore((state) => state.send)
  const fit = useFittingStore((state) => state.fit)
  const selectedModule = useFittingStore((state) => state.selectedModule)
  const addItem = useFittingStore((state) => state.addItem)

  const setActiveTab = (name: "attributes" | "charges" | "variations" | "skills") => {
    useBrowserStore.setState({ selectedTab: name })
  }

  if (!item) return null

  async function onVariation(variant: Item) {
    // Replace the fitted module the click came from, or fit the variant as new
    if (fit && selectedModule !== null) {
      await send("changeLocalModuleMetas", { positions: [selectedModule], newItemId: variant.id })
    } else {
      await addItem(variant)
    }
  }

  return (
    <div className="itemdetails">
      <div className="detailsHead">
        <TypeIcon typeId={item.id} size={32} />
        <div className="detailsTitle">
          <span className="itemname">{item.name}</span>
          <span className="dim">{item.metaGroup ? `${item.metaGroup} · ${item.group}` : item.group}</span>
        </div>
        <button className="modal-close" onClick={clearItem} title="Close">
          &times;
        </button>
      </div>

      <div className="tabs">
        {(["attributes", "charges", "variations", "skills"] as const).map((key) => (
          <button key={key} className={tab === key ? "active" : ""} onClick={() => setActiveTab(key)}>
            {t(key === "attributes" ? "Attributes" : key === "charges" ? "Charges" : key === "variations" ? "Variations" : "Skills required")}
          </button>
        ))}
      </div>

      <div className="detailsBody">
        {detailLoading && <div className="dim">{t("working…")}</div>}

        {!detailLoading && tab === "attributes" && (
          <table className="attrtable">
            <tbody>
              {attributes.map((row) => (
                <tr key={row.id}>
                  <td className="attrname">{row.displayName || row.name}</td>
                  <td className="attrvalue mono">
                    {formatAmount(row.value, { prec: 3, lowest: -3, highest: 9 })} {row.unit ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {!detailLoading && tab === "charges" && (
          <div className="itemlist">
            {charges.length === 0 && <div className="dim">{t("Charges")}: —</div>}
            {charges.map((charge) => (
              <div key={charge.id} className="itemrow">
                <TypeIcon typeId={charge.id} size={26} />
                <span className="itemrowname">{charge.name}</span>
                <button className="load" onClick={() => void loadCharge(charge.id)}>
                  {t("Load into selected module")}
                </button>
              </div>
            ))}
          </div>
        )}

        {!detailLoading && tab === "variations" && (
          <div className="itemlist">
            {variations.map((variant) => (
              <div
                key={variant.id}
                className={"itemrow" + (variant.id === item.id ? " selected" : "")}
                onClick={() => void onVariation(variant)}
              >
                <TypeIcon typeId={variant.id} size={26} />
                <span className="itemrowname">{variant.name}</span>
                {variant.metaGroup && <span className="tag">{variant.metaGroup}</span>}
              </div>
            ))}
          </div>
        )}

        {!detailLoading && tab === "skills" && (
          <div className="itemlist">
            {requirements.map((row) => (
              <div key={row.skillId} className="itemrow">
                <span className="itemrowname">{row.name}</span>
                <span className="tag">Level {row.level}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
