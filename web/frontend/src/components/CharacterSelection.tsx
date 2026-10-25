import React from "react"
import { useFittingStore } from "../store/fitting"
import { useSessionStore } from "../store/session"
import { t } from "../i18n"

/**
 * The character strip (eveship.fit's CharacterSelection). The dropdown offers the
 * two skill presets every fit can sit on -- All 5 (the default) and All 0 -- plus
 * the EVE characters the pilot has signed in with. Choosing one submits the same
 * ``changeChar`` command the desktop uses, so the fit's math follows that skill
 * sheet. Guests get the presets only (the sign-in lives in the top bar, where it
 * is not duplicated); signed-in users get a sign-out button beside the dropdown.
 */
export const CharacterSelection = () => {
  const user = useSessionStore((state) => state.user)
  const characters = useSessionStore((state) => state.characters)
  const logout = useSessionStore((state) => state.logout)
  const fit = useFittingStore((state) => state.fit)
  const busy = useFittingStore((state) => state.busy)
  const changeCharacter = useFittingStore((state) => state.changeCharacter)

  const currentId = fit?.character?.id ?? null

  // The strip's own labels for the presets; EVE characters keep their real names.
  const label = (name: string) => (name === "All 5" ? "ALL 5" : name === "All 0" ? "ALL 0" : name)

  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const id = Number(event.target.value)
    if (Number.isFinite(id) && id !== currentId) void changeCharacter(id)
  }

  return (
    <div className="charSel">
      <select
        value={currentId === null ? "" : String(currentId)}
        onChange={handleChange}
        disabled={busy || !fit}
        title={t("Character")}
        className={user ? undefined : "full"}
      >
        {currentId === null && <option value="">{t("No fit open")}</option>}
        {/* A fit can still sit on a pilot who is no longer listed (e.g. after
            signing out); keep that row visible so the select has a value. */}
        {currentId !== null && !characters.some((character) => character.id === currentId) && (
          <option value={String(currentId)}>{fit?.character?.name ?? ""}</option>
        )}
        {characters.map((character) => (
          <option key={character.id} value={String(character.id)}>
            {character.kind === "preset" ? label(character.name) : character.name}
          </option>
        ))}
      </select>
      {user && (
        <button onClick={() => void logout()} title={t("Sign out")}>
          &times;
        </button>
      )}
    </div>
  )
}
