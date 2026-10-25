/**
 * Session: /api/meta, the current user (one EVE character per login), and the
 * login prompt. The server isolates all fit data per user, so a signed-in
 * browser sees only the fits of the character it logged in with.
 */
import { create } from "zustand"
import { api, type MetaCharacter } from "../api"
import { initLocale } from "../i18n"
import { ssoErrorText } from "../errors"

export type LoginReason = "import" | "export" | "any"

interface SessionState {
  loaded: boolean
  pyfaVersion: string
  language: string
  gamedata: { build: string; date: string }
  sso: { server: string; configured: boolean; devBypass: boolean }
  user: { id: number; characterId: number; characterName: string } | null
  characters: MetaCharacter[]
  loginPrompt: "" | LoginReason
  ssoError: string | null
  load: () => Promise<void>
  promptLogin: (reason?: LoginReason) => void
  dismissLoginPrompt: () => void
  logout: () => Promise<void>
}

export const useSessionStore = create<SessionState>((set) => ({
  loaded: false,
  pyfaVersion: "",
  language: "zh_CN",
  gamedata: { build: "", date: "" },
  sso: { server: "Tranquility", configured: false, devBypass: false },
  user: null,
  characters: [],
  loginPrompt: "",
  ssoError: ssoErrorText(new URLSearchParams(window.location.search).get("sso_error")),

  async load() {
    const meta = await api.meta()
    set({
      pyfaVersion: meta.pyfaVersion,
      language: meta.language,
      gamedata: meta.gamedata,
      sso: meta.sso,
      user: meta.user,
      characters: meta.characters,
      loaded: true,
    })
    // The server's language (zh_CN here) is the default for the UI chrome.
    initLocale(meta.language)
  },

  promptLogin(reason: LoginReason = "any") {
    set({ loginPrompt: reason })
  },

  dismissLoginPrompt() {
    set({ loginPrompt: "" })
  },

  async logout() {
    await api.logout()
    // 子路径部署下回落到 <base>/，而不是域名根（那是别的应用）
    window.location.href = import.meta.env.BASE_URL
  },
}))
