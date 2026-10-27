import React from "react"
import { createPortal } from "react-dom"
import type { SpooledDamage } from "../api"
import { useFittingStore } from "../store/fitting"
import { Attr } from "./ShipAttribute"
import { t } from "../i18n"

/**
 * 鼠标停在 DPS 上时弹出的构成卡：合计 / 武器 / 无人机 各多少，按伤害类型拆开，
 * 再加齐射和「每门武器、每架无人机」的平均 DPS。
 *
 * 用 portal + position: fixed 画到 body 上：右侧统计栏是 overflow:auto 的滚动容器，
 * 画在行内会被裁掉；横屏那套整块缩放的画布也不影响它（portal 在画布之外，
 * clientX/Y 就是屏幕坐标，缩放后的界面照样对得上）。
 *
 * 数字全部来自后端 stats.firepower（pyfa 引擎自己算的），前端只做拆分展示，
 * 所以卡片里的合计永远和统计栏那一行一致。
 */

const DAMAGE_TYPES: { key: "em" | "thermal" | "kinetic" | "explosive" | "pure"; label: string }[] = [
  { key: "em", label: "EM" },
  { key: "thermal", label: "Thermal" },
  { key: "kinetic", label: "Kinetic" },
  { key: "explosive", label: "Explosive" },
  { key: "pure", label: "Pure" },
]

const CARD_WIDTH = 250

const CardRow = (props: { label: string; value: React.ReactNode; strong?: boolean; dim?: boolean }) => (
  <div className={"dpsRow" + (props.strong ? " strong" : "") + (props.dim ? " dim" : "")}>
    <span>{props.label}</span>
    <span>{props.value}</span>
  </div>
)

/** 一个来源（武器或无人机）：总数 + 每单位 + 非零的伤害类型 */
const SourceBlock = (props: { label: string; data: SpooledDamage; count: number; unit: string }) => {
  const total = props.data.value.total ?? 0
  const per = props.count > 0 ? total / props.count : 0
  const types = DAMAGE_TYPES.map((type) => ({ ...type, value: props.data.value[type.key] ?? 0 })).filter(
    (row) => row.value > 0,
  )

  return (
    <>
      <CardRow
        label={props.label}
        value={
          <>
            <Attr value={total} fixed={1} unit="dps" />
            {props.count > 0 && (
              <span className="dim">
                {" "}
                · {props.count} {props.unit} × <Attr value={per} fixed={1} />
              </span>
            )}
          </>
        }
        strong
      />
      {types.map((row) => (
        <CardRow
          key={row.key}
          label={"　" + t(row.label)}
          value={
            <>
              <Attr value={row.value} fixed={1} />
              <span className="dim"> ({((row.value / (total || 1)) * 100).toFixed(0)}%)</span>
            </>
          }
          dim
        />
      ))}
    </>
  )
}

/** 把任意内容包成「悬停显示 DPS 构成卡」的触发器。 */
export const DpsBreakdown = (props: { children: React.ReactNode }) => {
  const fit = useFittingStore((state) => state.fit)
  const [anchor, setAnchor] = React.useState<{ left: number; top: number } | null>(null)
  const fire = fit?.stats?.firepower ?? null

  if (fire === null) return <>{props.children}</>

  const show = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect()
    const left = Math.max(8, Math.min(rect.right - CARD_WIDTH, window.innerWidth - CARD_WIDTH - 8))
    const top = Math.min(rect.bottom + 6, window.innerHeight - 300)
    setAnchor({ left, top: Math.max(8, top) })
  }

  return (
    <>
      <span
        className="dpsTrigger"
        onMouseEnter={(event) => show(event.currentTarget)}
        onMouseLeave={() => setAnchor(null)}
      >
        {props.children}
      </span>
      {anchor !== null &&
        createPortal(
          <div className="dpsCard" style={{ left: anchor.left, top: anchor.top, width: CARD_WIDTH }} role="tooltip">
            <div className="dpsHead">
              <span>{t("DPS breakdown")}</span>
              <span className="dpsTotal">
                <Attr value={fire.dps.value.total ?? 0} fixed={1} unit="dps" />
              </span>
            </div>

            <SourceBlock label={t("Weapons")} data={fire.weapon} count={fire.weaponCount ?? 0} unit={t("guns")} />
            <SourceBlock label={t("Drones")} data={fire.drone} count={fire.droneCount ?? 0} unit={t("units")} />

            <div className="dpsSep" />
            <CardRow label={t("Alpha Strike")} value={<Attr value={fire.volley.value.total ?? 0} fixed={0} unit="HP" />} />

            {/* 蓄能武器（特里格拉夫）：当前蓄能值与满蓄能不同才提示 */}
            {Math.abs((fire.dps.value.total ?? 0) - (fire.dps.fullSpool.total ?? 0)) > 0.05 && (
              <CardRow
                label={t("Full spool")}
                value={
                  <>
                    <Attr value={fire.dps.fullSpool.total ?? 0} fixed={1} unit="dps" />
                    <span className="dim">
                      {" "}
                      ({Math.round((fire.defaultSpoolValue ?? 0) * 100)}% → 100%)
                    </span>
                  </>
                }
                dim
              />
            )}
            <div className="dpsNote dim">{t("Drones count only while launched")}</div>
          </div>,
          document.body,
        )}
    </>
  )
}
