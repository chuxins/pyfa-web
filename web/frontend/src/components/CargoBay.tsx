import React from "react"
import { useFittingStore } from "../store/fitting"
import { t } from "../i18n"

/** The cargo hold overlay: stacks with amounts, an icon, and a remove button.
 *  Entries are draggable so cargo can be moved back into slots. */
export const CargoBay = () => {
  const fit = useFittingStore((state) => state.fit)
  const removeCargo = useFittingStore((state) => state.removeCargo)
  const addItem = useFittingStore((state) => state.addItem)

  if (!fit) return <></>

  const entries = [...fit.cargo].sort((a, b) => (a.item?.name ?? "").localeCompare(b.item?.name ?? ""))

  const onDragStart = (e: React.DragEvent<HTMLDivElement>, itemId: number, itemKind: string) => {
    e.dataTransfer.setData("application/esf-type-id", itemId.toString())
    e.dataTransfer.setData("application/esf-kind", itemKind)
  }

  if (entries.length === 0) {
    return <div className="cargoBay">{t("Cargo is empty")}</div>
  }

  return (
    <div className="cargoBay">
      {entries.map((cargo) => (
        <div
          key={cargo.itemId}
          className="cargoBayEntry"
          draggable
          onDragStart={(e) => onDragStart(e, cargo.itemId, cargo.item?.itemKind ?? "item")}
          title={t("Drag to the ship to fit")}
        >
          <div className="cargoBayAmount">{cargo.amount} x</div>
          <div>
            <img src={`https://images.evetech.net/types/${cargo.itemId}/icon?size=32`} alt="" />
          </div>
          <div className="cargoBayMiddle">
            <div className="cargoBayName">{cargo.item?.name ?? ""}</div>
          </div>
          <div className="cargoBayClose" onClick={() => void removeCargo(cargo.itemId)}>
            X
          </div>
        </div>
      ))}
      <div className="dim" style={{ marginTop: 4 }}>
        {t("Tip: drag cargo items onto the ship to fit them")}
      </div>
    </div>
  )
}
