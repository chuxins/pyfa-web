import React from "react"
import { Icon, type IconName } from "./Icon"
import { Attr } from "./ShipAttribute"
import { useFittingStore } from "../store/fitting"
import { t } from "../i18n"
import { FitPricePanel } from "./FitPrice"

/** Collapsible statistics panel (eveship.fit's Category). */
const Category = ({
  headerLabel,
  headerContent,
  children,
}: {
  headerLabel: string
  headerContent: React.ReactNode
  children: React.ReactNode
}) => {
  const [expanded, setExpanded] = React.useState(true)
  return (
    <div className="statPanel">
      <div onClick={() => setExpanded((current) => !current)} className="statHeader">
        <div>{headerLabel}</div>
        <div style={{ textAlign: "right" }}>{headerContent}</div>
      </div>
      <div className={expanded ? "statExpanded" : "statCollapsed"}>{children}</div>
    </div>
  )
}

const CategoryLine = (props: { className?: string; children: React.ReactNode }) => (
  <div className={"statLine" + (props.className ? ` ${props.className}` : "")}>{props.children}</div>
)

/** A statistic with a leading icon. */
const Statistic = (props: { icon?: IconName; title?: string; children: React.ReactNode }) => (
  <span title={props.title} className="statistic">
    <span>{props.icon ? <Icon name={props.icon} size={24} /> : <div style={{ width: 24 }}></div>}</span>
    <span>{props.children}</span>
  </span>
)

/** A resistance bar: colored fill for EM/Thermal/Kinetic/Explosive plus the value. */
const Resistance = (props: { value: number; type: "em" | "thermal" | "kinetic" | "explosive" }) => (
  <span className="statResistance">
    <span className="statResistanceProgress" data-type={props.type} style={{ width: `${props.value}%` }}></span>
    <Attr value={props.value} fixed={0} unit="%" />
  </span>
)

/** The shield/armor/hull repair-rate picker, exactly as eveship.fit draws it. */
const RechargeRate = ({
  rates,
}: {
  rates: { passiveShield: number; shieldRepair: number; armorRepair: number; hullRepair: number }
}) => {
  const [moduleType, setModuleType] = React.useState<
    "passiveShieldRechargeRate" | "armorRepairRate" | "hullRepairRate" | "shieldBoostRate"
  >("passiveShieldRechargeRate")
  const [showDropdown, setShowDropdown] = React.useState(false)

  const items: { key: typeof moduleType; label: string; icon: IconName; value: number }[] = [
    { key: "armorRepairRate", label: t("Armor repair rate"), icon: "armor-repair-rate", value: rates.armorRepair },
    { key: "hullRepairRate", label: t("Hull repair rate"), icon: "hull-repair-rate", value: rates.hullRepair },
    { key: "passiveShieldRechargeRate", label: t("Passive shield recharge"), icon: "passive-shield-recharge", value: rates.passiveShield },
    { key: "shieldBoostRate", label: t("Shield boost rate"), icon: "shield-boost-rate", value: rates.shieldRepair },
  ]
  const selected = items.find((item) => item.key === moduleType)!

  return (
    <span className="statRechargeRate">
      <div className="statRechargeRateDropdown" onClick={() => setShowDropdown((current) => !current)}>
        ^
      </div>
      {showDropdown && (
        <div className="statRechargeRateDropdownContent">
          {items.map((item) => (
            <div
              key={item.key}
              onClick={() => {
                setModuleType(item.key)
                setShowDropdown(false)
              }}
              className={moduleType === item.key ? "statRechargeRateDropdownContentSelected" : ""}
            >
              {item.label}
            </div>
          ))}
        </div>
      )}
      <div onClick={() => setShowDropdown((current) => !current)}>
        <Statistic icon={selected.icon}>
          {selected.value > 0 ? <Attr value={selected.value} fixed={1} unit="hp/s" /> : t("No Module")}
        </Statistic>
      </div>
    </span>
  )
}

