import React from "react"
import { api, imageUrl, type FitSkillRow, type FitSkills } from "../api"
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
 * One sidebar row: icon, name, source items and the level pips. Custom
 * (manually pinned) skills have no required level, so their upper pip row is
 * empty and the row carries a remove button instead of sources/tags.
 */
const SkillRowItem = ({
  row,
  custom = false,
  onRemove,
}: {
  row: FitSkillRow
  custom?: boolean
  onRemove?: (skillId: number) => void
}) => {
  const icon = imageUrl(row.image, 1)
  const sourcesTitle = row.sources.join("、")
  return (
    <div className={"skillRow" + (custom ? " custom" : row.met ? "" : " unmet")}>
      {icon ? (
        <img className="skillIcon" src={icon} alt="" width={24} height={24} />
      ) : (
        <div className="skillIcon placeholder" />
      )}
      <div className="skillInfo">
        <div className="skillName" title={custom ? row.name : sourcesTitle}>
          {row.name}
          {!custom && row.prerequisiteOnly && <span className="skillPreTag">{t("Prerequisite")}</span>}
        </div>
        {!custom && row.sources.length > 0 && <div className="skillSources">{sourcesTitle}</div>}
      </div>
      <div
        className="skillLevels"
        title={custom ? t("Current level") : t("Required / current level")}
      >
        {!custom && <LevelPips kind="required" level={row.requiredLevel} label={t("Required level")} />}
        {custom && <span className="skillPips required placeholder" />}
        <LevelPips kind="current" level={row.currentLevel} label={t("Current level")} />
      </div>
      {custom && (
        <button
          type="button"
          className="skillRemove"
          title={t("Remove custom skill")}
          onClick={() => onRemove?.(row.id)}
        >
          ×
        </button>
      )}
    </div>
  )
}

type SkillOption = {
  id: number
  name: string
  image: { kind: "icons" | "renders" | "gui"; id: number } | null
}

/**
 * The add-skill control for the custom section: a small "+" button turns into
 * a search box whose debounced queries hit /api/fits/skills/search; picking a
 * result pins it to the fit. Skills already shown (pinned, or required by the
 * fit) are filtered out of the suggestions.
 */
const CustomSkillPicker = ({
  fitId,
  excludeIds,
  onAdded,
}: {
  fitId: number
  excludeIds: Set<number>
  onAdded: (payload: FitSkills) => void
}) => {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [results, setResults] = React.useState<SkillOption[]>([])
  const [searching, setSearching] = React.useState(false)
  const [busyId, setBusyId] = React.useState<number | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  React.useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (q.length === 0) {
      setResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    const handle = window.setTimeout(() => {
      api
        .searchSkills(q)
        .then((data) => {
          setResults(data.results.filter((item) => !excludeIds.has(item.id)))
          setSearching(false)
        })
        .catch(() => {
          setResults([])
          setSearching(false)
        })
    }, 250)
    return () => window.clearTimeout(handle)
  }, [query, open, excludeIds])

  const close = () => {
    setOpen(false)
    setQuery("")
    setResults([])
  }

  const pick = (skillId: number) => {
    setBusyId(skillId)
    api
      .addCustomSkill(fitId, skillId)
      .then((payload) => {
        onAdded(payload)
        setQuery("")
        setResults([])
        inputRef.current?.focus()
      })
      .catch(() => undefined)
      .finally(() => setBusyId(null))
  }

  if (!open) {
    return (
      <button type="button" className="customSkillAdd" onClick={() => setOpen(true)}>
        + {t("Add skill")}
      </button>
    )
  }

  return (
    <div className="customPicker">
      <div className="customPickerRow">
        <input
          ref={inputRef}
          className="customPickerInput"
          value={query}
          placeholder={t("Search skills…")}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") close()
          }}
        />
        <button type="button" className="customPickerCancel" onClick={close} title={t("Cancel")}>
          ×
        </button>
      </div>
      {query.trim().length > 0 && (
        <div className="customPickerResults">
          {searching && <div className="customPickerHint">{t("Searching…")}</div>}
          {!searching && results.length === 0 && (
            <div className="customPickerHint">{t("No skills found")}</div>
          )}
          {!searching &&
            results.map((item) => {
              const icon = imageUrl(item.image, 1)
              return (
                <button
                  type="button"
                  key={item.id}
                  className="customPickerItem"
                  disabled={busyId === item.id}
                  onClick={() => pick(item.id)}
                >
                  {icon ? (
                    <img className="skillIcon" src={icon} alt="" width={22} height={22} />
                  ) : (
                    <div className="skillIcon placeholder" />
                  )}
                  <span className="customPickerName">{item.name}</span>
                </button>
              )
            })}
        </div>
      )}
    </div>
  )
}

