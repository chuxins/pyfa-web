import React from "react"
import { apiUrl } from "../api"
import { ModalDialog } from "./ModalDialog"
import { useSessionStore } from "../store/session"
import { t } from "../i18n"

/** Why the sign-in prompt is up; the same words the server's refusal uses. */
const REASONS: Record<string, string> = {
  import: "Importing your EVE fits reads them from EVE as you, so it needs a login first.",
  export: "Exporting a fit to your EVE character needs a login first.",
  any: "This needs a login.",
}

export const LoginPrompt = () => {
  const loginPrompt = useSessionStore((state) => state.loginPrompt)
  const dismiss = useSessionStore((state) => state.dismissLoginPrompt)
  const sso = useSessionStore((state) => state.sso)

  if (!loginPrompt) return null

  return (
    <ModalDialog title={t("Sign in to continue")} onClose={dismiss}>
      <p>{t(REASONS[loginPrompt] ?? REASONS.any)}</p>
      {sso.configured ? (
        <div className="loginActions">
          <a className="btn primary" href={apiUrl("/api/auth/login")}>
            {t("Sign in with EVE")}
          </a>
          <button onClick={dismiss}>{t("Cancel")}</button>
        </div>
      ) : (
        <p className="dim">{t("EVE SSO is not configured on this server.")}</p>
      )}
    </ModalDialog>
  )
}
