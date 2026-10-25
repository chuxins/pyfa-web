import React from "react"
import { useFittingStore } from "../store/fitting"
import { t } from "../i18n"

/**
 * The high rack's weapon-grouping toggle.
 *
 * pyfa's desktop links the identical weapons of the high rack so one state click -- or
 * one loaded charge -- reaches the whole group. The web port keeps that in the fitting
 * store (`weaponGroups` / `groupMates`), and this is the button that turns it on: it only
 * appears when the rack actually holds a weapon twice, because grouping a lone gun does
 * nothing. The grouping is browser state, not fit data -- the engine has no such concept,
 * so it lasts as long as the fit stays open.
 */
export const HighRackTools = () => {
  const fit = useFittingStore((state) => state.fit)
  const weaponGroups = useFittingStore((state) => state.weaponGroups)
  const toggleWeaponGroups = useFittingStore((state) => state.toggleWeaponGroups)

  const { groups, guns } = React.useMemo(() => {
    const counts = new Map<number, number>()
    let guns = 0
    for (const module of fit?.racks.high ?? []) {
      if (module.isEmpty || !module.hardpoint || module.itemId === null) continue
      guns += 1
      counts.set(module.itemId, (counts.get(module.itemId) ?? 0) + 1)
    }
    return { groups: [...counts.values()].filter((count) => count > 1).length, guns }
  }, [fit])

  if (groups === 0) return null

  return (
    <div className="sfxHighTools">
      <button
        type="button"
        className={"sfxGroupToggle" + (weaponGroups ? " sfxGroupToggleOn" : "")}
        onClick={toggleWeaponGroups}
        title={t("Group the same weapons in this rack so one click or charge reaches them all")}
      >
        {weaponGroups ? t("ungroup weapons") : t("group weapons")}
        <span className="sfxGroupCount">
          {weaponGroups
            ? t("{count} grouped", { count: guns })
            : t("{count} weapons", { count: guns })}
        </span>
      </button>
    </div>
  )
}