/**
 * A collapsible right-hand drawer listing every skill that affects the open
 * fit: the skills its fitted items require (prerequisites included), the level
 * the fit needs, the fit character's current level and the items that demand
 * each skill, plus a custom section of skills the pilot pinned to the fit by
 * hand, where only the character's current level is displayed. The list is
 * fetched per fit from /api/fits/{id}/skills and refetched whenever a command
 * changes the fit.
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
  const [customRows, setCustomRows] = React.useState<FitSkillRow[]>([])
  const [missing, setMissing] = React.useState(0)
  const [total, setTotal] = React.useState(0)
  const [customTotal, setCustomTotal] = React.useState(0)
  const [loading, setLoading] = React.useState(false)
  const [failed, setFailed] = React.useState(false)

  const fitId = fit?.id ?? null

  const applyPayload = React.useCallback((payload: FitSkills) => {
    setRows(payload.skills)
    setCustomRows(payload.custom ?? [])
    setMissing(payload.missing)
    setTotal(payload.total)
    setCustomTotal(payload.customTotal ?? (payload.custom ?? []).length)
    setFailed(false)
  }, [])

  React.useEffect(() => {
    if (fitId === null) {
      setRows([])
      setCustomRows([])
      setMissing(0)
      setTotal(0)
      setCustomTotal(0)
      setFailed(false)
      return
    }
    let cancelled = false
    setLoading(true)
    api
      .fitSkills(fitId)
      .then((payload) => {
        if (!cancelled) applyPayload(payload)
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
  }, [fitId, fit?.modified, applyPayload])

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
  // With trained skills hidden, keep only custom skills the character has at
  // least one level in -- same idea as the requirements filter above.
  const visibleCustom = showMet ? customRows : customRows.filter((row) => row.currentLevel > 0)

  const removeCustom = (skillId: number) => {
    if (fitId === null) return
    api
      .removeCustomSkill(fitId, skillId)
      .then(applyPayload)
      .catch(() => undefined)
  }

  // Ids that must not be suggested again: already pinned, or already required
  // by the fit (a required skill already shows in the main section).
  const pickerExclude = React.useMemo(() => {
    const ids = new Set<number>(customRows.map((row) => row.id))
    for (const row of rows) ids.add(row.id)
    return ids
  }, [customRows, rows])

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
          {fitId !== null && !loading && !failed && visibleRows.length === 0 && !showMet && (
            <div className="skillsHint">
              {missing === 0 && rows.length > 0 ? t("All skills trained") : t("This fit needs no skills")}
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
          {fitId !== null && (
            <div className="skillsSection">
              <div
                className="skillsSectionTitle"
                title={t("Skills you added yourself; the fit character's current level is shown")}
              >
                {t("Custom skills")}
                <span className="skillsSectionCount">{customTotal}</span>
              </div>
              {visibleCustom.map((row) => (
                <SkillRowItem key={"cus-" + row.id} row={row} custom onRemove={removeCustom} />
              ))}
              <CustomSkillPicker fitId={fitId} excludeIds={pickerExclude} onAdded={applyPayload} />
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
