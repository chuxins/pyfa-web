import React from "react"
import { api, type CharacterImplants, type Fit, type Item, type MetaCharacter } from "../api"
import { useFittingStore } from "../store/fitting"
import { useSessionStore } from "../store/session"
import { t } from "../i18n"
import { ModalDialog } from "./ModalDialog"
import { ImplantAdder } from "./ImplantAdder"
import { TypeIcon } from "../images"

/**
 * The implant simulator, opened from the top bar. Pick a character (a preset or
 * a signed-in pilot) and the dialog shows that character's own implant list --
 * prefetched from EVE after a login that approves the clone implants scope --
 * and lets the pilot add and remove implants to see how the open fit changes.
 *
 * Applying a character switches the fit to that pilot (changeChar) and makes the
 * fit apply the character's implants rather than any saved on the fit
 * (changeImplantLocation = character). Edits are persisted on the character,
 * mirroring the desktop character editor; an in-game implant removed locally
 * stays simulated away until the clone itself changes.
 */
export const ImplantDialog = ({ visible, onClose }: { visible: boolean; onClose: () => void }) => {
  const fit = useFittingStore((state) => state.fit)
  const applyFit = useFittingStore((state) => state.applyFit)
  const characters = useSessionStore((state) => state.characters)
  const showError = useFittingStore((state) => state.setError)

  const [characterId, setCharacterId] = React.useState<number | null>(null)
  const [data, setData] = React.useState<CharacterImplants | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [syncing, setSyncing] = React.useState(false)

  // Default the picker to the fit's current pilot whenever the dialog opens.
  React.useEffect(() => {
    if (!visible) return
    setData(null)
    setCharacterId(
      fit?.character?.id ??
        characters.find((entry) => entry.kind === "preset" && entry.default)?.id ??
        null,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  React.useEffect(() => {
    if (!visible || characterId === null) {
      setData(null)
      return
    }
    let cancelled = false
    setLoading(true)
    api
      .characterImplants(characterId)
      .then((payload) => {
        if (!cancelled) setData(payload)
      })
      .catch((error) => {
        if (!cancelled) showError(error)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, characterId])

  /** Apply a possibly-refreshed fit and list payload from a write/sync answer. */
  function acceptAnswer(answer: CharacterImplants & { fit?: Fit }) {
    const { fit: refreshedFit, ...list } = answer
    setData(list)
    if (refreshedFit) applyFit(refreshedFit)
  }

  async function chooseCharacter(id: number) {
    setCharacterId(id)
    if (!fit) return
    const commands: { name: string; args: Record<string, unknown> }[] = []
    if (fit.character?.id !== id) {
      commands.push({ name: "changeChar", args: { characterId: id } })
    }
    // Make the fit apply the character's implants rather than any saved on the
    // fit. The command is a no-op (and refused) when the source already is the
    // character, which is the default, so only send it when it actually moves.
    if (fit.implantLocation !== 1) {
      commands.push({ name: "changeImplantLocation", args: { source: 1 } })
    }
    try {
      let current: Fit = fit
      for (const command of commands) {
        current = await api.runCommand(current.id, command.name, command.args)
        applyFit(current)
      }
    } catch (error) {
      showError(error)
    }
  }

  async function syncFromEsi() {
    if (characterId === null) return
    setSyncing(true)
    try {
      acceptAnswer(await api.syncCharacterImplants(characterId, fit?.id))
    } catch (error) {
      showError(error)
    } finally {
      setSyncing(false)
    }
  }

  async function addImplant(item: Item) {
    if (characterId === null || !data) return
    try {
      acceptAnswer(await api.addCharacterImplant(characterId, item.id, fit?.id))
    } catch (error) {
      showError(error)
    }
  }

  async function removeImplant(itemId: number) {
    if (characterId === null || !data) return
    try {
      acceptAnswer(await api.removeCharacterImplant(characterId, itemId, fit?.id))
    } catch (error) {
      showError(error)
    }
  }

  return (
    <ImplantDialogView
      visible={visible}
      onClose={onClose}
      fitReady={fit !== null}
      characters={characters}
      characterId={characterId}
      data={data}
      loading={loading}
      syncing={syncing}
      onChoose={(id) => void chooseCharacter(id)}
      onSync={() => void syncFromEsi()}
      onAdd={(item) => void addImplant(item)}
      onRemove={(itemId) => void removeImplant(itemId)}
    />
  )
}

const ImplantDialogView = ({
  visible,
  onClose,
  fitReady,
  characters,
  characterId,
  data,
  loading,
  syncing,
  onChoose,
  onSync,
  onAdd,
  onRemove,
}: {
  visible: boolean
  onClose: () => void
  fitReady: boolean
  characters: MetaCharacter[]
  characterId: number | null
  data: CharacterImplants | null
  loading: boolean
  syncing: boolean
  onChoose: (id: number) => void
  onSync: () => void
  onAdd: (item: Item) => void
  onRemove: (itemId: number) => void
}) => {
  const readOnly = data?.readOnly ?? false

  return (
    <ModalDialog visible={visible} onClose={onClose} title={t("Implant Simulation")} width={560}>
      <div className="implantDialog">
        <div className="implantCharRow">
          <label>{t("Character")}:</label>
          <select
            value={characterId === null ? "" : String(characterId)}
            disabled={!fitReady}
            onChange={(event) => onChoose(Number(event.target.value))}
          >
            {characters.map((entry) => (
              <option key={entry.id} value={String(entry.id)}>
                {entry.kind === "preset"
                  ? entry.name === "All 5"
                    ? "ALL 5"
                    : entry.name === "All 0"
                      ? "ALL 0"
                      : entry.name
                  : entry.name}
              </option>
            ))}
          </select>
          {data?.hasSso && (
            <button
              type="button"
              className="implantSync"
              disabled={syncing || loading}
              onClick={onSync}
              title={t("Re-pull the implants this pilot's clone carries in game")}
            >
              {syncing ? t("working…") : t("Pull from EVE")}
            </button>
          )}
        </div>

        <div className="scroll implantList">
          {loading && <div className="dim">{t("working…")}</div>}
          {!loading && data && data.implants.length === 0 && (
            <div className="dim implantEmpty">
              {readOnly
                ? t("This preset carries no implants of its own")
                : data.hasSso
                  ? t("No implants yet — pull from EVE or add one below")
                  : t("No implants yet — add one below")}
            </div>
          )}
          {!loading &&
            data?.implants.map((implant) => (
              <div key={implant.itemId} className="implantRow">
                <TypeIcon typeId={implant.itemId} size={28} />
                <span className="implantSlot" title={t("Implant slot")}>
                  {implant.slot === 0 ? "00" : implant.slot}
                </span>
                <span className="implantName">{implant.item?.name ?? implant.itemId}</span>
                <span className={"tag implantSource " + implant.source}>
                  {implant.source === "esi" ? t("In game") : t("Custom")}
                </span>
                {!readOnly && (
                  <button
                    type="button"
                    className="implantRemove"
                    title={t("Remove")}
                    onClick={() => onRemove(implant.itemId)}
                  >
                    &times;
                  </button>
                )}
              </div>
            ))}
        </div>

        {!readOnly && data && (
          <ImplantAdder
            excludeIds={data.implants.map((implant) => implant.itemId)}
            onPick={onAdd}
          />
        )}

        {readOnly && (
          <p className="dim implantHint">
            {t("Preset characters cannot carry implants; pick a pilot to simulate")}
          </p>
        )}

        <div className="implantFooter">
          <span className="fbutton fbuttonSmall" onClick={onClose} style={{ display: "inline-block" }}>
            {t("Close")}
          </span>
        </div>
      </div>
    </ModalDialog>
  )
}
