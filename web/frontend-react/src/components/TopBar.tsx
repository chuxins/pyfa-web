import React from "react"
import { useFittingStore } from "../store/fitting"
import { useSessionStore } from "../store/session"
import { ModalDialog } from "./ModalDialog"
import { LOCALES, locale, setLocale, t, type LocaleCode } from "../i18n"

/**
 * The top bar, mirroring pyfa-web's original three-column UI: the brand on the
 * left, then the open fit's controls (ship name, editable fit name, undo/redo
 * and the skill-simulation entry point), and on the right the language picker,
 * the sign-in/user block and the pyfa version. Clear / save-as / export live in
 * the fit button bar, so only undo/redo stay here beside the skill simulation
 * button (whose dialog is a stub for now).
 */
export const TopBar = () => {
  const fit = useFittingStore((state) => state.fit)
  const busy = useFittingStore((state) => state.busy)
  const history = useFittingStore((state) => state.history)
  const undo = useFittingStore((state) => state.undo)
  const redo = useFittingStore((state) => state.redo)
  const rename = useFittingStore((state) => state.rename)
  const user = useSessionStore((state) => state.user)
  const logout = useSessionStore((state) => state.logout)
  const pyfaVersion = useSessionStore((state) => state.pyfaVersion)
  const gamedata = useSessionStore((state) => state.gamedata)

  // The fit name is an editable field: keep a local copy, re-sync it when the
  // fit changes (rename, live updates from another tab), commit on blur/Enter.
  const [fitName, setFitName] = React.useState(fit?.name ?? "")
  React.useEffect(() => {
    setFitName(fit?.name ?? "")
  }, [fit?.name])

  // Skill-simulation dialog (placeholder for now; the actual simulation comes later).
  const [skillSimOpen, setSkillSimOpen] = React.useState(false)

  function commitRename() {
    if (!fit || fitName.trim() === "" || fitName === fit.name) return
    void rename(fitName.trim())
  }

  return (
    <>
      <header className="topbar">
      <div className="brand">
        <strong>pyfa</strong>
        <span className="dim">web</span>
      </div>

      {fit && (
        <div className="fitbar">
          <span className="shipname">{fit.ship.item.name}</span>
          <input
            className="fitname"
            value={fitName}
            onChange={(event) => setFitName(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") (event.target as HTMLInputElement).blur()
            }}
            spellCheck={false}
          />
          <button
            disabled={!history.canUndo || busy}
            title={history.undoName ?? t("Undo")}
            onClick={() => void undo()}
          >
            &#8630; {t("Undo")}
          </button>
          <button
            disabled={!history.canRedo || busy}
            title={history.redoName ?? t("Redo")}
            onClick={() => void redo()}
          >
            &#8631; {t("Redo")}
          </button>
          <button onClick={() => setSkillSimOpen(true)}>{t("Skill Simulation")}</button>
          {busy && <span className="dim">{t("working…")}</span>}
        </div>
      )}

      <div className="spacer" />

      <select
        className="lang"
        value={locale()}
        title={t("Interface language")}
        onChange={(event) => setLocale(event.target.value as LocaleCode)}
      >
        {LOCALES.map((entry) => (
          <option key={entry.code} value={entry.code}>
            {entry.label}
          </option>
        ))}
      </select>

      {user ? (
        <span className="user">
          {user.characterName}
          <button onClick={() => void logout()}>{t("Sign out")}</button>
        </span>
      ) : (
        <a className="signin" href="/api/auth/login">
          {t("Sign in with EVE")}
        </a>
      )}

      <span className="dim version" title={t("gamedata build {build}", { build: gamedata.build })}>
        {pyfaVersion}
      </span>
      </header>

      <ModalDialog visible={skillSimOpen} onClose={() => setSkillSimOpen(false)} title={t("Skill Simulation")}>
        <div className="skillSimPlaceholder">
          <p>{t("Skill simulation is under construction")}</p>
          <span className="fbutton fbuttonSmall" onClick={() => setSkillSimOpen(false)} style={{ display: "inline-block" }}>
            {t("Close")}
          </span>
        </div>
      </ModalDialog>
    </>
  )
}
