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
 * pyfa-style skill rank: five boxes, one per level I-V. Boxes at or below the
 * rank are solid white, the rest hollow.
 */
const LevelPips = ({ level, kind, label }: { level: number; kind: "required" | "current"; label: string }) => (
  <span
    className={"skillPips " + kind}
    role="img"
    aria-label={t("{label}: level {level}", { label, level: ROMAN[level] ?? level })}
    title={label + " " + (ROMAN[level] ?? level)}
  >
    {[1, 2, 3, 4, 5].map((n) => (
      <span key={n} className={"skillPip" + (n <= level ? " learned" : "")} />
    ))}
  </span>
)

/**
 * One sidebar row: icon, name, source items and the level pips. Auxiliary
 * (bonus-only) skills have no required level, so their upper pip row is empty
 * and the "prerequisite" tag is replaced by an "affects" hint.
 */
const SkillRowItem = ({ row, auxiliary = false }: { row: FitSkillRow; auxiliary?: boolean }) => {
  const icon = imageUrl(row.image, 1)
  const sourcesTitle = row.sources.join("、")
  return (
    <div className={"skillRow" + (auxiliary ? " auxiliary" : row.met ? "" : " unmet")}>
      {icon ? (
        <img className="skillIcon" src={icon} alt="" width={24} height={24} />
      ) : (
        <div className="skillIcon placeholder" />
      )}
      <div className="skillInfo">
        <div className="skillName" title={sourcesTitle}>
          {row.name}
          {!auxiliary && row.prerequisiteOnly && <span className="skillPreTag">{t("Prerequisite")}</span>}
        </div>
        {row.sources.length > 0 && (
          <div className="skillSources">
            <span className="skillSourcesLabel">{auxiliary ? t("Affects") + " " : ""}</span>
            {sourcesTitle}
          </div>
        )}
      </div>
      <div
        className="skillLevels"
        title={auxiliary ? t("Current level") : t("Required / current level")}
      >
        {!auxiliary && (
          <LevelPips kind="required" level={row.requiredLevel} label={t("Required level")} />
        )}
        {auxiliary && <span className="skillPips required placeholder" />}
        <LevelPips kind="current" level={row.currentLevel} label={t("Current level")} />
      </div>
    </div>
  )
}

/**
 * A collapsible right-hand drawer listing every skill that affects the open
 * fit: the skills its fitted items require (prerequisites included), the level
 * the fit needs, the fit character's current level and the items that demand
 * each skill, plus an auxiliary section of bonus skills the fit does not
 * require but which still change its numbers. The list is fetched per fit from
 * /api/fits/{id}/skills and refetched whenever a command changes the fit.
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
  const [auxRows, setAuxRows] = React.useState<FitSkillRow[]>([])
  const [missing, setMissing] = React.useState(0)
  const [total, setTotal] = React.useState(0)
  const [auxTotal, setAuxTotal] = React.useState(0)
  const [loading, setLoading] = React.useState(false)
  const [failed, setFailed] = React.useState(false)

  const fitId = fit?.id ?? null

  React.useEffect(() => {
    if (fitId === null) {
      setRows([])
      setAuxRows([])
      setMissing(0)
      setTotal(0)
      setAuxTotal(0)
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
        setAuxRows(payload.auxiliary ?? [])
        setMissing(payload.missing)
        setTotal(payload.total)
        setAuxTotal(payload.auxiliaryTotal ?? 0)
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

  // While the panel is open, reserve space on the parent .content so the fit
  // ring scales down (it is sized by container queries) instead of being
  // covered by the absolutely-positioned drawer.
  React.useEffect(() => {
    const host = document.querySelector<HTMLElement>(".content")
    if (host) host.classList.toggle("skillsOpen", open)
    return () => {
      if (host) host.classList.remove("skillsOpen")
    }
  }, [open])

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
  const visibleAux = showMet ? auxRows : auxRows.filter((row) => row.currentLevel > 0)

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
        <div className="skillsLegend">
          <span className="legendItem">
            <span className="legendSwatch required" />
            {t("Required level")}
          </span>
          <span className="legendItem">
            <span className="legendSwatch current" />
            {t("Current level")}
          </span>
        </div>
        <div className="skillsBody">
          {fitId === null && <div className="skillsHint">{t("Open a fit to see its skills")}</div>}
          {fitId !== null && loading && rows.length === 0 && (
            <div className="skillsHint">{t("Loading…")}</div>
          )}
          {fitId !== null && failed && <div className="skillsHint">{t("Failed to load skills")}</div>}
          {fitId !== null && !loading && !failed && visibleRows.length === 0 && visibleAux.length === 0 && (
            <div className="skillsHint">
              {missing === 0 && rows.length > 0 && !showMet
                ? t("All skills trained")
                : t("This fit needs no skills")}
            </div>
          )}
          {visibleRows.length > 0 && (
            <div className="skillsSection">
              <div className="skillsSectionTitle">
                {t("Required skills")}
                <span className="skillsSectionCount">{total}</span>
              </div>
              {visibleRows.map((row) => (
                <SkillRowItem key={"req-" + row.id} row={row} />
              ))}
            </div>
          )}
          {visibleAux.length > 0 && (
            <div className="skillsSection">
              <div
                className="skillsSectionTitle"
                title={t("Bonus skills the fit does not require, but which change its numbers")}
              >
                {t("Auxiliary skills")}
                <span className="skillsSectionCount">{auxTotal}</span>
              </div>
              {visibleAux.map((row) => (
                <SkillRowItem key={"aux-" + row.id} row={row} auxiliary />
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
