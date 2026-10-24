import React from "react"
import { api, imageUrl, type FitSkillRow } from "../api"
import { useFittingStore } from "../store/fitting"
import { t } from "../i18n"

const OPEN_KEY = "pyfa.skillsSidebar.open"
const SHOW_MET_KEY = "pyfa.skillsSidebar.showMet"

function rememberedOpen(): boolean {
  try {
    return window.localStorage.getItem(OPEN_KEY) !== "0"
  } catch {
    return true
  }
}

const ROMAN = ["0", "I", "II", "III", "IV", "V"]

/**
 * A collapsible right-hand drawer listing every skill that affects the open
 * fit: the skills its fitted items require (prerequisites included), the level
 * the fit needs, the fit character's current level and the items that demand
 * each skill. The list is fetched per fit from /api/fits/{id}/skills and
 * refetched whenever a command changes the fit.
 */
export const SkillsSidebar = () => {
  const fit = useFittingStore((state) => state.fit)
  const [open, setOpen] = React.useState(rememberedOpen)
  const [showMet, setShowMet] = React.useState(() => {
    try {
      return window.localStorage.getItem(SHOW_MET_KEY) !== "0"
    } catch {
      return true
    }
  })
  const [rows, setRows] = React.useState<FitSkillRow[]>([])
  const [missing, setMissing] = React.useState(0)
  const [total, setTotal] = React.useState(0)
  const [loading, setLoading] = React.useState(false)
  const [failed, setFailed] = React.useState(false)

  const fitId = fit?.id ?? null

  React.useEffect(() => {
    if (fitId === null) {
      setRows([])
      setMissing(0)
      setTotal(0)
      setFailed(false)
      return
    }
    let cancelled = false
    setLoading(true)
    api
      .fitSkills(fitId)
      .then((payload) => {
        if (cancelled) return
        setRows(payload.skills)
        setMissing(payload.missing)
        setTotal(payload.total)
        setFailed(false)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [fitId, fit?.modified])

  const toggleOpen = () => {
    setOpen((was) => {
      const next = !was
      try {
        window.localStorage.setItem(OPEN_KEY, next ? "1" : "0")
      } catch {
        // storage unavailable: choice lasts for this page view
      }
      return next
    })
  }

  const toggleShowMet = () => {
    setShowMet((was) => {
      const next = !was
      try {
        window.localStorage.setItem(SHOW_MET_KEY, next ? "1" : "0")
      } catch {
        // ignore
      }
      return next
    })
  }

  const visibleRows = showMet ? rows : rows.filter((row) => !row.met)

  return (
    <>
      <div
        className={"skillsTab" + (open ? " open" : "")}
        onClick={toggleOpen}
        title={open ? t("Collapse skills") : t("Expand skills")}
      >
        <span className="skillsTabText">
          {t("Skills")}
          {missing > 0 && <span className="skillsTabBadge">{missing}</span>}
        </span>
      </div>
      <aside className={"skillsPanel" + (open ? " open" : "")} aria-hidden={!open}>
        <div className="skillsHeader">
          <div className="skillsTitle">
            {t("Skills")}
            <span className="skillsCount">
              {missing > 0 ? t("{missing}/{total} missing", { missing, total }) : total}
            </span>
          </div>
          <button
            className="skillsHideMet"
            onClick={toggleShowMet}
            title={showMet ? t("Hide trained skills") : t("Show trained skills")}
          >
            {showMet ? t("Hide trained") : t("Show trained")}
          </button>
          <button className="skillsClose" onClick={toggleOpen} title={t("Collapse skills")}>
            &rsaquo;
          </button>
        </div>
        <div className="skillsBody">
          {fitId === null && <div className="skillsHint">{t("Open a fit to see its skills")}</div>}
          {fitId !== null && loading && rows.length === 0 && (
            <div className="skillsHint">{t("Loading…")}</div>
          )}
          {fitId !== null && failed && <div className="skillsHint">{t("Failed to load skills")}</div>}
          {fitId !== null && !loading && !failed && visibleRows.length === 0 && (
            <div className="skillsHint">
              {missing === 0 && rows.length > 0 && !showMet
                ? t("All skills trained")
                : t("This fit needs no skills")}
            </div>
          )}
          {visibleRows.map((row) => {
            const icon = imageUrl(row.image, 1)
            return (
              <div key={row.id} className={"skillRow" + (row.met ? "" : " unmet")}>
                {icon ? <img className="skillIcon" src={icon} alt="" width={24} height={24} /> : <div className="skillIcon placeholder" />}
                <div className="skillInfo">
                  <div className="skillName" title={row.sources.join("、")}>
                    {row.name}
                    {row.prerequisiteOnly && <span className="skillPreTag">{t("Prerequisite")}</span>}
                  </div>
                  {row.sources.length > 0 && <div className="skillSources">{row.sources.join("、")}</div>}
                </div>
                <div className="skillLevels" title={t("Required / current level")}>
                  <span className="skillRequired">{ROMAN[row.requiredLevel] ?? row.requiredLevel}</span>
                  <span className="skillSep">/</span>
                  <span className="skillCurrent">{ROMAN[row.currentLevel] ?? row.currentLevel}</span>
                </div>
              </div>
            )
          })}
        </div>
      </aside>
    </>
  )
}
