import React from "react"
import { HullListing } from "./HullListing"
import { HardwareListing } from "./HardwareListing"
import { t } from "../i18n"

/**
 * 左栏内容：「舰船与装配」和「硬件」两个标签页，标签下面各自是一个浏览器。
 *
 * 桌面三栏、手机横屏和竖屏的第一个标签用的都是这一块，所以它单独拿出来，
 * 由外层的 `.selection`（桌面）或 `.pPane`（竖屏）决定宽度。
 */
export const SelectionPanel = () => {
  const [selection, setSelection] = React.useState<"hulls" | "hardware">("hulls")

  return (
    <>
      <div className="selectionHeader">
        <div onClick={() => setSelection("hulls")} className={selection === "hulls" ? "selected" : ""}>
          {t("Hull & Fits")}
        </div>
        <div onClick={() => setSelection("hardware")} className={selection === "hardware" ? "selected" : ""}>
          {t("Hardware")}
        </div>
      </div>
      <div className={"selectionContent" + (selection !== "hulls" ? " collapsed" : "")}>
        <HullListing />
      </div>
      <div className={"selectionContent" + (selection !== "hardware" ? " collapsed" : "")}>
        <HardwareListing />
      </div>
    </>
  )
}
