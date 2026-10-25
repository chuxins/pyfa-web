import React from "react"
import { PageMain } from "./components/PageMain"
import { LoginPrompt } from "./components/LoginPrompt"
import { useSessionStore } from "./store/session"
import { useFittingStore } from "./store/fitting"
import { useBrowserStore } from "./store/browser"
import { usePortStore } from "./store/port"
import { api, setUnauthorizedHandler } from "./api"
import { offlineModeEnabled } from "./offline"
import { t } from "./i18n"

/**
 * The app shell: loads the session, connects the live-update stream, handles the
 * ?fit= share URL, and draws the error/notice banners and the login prompt.
 */
export const App = () => {
  const loaded = useSessionStore((state) => state.loaded)
  const ssoError = useSessionStore((state) => state.ssoError)
  const load = useSessionStore((state) => state.load)
  const promptLogin = useSessionStore((state) => state.promptLogin)

  // fitting + browser banners
  const fitError = useFittingStore((state) => state.error)
  const fitNotice = useFittingStore((state) => state.notice)
  const browserError = useBrowserStore((state) => state.error)
  const browserNotice = useBrowserStore((state) => state.notice)
  const portError = usePortStore((state) => state.error)
  const portNotice = usePortStore((state) => state.notice)

  React.useEffect(() => {
    setUnauthorizedHandler(() => promptLogin("any"))
    void boot()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function boot() {
    await load()
    // A shared ?fit= URL: import the EFT text and open the freshest fit.
    const params = new URLSearchParams(window.location.search)
    const shared = params.get("fit")
    if (shared) {
      const result = await api.portImport(shared)
      if (result && result.appliedToFitId !== null) {
        await useFittingStore.getState().open(result.appliedToFitId)
      } else if (result && result.created.length > 0) {
        await useFittingStore.getState().open(result.created[0].id)
      }
      // Clear the URL so a reload does not import the fit again.
      window.history.replaceState(null, "", window.location.pathname)
    } else {
      // A signed-in pilot's EVE fittings are pulled in first, so the most
      // recently changed fit that openLast() picks may be one just imported.
      // Failures (ESI outage, dead token) stay silent in the store here.
      await useBrowserStore.getState().autoImportFromEsi()
      // Open the most recently changed fit (per session: guests get the shared
      // guest fits, a signed-in pilot gets only their own character's fits).
      await useFittingStore.getState().openLast()
    }
    useFittingStore.getState().connect()
    void useBrowserStore.getState().loadTree()
  }

  const error = fitError || browserError || portError
  const notice = fitNotice || browserNotice || portNotice

  return (
    <div className="app">
      {!loaded && <div className="bootscreen">{t("working…")}</div>}
      {loaded && (
        <>
          {offlineModeEnabled() && <div className="banner-error top">{t("Offline mode")}: {t("No fit open")}</div>}
          {ssoError && <div className="banner-error top">{ssoError}</div>}
          {error && <div className="banner-error top">{error}</div>}
          {notice && <div className="banner-notice top">{notice}</div>}
          <PageMain />
          <LoginPrompt />
        </>
      )}
    </div>
  )
}
