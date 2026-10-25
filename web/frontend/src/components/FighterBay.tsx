import React from "react"
import { useFittingStore } from "../store/fitting"
import type { Fighter } from "../api"
import { formatAmount } from "../format"
import { t } from "../i18n"

/**
 * The fighter bay of a carrier (or supercarrier): one row per squadron, the abilities
 * each squadron can fly with, and whether it is in space or in the hangar.
 *
 * A squadron is one unit -- there is nothing to launch "one at a time" -- so a row
 * launches or recalls the whole squadron, and each ability chip switches that ability
 * on or off (the engine only counts the abilities that are on).
 */
export const FighterBay = () => {
  const fit = useFittingStore((state) => state.fit)
  const toggleFighter = useFittingStore((state) => state.toggleFighter)
  const toggleFighterAbility = useFittingStore((state) => state.toggleFighterAbility)
  const removeFighter = useFittingStore((state) => state.removeFighter)

  if (!fit) return <></>

  const fighters = fit.fighters.filter((fighter) => fighter.itemId !== null)
  if (fighters.length === 0) {
    return <div className="droneBay">{t("No fighters in the bay")}</div>
  }

  const resources = fit.stats?.resources.fighters
  const launched = fighters.filter((fighter) => fighter.active).length

  return (
    <div className="droneBay">
      <div className="droneBayHeader">
        <span>
          {t("Squadrons")}: {resources?.tubesUsed ?? launched} / {resources?.tubesTotal ?? 0}
        </span>
        <span className="droneBayBandwidth">
          {t("Bay")}: {formatAmount(resources?.bayUsed ?? 0, { prec: 3, lowest: 0, highest: 0 })} /{" "}
          {formatAmount(resources?.bayTotal ?? 0, { prec: 3, lowest: 0, highest: 0 })} m³
        </span>
      </div>
      {fighters.map((fighter) => (
        <FighterBayEntry
          key={fighter.position}
          fighter={fighter}
          onToggle={() => void toggleFighter(fighter.position)}
          onAbility={(effectId) => void toggleFighterAbility(fighter.position, effectId)}
          onRemove={() => void removeFighter(fighter.position)}
        />
      ))}
      <div className="dim" style={{ marginTop: 4 }}>
        {t("Tip: drag fighters to the ship to add them")}
      </div>
    </div>
  )
}

const FighterBayEntry = ({
  fighter,
  onToggle,
  onAbility,
  onRemove,
}: {
  fighter: Fighter
  onToggle: () => void
  onAbility: (effectId: number) => void
  onRemove: () => void
}) => (
  <div className={"droneBayEntry" + (fighter.active ? "" : " fighterInHangar")}>
    <div className="droneBayAmount">{Math.max(1, fighter.amount ?? 1)} x</div>
    <div>
      <img src={`https://images.evetech.net/types/${fighter.itemId}/icon?size=64`} alt="" />
    </div>
    <div className="droneBayMiddle">
      <div className="droneBayName">{fighter.item?.name ?? ""}</div>
      <div className="fighterAbilities">
        {(fighter.abilities ?? []).map((ability) => (
          <span
            key={ability.effectId}
            className={"fighterAbility" + (ability.active ? " fighterAbilityOn" : "")}
            onClick={() => onAbility(ability.effectId)}
            title={t("Click to switch this ability on or off")}
          >
            {t(ability.name ?? String(ability.effectId))}
          </span>
        ))}
      </div>
    </div>
    <div
      className={"fighterLaunch" + (fighter.active ? " fighterLaunchOn" : "")}
      onClick={onToggle}
      title={fighter.active ? t("Recall") : t("Launch")}
    >
      {fighter.active ? t("Recall") : t("Launch")}
    </div>
    <div className="droneBayClose" onClick={onRemove} title={t("Remove squadron")}>
      X
    </div>
  </div>
)
