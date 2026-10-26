import React from "react"
import { TopBar } from "./TopBar"
import { SelectionPanel } from "./SelectionPanel"
import { PyfaRacks } from "./PyfaRacks"
import { CharacterSelection } from "./CharacterSelection"
import { ShipStatistics } from "./ShipStatistics"
import { SkillsSidebar } from "./SkillsSidebar"
import { SlotPicker } from "./SlotPicker"
import { ImportExportDialog } from "./ImportExportDialog"
import { ModalDialogAnchor } from "./ModalDialog"
import { useLayoutStore, type PortraitTab } from "../store/layout"
import { useFittingStore } from "../store/fitting"
import { useUiStore } from "../store/ui"
import { t } from "../i18n"

/**
 * 手机竖屏的界面：原 pyfa 的三栏（舰船与装配 / 装配 / 统计）保留，
 * 但屏幕上同一时刻只显示一栏，用底部标签切换；中间的装配栏是 pyfa 的竖排排架
 * （见 PyfaRacks），右侧统计栏带技能抽屉。
 *
 * 横屏和桌面不经过这里，走的是 eveship.fit 的径向环三栏（PageMain）。
 */
export const PortraitLayout = () => {
  const tab = useLayoutStore((state) => state.tab)
  const setTab = useLayoutStore((state) => state.setTab)
  const fitId = useFittingStore((state) => state.fit?.id ?? null)

  // 在舰船栏里点开一个装配之后，自动跳到装配栏 —— 手机上不然什么都看不见。
  const lastFitId = React.useRef<number | null>(fitId)
  React.useEffect(() => {
    const previous = lastFitId.current
    lastFitId.current = fitId
    if (fitId === null || previous === fitId) return
    if (useLayoutStore.getState().tab === "ships") setTab("fit")
  }, [fitId, setTab])

  // 没有打开任何装配时先落在舰船栏，那里才有「新建装配」的入口
  React.useEffect(() => {
    if (fitId === null && useLayoutStore.getState().tab === "fit") setTab("ships")
    // 只在进入竖屏时判断一次，之后由用户自己点
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <TopBar />
      <div className="pShell">
        <PortraitNotice />
        <ModalDialogAnchor />
        <div className="pPanes">
          <div className={"pPane" + (tab === "ships" ? " active" : "")}>
            <div className="selection pSelection">
              <SelectionPanel />
            </div>
          </div>

          <div className={"pPane pFitPane" + (tab === "fit" ? " active" : "")}>
            <PortraitFitActions />
            <div className="pScroll">
              <PyfaRacks />
            </div>
          </div>

          <div className={"pPane" + (tab === "stats" ? " active" : "")}>
            <div className="statistics pStatistics">
              <CharacterSelection />
              <ShipStatistics />
            </div>
            <SkillsSidebar />
          </div>
        </div>

        <nav className="pTabs">
          <TabButton tab="ships" current={tab} onClick={setTab} label={t("Ships")} />
          <TabButton tab="fit" current={tab} onClick={setTab} label={t("Fit")} />
          <TabButton tab="stats" current={tab} onClick={setTab} label={t("Stats")} />
        </nav>
      </div>

      <SlotPicker />
      <ImportExportDialog />
    </>
  )
}

const TabButton = (props: {
  tab: PortraitTab
  current: PortraitTab
  onClick: (tab: PortraitTab) => void
  label: string
}) => (
  <button className={props.current === props.tab ? "active" : ""} onClick={() => props.onClick(props.tab)}>
    {props.label}
  </button>
)

/**
 * 竖屏顶部那条跑马灯提示：竖屏这套排架还在磨合，横屏的径向环更稳。
 *
 * 同一句话放两遍（第二遍 aria-hidden），靠 CSS 让它匀速滚过去：
 * 平移 -50% 正好是一遍的宽度，所以接缝处看不出重新开始。
 */
const PortraitNotice = () => {
  const text = t("Portrait mode still has rough edges — landscape is recommended")
  return (
    <div className="pNotice" role="status">
      <span className="pNoticeIcon" aria-hidden="true">
        &#9888;
      </span>
      <div className="pNoticeTrack">
        <span className="pNoticeText">{text}</span>
        <span className="pNoticeText" aria-hidden="true">
          {text}
        </span>
      </div>
    </div>
  )
}

/**
 * 装配栏顶部的一排动作。桌面和横屏用的 FitButtonBar 是悬停弹出式菜单，
 * 触摸屏上「悬停」永远不会离开，所以竖屏换成这种平铺的按钮。
 */
const PortraitFitActions = () => {
  const fit = useFittingStore((state) => state.fit)
  const busy = useFittingStore((state) => state.busy)
  const exporting = useFittingStore((state) => state.exporting)
  const saveAs = useFittingStore((state) => state.saveAs)
  const reset = useFittingStore((state) => state.reset)
  const fitText = useFittingStore((state) => state.fitText)
  const exportToGame = useFittingStore((state) => state.exportToGame)
  const showNotice = useFittingStore((state) => state.showNotice)
  const openImportExport = useUiStore((state) => state.openImportExport)

  const [copied, setCopied] = React.useState(false)

  if (!fit) return null

  const copyEft = async () => {
    const text = await fitText()
    if (text === null) return
    await navigator.clipboard?.writeText(text).catch(() => undefined)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  const copyLink = async () => {
    const text = await fitText()
    if (text === null) return
    const link = `${window.location.origin}/?fit=${encodeURIComponent(text)}`
    await navigator.clipboard?.writeText(link).catch(() => undefined)
    showNotice(t("Fit share URL copied"), 3000)
  }

  return (
    <div className="pActions">
      <button disabled={busy} onClick={() => void copyEft()}>
        {copied ? t("In Clipboard") : t("Clipboard")}
      </button>
      <button onClick={() => void copyLink()}>{t("Share Link")}</button>
      <button disabled={busy} onClick={() => void saveAs()}>
        {t("Save As")}
      </button>
      <button onClick={() => openImportExport()}>{t("Import/Export")}</button>
      <button onClick={() => void exportToGame()} disabled={exporting}>
        {t("Save to EVE")}
      </button>
      <button
        className="danger"
        disabled={busy}
        onClick={() => {
          if (window.confirm(t("Clear fit?"))) void reset()
        }}
      >
        {t("Clear fit")}
      </button>
    </div>
  )
}