/** The right-hand statistics pane, laid out exactly like eveship.fit's. */
export const ShipStatistics = () => {
  const fit = useFittingStore((state) => state.fit)
  const stats = fit?.stats ?? null

  if (!stats) {
    return <div className="statistics">{t("No fit open")}</div>
  }

  const cap = stats.capacitor
  const fire = stats.firepower
  const tank = stats.tank
  const resists = stats.resistances
  const target = stats.targeting
  const resources = stats.resources
  const isStructure = fit?.isStructure ?? false

  let capacitorState: string = t("Stable")
  if (!cap.stable) {
    // cap.state 对不稳定配装 = pyfa 电容仿真给出的耗尽秒数（fit.capState）
    const seconds = Math.max(0, cap.state)
    if (Number.isFinite(seconds)) {
      const h = Math.floor(seconds / 3600)
      const m = Math.floor((seconds % 3600) / 60)
      const s = Math.floor(seconds % 60)
      capacitorState = `${t("Depletes in")} ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    } else {
      capacitorState = t("Depletes in") + " --:--:--"
    }
  }

  const shield = resists.resistances.shield ?? { em: 0, thermal: 0, kinetic: 0, explosive: 0 }
  const armor = resists.resistances.armor ?? { em: 0, thermal: 0, kinetic: 0, explosive: 0 }
  const hull = resists.resistances.hull ?? { em: 0, thermal: 0, kinetic: 0, explosive: 0 }

  return (
    <div>
      <Category
        headerLabel={t("Capacitor")}
        headerContent={<span className={cap.stable ? "statCapacitorStable" : "statCapacitorUnstable"}>{capacitorState}</span>}
      >
        <CategoryLine>
          <span>
            <Attr value={cap.capacity} fixed={1} unit="GJ" /> / <Attr value={cap.rechargeRate} fixed={2} divideBy={1000} unit=" s" />
          </span>
        </CategoryLine>
        <CategoryLine>
          <span>
            Δ <Attr value={cap.delta} fixed={1} unit="GJ/s" /> (
            <Attr value={(cap.delta / cap.recharge) * 100} fixed={1} unit="%" />)
          </span>
        </CategoryLine>
      </Category>

      <Category
        headerLabel={t("Offense")}
        headerContent={
          <span>
            <Attr value={fire.dps.value.total} fixed={1} unit="dps" />
          </span>
        }
      >
        <CategoryLine>
          <Statistic icon="damage-dps" title={t("Damage Per Second")}>
            <Attr value={fire.dps.value.total} fixed={1} unit="dps" />
          </Statistic>
          <Statistic icon="damage-alpha" title={t("Alpha Strike")}>
            <Attr value={fire.volley.value.total} fixed={0} unit="HP" />
          </Statistic>
        </CategoryLine>
      </Category>

      <Category
        headerLabel={t("Defense")}
        headerContent={
          <span>
            <Attr value={resists.ehp.total} fixed={0} roundDown unit="ehp" />
          </span>
        }
      >
        <CategoryLine>
          <RechargeRate rates={tank.normal} />
          <span style={{ flex: 2 }}>
            <span className="statResistanceHeader">
              <Icon name="em-resistance" size={28} />
            </span>
            <span className="statResistanceHeader">
              <Icon name="thermal-resistance" size={28} />
            </span>
            <span className="statResistanceHeader">
              <Icon name="kinetic-resistance" size={28} />
            </span>
            <span className="statResistanceHeader">
              <Icon name="explosive-resistance" size={28} />
            </span>
          </span>
        </CategoryLine>
        <CategoryLine className="statDefense">
          <span className="statistic statDefenseShield">
            <span>
              <Icon name="shield-hp" size={24} />
            </span>
            <span>
              <Attr value={resists.hp.shield} fixed={0} roundDown unit="hp" />
              <br />
              {tank.normal.passiveShield > 0 && <Attr value={tank.normal.passiveShield} fixed={0} unit="hp/s" />}
              <br />
            </span>
          </span>
          <span style={{ flex: 2 }}>
            <Resistance value={shield.em} type="em" />
            <Resistance value={shield.thermal} type="thermal" />
            <Resistance value={shield.kinetic} type="kinetic" />
            <Resistance value={shield.explosive} type="explosive" />
          </span>
        </CategoryLine>
        <CategoryLine className="statDefense">
          <span className="statistic">
            <span>
              <Icon name="armor-hp" size={24} />
            </span>
            <span>
              <Attr value={resists.hp.armor} fixed={0} roundDown unit="hp" />
            </span>
          </span>
          <span style={{ flex: 2 }}>
            <Resistance value={armor.em} type="em" />
            <Resistance value={armor.thermal} type="thermal" />
            <Resistance value={armor.kinetic} type="kinetic" />
            <Resistance value={armor.explosive} type="explosive" />
          </span>
        </CategoryLine>
        <CategoryLine className="statDefense">
          <span className="statistic">
            <span>
              <Icon name="hull-hp" size={24} />
            </span>
            <span>
              <Attr value={resists.hp.hull} fixed={0} roundDown unit="hp" />
            </span>
          </span>
          <span style={{ flex: 2 }}>
            <Resistance value={hull.em} type="em" />
            <Resistance value={hull.thermal} type="thermal" />
            <Resistance value={hull.kinetic} type="kinetic" />
            <Resistance value={hull.explosive} type="explosive" />
          </span>
        </CategoryLine>
      </Category>

      <Category
        headerLabel={t("Targeting")}
        headerContent={
          <span>
            <Attr value={target.maxTargetRange} fixed={2} divideBy={1000} unit="km" />
          </span>
        }
      >
        <CategoryLine>
          <Statistic icon="sensor-strength" title={t("Scan Strength")}>
            <Attr value={target.sensorStrength} fixed={2} unit={t("points")} />
          </Statistic>
          <Statistic icon="scan-resolution" title={t("Scan Resolution")}>
            <Attr value={target.scanResolution} fixed={0} unit="mm" />
          </Statistic>
        </CategoryLine>
        <CategoryLine>
          <Statistic icon="signature-radius" title={t("Signature Radius")}>
            <Attr value={target.signatureRadius} fixed={0} unit="m" />
          </Statistic>
          <Statistic icon="maximum-locked-targets" title={t("Maximum Locked Targets")}>
            <Attr value={target.targets} fixed={0} unit="x" />
          </Statistic>
        </CategoryLine>
      </Category>

      {!isStructure && (
        <Category
          headerLabel={t("Navigation")}
          headerContent={
            <span>
              <Attr value={target.speed} fixed={1} unit="m/s" />
            </span>
          }
        >
          <CategoryLine>
            <Statistic icon="mass" title={t("Mass")}>
              <Attr value={target.mass} fixed={2} divideBy={1000} unit="t" />
            </Statistic>
            <Statistic icon="inertia-modifier" title={t("Inertia Modifier")}>
              <Attr value={target.agility} fixed={4} unit="x" />
            </Statistic>
          </CategoryLine>
          <CategoryLine>
            <Statistic icon="warp-speed" title={t("Ship Warp Speed")}>
              <Attr value={target.warpSpeed} fixed={2} unit="AU/s" />
            </Statistic>
            <Statistic icon="align-time" title={t("Align Time")}>
              <Attr value={target.alignTime} fixed={2} unit="s" />
            </Statistic>
          </CategoryLine>
        </Category>
      )}

      {!isStructure && (
        <Category
          headerLabel={t("Drones")}
          headerContent={
            <span>
              <Attr value={fire.drone.value.total} fixed={1} unit="dps" />
            </span>
          }
        >
          <CategoryLine>
            <Statistic title={t("Drone Bandwidth")}>
              <Attr value={resources.drones.bandwidthUsed} fixed={0} />/
              <Attr value={resources.drones.bandwidthTotal} fixed={0} /> {t("Mbit/sec")}
            </Statistic>
            <Statistic title={t("Drone Control Range")}>
              <Attr value={target.droneControlRange} fixed={2} divideBy={1000} unit="km" />
            </Statistic>
          </CategoryLine>
          <CategoryLine>
            <Statistic title={t("Active Drones")}>
              <Attr value={resources.drones.active} fixed={0} /> {t("Active")}
            </Statistic>
            <span className="statistic">
              <span></span>
              <span></span>
            </span>
          </CategoryLine>
        </Category>
      )}

      {stats.errors && Object.keys(stats.errors).length > 0 && (
        <div className="banner-error">{Object.values(stats.errors).join("; ")}</div>
      )}

      <FitPricePanel />
    </div>
  )
}
