import React from "react"
import { useFittingStore } from "../store/fitting"
import { t } from "../i18n"

/**
 * The hull's own bonuses: the block the desktop's ship info window prints.
 *
 * ``_traits_html`` in ``web/services/serialize.py`` renders each ship's
 * ``invtraits`` row into one HTML string per language (bold section headers,
 * ``<br />`` between the lines), which is why it is printed as-is instead of being
 * parsed here. The text is game data read from ``eve.db`` -- nothing in it comes
 * from a request or another user -- so inserting it cannot run anyone else's markup.
 */
export const ShipBonusesPanel = () => {
  const fit = useFittingStore((state) => state.fit)
  const [expanded, setExpanded] = React.useState(true)

  const traits = fit?.ship?.traits ?? null
  if (!traits) return null

  return (
    <div className="statPanel statBonuses">
      <div className="statHeader" onClick={() => setExpanded((current) => !current)}>
        <div>{t("Ship bonuses")}</div>
        <div className="statBonusesHull" style={{ textAlign: "right" }}>
          {fit?.ship?.item?.name ?? ""}
        </div>
      </div>
      <div className={expanded ? "statBonusesExpanded" : "statCollapsed"}>
        <div className="statBonusesBody" dangerouslySetInnerHTML={{ __html: traits }} />
      </div>
    </div>
  )
}
