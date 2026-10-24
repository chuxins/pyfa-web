import React from "react"
import { Icon } from "./Icon"
import { useFittingStore } from "../store/fitting"
import { t } from "../i18n"

const HISTORY_SIZE = 25

/** The simulation history strip: each stripe is one undoable state; clicking one
 *  jumps the fit there (server undo/redo walk), the arrows step one at a time. */
export const FitHistory = () => {
  const fit = useFittingStore((state) => state.fit)
  const undo = useFittingStore((state) => state.undo)
  const redo = useFittingStore((state) => state.redo)

  const history = fit?.history
  if (!history) return <></>

  const depth = history.depth ?? 0
  const active = Math.min(depth, HISTORY_SIZE - 1)

  const onClick = (i: number) => {
    if (i === active) return
    if (i < active) {
      for (let n = 0; n < active - i; n++) void undo()
    } else {
      for (let n = 0; n < i - active; n++) void redo()
    }
  }

  return (
    <div className="fitHistory" style={{ width: HISTORY_SIZE * 12 + 3 + 16 + 16 }}>
      <div className="fitHistoryTitle">{t("Simulation History")}</div>
      <div className="fitHistoryStrip">
        <Icon
          name="arrow-left"
          size={16}
          className={!history.canUndo ? "fitHistoryInactive" : ""}
          onClick={() => {
            if (history.canUndo) void undo()
          }}
        />
        <div className="fitHistoryHolder">
          {Array.from({ length: HISTORY_SIZE }, (_, i) => (
            <div
              key={i}
              className={
                "fitHistoryEntry" +
                (i % 2 === 1 ? " fitHistoryOdd" : "") +
                (i === active ? " fitHistoryActive" : "")
              }
              onClick={() => onClick(i)}
            >
              &nbsp;
            </div>
          ))}
        </div>
        <Icon
          name="arrow-right"
          size={16}
          className={!history.canRedo ? "fitHistoryInactive" : ""}
          onClick={() => {
            if (history.canRedo) void redo()
          }}
        />
      </div>
    </div>
  )
}
