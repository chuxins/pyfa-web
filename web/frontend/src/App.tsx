import React from "react"
import { PageMain } from "./components/PageMain"
import { LoginPrompt } from "./components/LoginPrompt"
import { useSessionStore } from "./store/session"
import { useFittingStore } from "./store/fitting"
import { useBrowserStore } from "./store/browser"
import { usePortStore } from "./store/port"
import { api, setUnauthorizedHandler } from "./api"
import { offlineModeEnabled } from "./offline"
import { startLayoutWatch, useLayoutStore } from "./store/layout"
import { t } from "./i18n"

/**
 * The app shell: loads the session, connects the live-update stream, handles the
 * ?fit= share URL, and draws the error/notice banners and the login prompt.
 *
 * It also watches the screen orientation: the shell gets a `mode-*` class so the
 * stylesheet can tell desktop, phone landscape and phone portrait apart (the
 * PageMain picks the fitting UI from the same store).
 */
export const App = () => {
  const loaded = useSessionStore((state) => state.loaded)
  const ssoError = useSessionStore((state) => state.ssoError)
  const load = useSessionStore((state) => state.load)
  const promptLogin = useSessionStore((state) => state.promptLogin)
  const mode = useLayoutStore((state) => state.mode)
  const scale = useLayoutStore((state) => state.scale)

  // fitting + browser banners
  const fitError = useFittingStore((state) => state.error)
  const fitNotice = useFittingStore((state) => state.notice)
  const browserError = useBrowserStore((state) => state.error)
  const browserNotice = useBrowserStore((state) => state.notice)
  const portError = usePortStore((state) => state.error)
  const portNotice = usePortStore((state) => state.notice)

  React.useEffect(() => {
    setUnauthorizedHandler(() => promptLogin("any"))
    // The orientation watcher drives which of the two fitting UIs is drawn
    const stopWatching = startLayoutWatch()
    void boot()
    return stopWatching
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

  // 横屏：整块界面套在一张按 scale 缩放的画布里（尺寸换算在 .uiScale 的
  // CSS 里），所以缩放后正好铺满屏幕；竖屏和桌面直接渲染，不缩放。
  const main = <PageMain />
  const scaledMain =
    mode === "landscape" ? (
      <div className="uiScale" style={{ "--ui-scale": scale } as React.CSSProperties}>
        {main}
      </div>
    ) : (
      main
    )

  return (
    <div className={"app mode-" + mode}>
      {!loaded && <div className="bootscreen">{t("working…")}</div>}
      {loaded && (
        <>
          {offlineModeEnabled() && <div className="banner-error top">{t("Offline mode")}: {t("No fit open")}</div>}
          {ssoError && <div className="banner-error top">{ssoError}</div>}
          {error && <div className="banner-error top">{error}</div>}
          {notice && <div className="banner-notice top">{notice}</div>}
          {scaledMain}
          <LoginPrompt />
        </>
      )}
    </div>
  )
}
