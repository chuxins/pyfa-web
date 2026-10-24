import React from "react"
import { TopBar } from "./TopBar"
import { HullListing } from "./HullListing"
import { HardwareListing } from "./HardwareListing"
import { FitButtonBar } from "./FitButtonBar"
import { ShipFitExtended } from "./ShipFitExtended"
import { ShipStatistics } from "./ShipStatistics"
import { CharacterSelection } from "./CharacterSelection"
import { SkillsSidebar } from "./SkillsSidebar"
import { ModalDialogAnchor } from "./ModalDialog"
import { ImportExportDialog } from "./ImportExportDialog"
import { t } from "../i18n"

/**
 * The eveship.fit page: the top bar above one rounded container holding the
 * left selection panel (Hull & Fits / Hardware tabs plus the fit button bar),
 * the radial fit in the middle, and the character + statistics on the right.
 */
export const PageMain = () => {
  const [selection, setSelection] = React.useState<"hulls" | "hardware">("hulls")

  return (
    <>
      <TopBar />
      <div className="content">
        <ModalDialogAnchor />
        <div className="selection">
          <div className="selectionHeader">
            <div
              onClick={() => setSelection("hulls")}
              className={selection === "hulls" ? "selected" : ""}
            >
              {t("Hull & Fits")}
            </div>
            <div
              onClick={() => setSelection("hardware")}
              className={selection === "hardware" ? "selected" : ""}
            >
              {t("Hardware")}
            </div>
          </div>
          <div className={"selectionContent" + (selection !== "hulls" ? " collapsed" : "")}>
            <HullListing />
          </div>
          <div className={"selectionContent" + (selection !== "hardware" ? " collapsed" : "")}>
            <HardwareListing />
          </div>
          <FitButtonBar />
        </div>
        <div className="fit">
          <div className="fitRing">
            <ShipFitExtended />
          </div>
        </div>
        <div className="statistics">
          <CharacterSelection />
          <ShipStatistics />
        </div>
        <SkillsSidebar />
      </div>
      <div className="footer">
        © 2014 CCP hf. 保留所有权利。 &quot;EVE&quot;、&quot;EVE Online&quot;、&quot;CCP&quot; 及相关标识为 CCP hf 的商标或注册商标。
        <br />
        {t("Kindly hosted by")}{" "}
        <a href="https://cloudflare.com">Cloudflare</a>.
      </div>

      <ImportExportDialog />
    </>
  )
}

