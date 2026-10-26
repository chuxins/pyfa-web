/**
 * 界面形态：桌面 / 手机横屏 / 手机竖屏。
 *
 * pyfa-web 的两套装配界面按屏幕方向切换（见 App/PageMain）：
 *
 *  - 横屏（以及桌面）：eveship.fit 风格的径向环三栏，环是正方形、需要的是宽度，
 *    横屏正好够宽；
 *  - 竖屏：窄而高的列放不下径向环，改用 pyfa 桌面的竖排排架（高/中/低/改装件/
 *    子系统行列表），原来的三栏内容（舰船与装配、装配、统计）在手机上用底部标签
 *    一次显示一栏。
 *
 * 判定只在移动端生效：桌面浏览器（鼠标 + 宽屏）随便把窗口拉成什么样都还是桌面三栏，
 * 免得把习惯的布局切掉。窄屏（<=1024px）本身也算移动端，这样桌面把窗口压窄也一样
 * 能用——那条断点与环布局自己能接受的最小宽度一致。
 */
import { create } from "zustand"

/** desktop：鼠标/宽屏的径向环三栏；landscape/portrait：手机横/竖屏。 */
export type LayoutMode = "desktop" | "landscape" | "portrait"

/** 竖屏底部标签对应的三栏（与桌面三栏一一对应）。 */
export type PortraitTab = "ships" | "fit" | "stats"

/**
 * 移动端：窄屏，或者触摸指针且屏幕不太宽。
 *
 * 单独的 `pointer: coarse` 不够——带触摸屏的 Windows 笔记本是粗指针但屏幕 1920，
 * 那种设备要的还是桌面布局，所以粗指针再叠一个宽度上限。
 */
const MOBILE_QUERY = "(max-width: 1024px), (pointer: coarse) and (max-width: 1280px)"

/** 竖屏：高度大于宽度（手机转屏、平板竖放都会命中）。 */
const PORTRAIT_QUERY = "(orientation: portrait)"

/**
 * 横屏整块画布的最小设计尺寸。
 *
 * 手机横屏是又宽又矮的一条，桌面那套三栏布局原样放不下；横屏于是把整块画布
 * 按统一系数缩小（CSS transform，见 app.css 的 .uiScale），画布宽高再换算回
 * 屏幕尺寸，缩放后正好铺满。这两个数就是“缩到多小才装得下”的设计下限：
 * 1180×620 是桌面三栏（左侧 350 + 装配 + 统计 350）挤得下的最小尺寸。
 */
const DESIGN_MIN_WIDTH = 1180
const DESIGN_MIN_HEIGHT = 620

/**
 * 横屏的缩放系数：只缩不放（平板/桌面保持 1:1），下限 0.2 防止极端窗口算出 0。
 */
export function uiScaleOf(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return 1
  const raw = Math.min(width / DESIGN_MIN_WIDTH, height / DESIGN_MIN_HEIGHT)
  return Math.min(1, Math.max(0.2, raw))
}

interface LayoutState {
  mode: LayoutMode
  /** 竖屏当前显示哪一栏；桌面/横屏忽略它。 */
  tab: PortraitTab
  /** 横屏整块 UI 的缩放系数（竖屏/桌面恒为 1，不使用）。 */
  scale: number
  setTab: (tab: PortraitTab) => void
  setViewport: (mobile: boolean, portrait: boolean, scale: number) => void
}

function modeOf(mobile: boolean, portrait: boolean): LayoutMode {
  if (!mobile) return "desktop"
  return portrait ? "portrait" : "landscape"
}

/**
 * 首屏就用正确的形态（store 初始化时算一次，之后由 startLayoutWatch 维护），
 * 否则手机上会先闪一下桌面布局再切过来。
 */
function initialViewport(): { mode: LayoutMode; scale: number } {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return { mode: "desktop", scale: 1 }
  }
  const mode = modeOf(window.matchMedia(MOBILE_QUERY).matches, window.matchMedia(PORTRAIT_QUERY).matches)
  return { mode, scale: uiScaleOf(window.innerWidth, window.innerHeight) }
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  ...initialViewport(),
  // 手机上打开装配页比打开舰船列表更常见（页面启动就会打开上次的装配）
  tab: "fit",

  setTab: (tab) => set({ tab }),

  setViewport: (mobile, portrait, scale) => {
    const mode = modeOf(mobile, portrait)
    const next: Partial<LayoutState> = { scale }
    if (mode !== get().mode) {
      next.mode = mode
      // 转到竖屏时回到装配页：转屏的人多半正要改这个装配
      if (mode === "portrait") next.tab = "fit"
    }
    set(next)
  },
}))

/**
 * 挂上方向监听，返回卸载函数。App 挂载时调用一次。
 *
 * `resize` 也一起听：手机浏览器在地址栏收起、软键盘弹出时不会派发 orientationchange，
 * 但 media query 的 change 事件会来，两边都接上就不会漏。
 */
export function startLayoutWatch(): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined

  const mobileQuery = window.matchMedia(MOBILE_QUERY)
  const portraitQuery = window.matchMedia(PORTRAIT_QUERY)

  // 横屏的缩放系数跟着窗口尺寸走（转屏、地址栏收起、分屏拖动都会重算）
  const apply = () =>
    useLayoutStore
      .getState()
      .setViewport(mobileQuery.matches, portraitQuery.matches, uiScaleOf(window.innerWidth, window.innerHeight))
  apply()

  const onChange = () => apply()
  mobileQuery.addEventListener("change", onChange)
  portraitQuery.addEventListener("change", onChange)
  window.addEventListener("orientationchange", onChange)
  window.addEventListener("resize", onChange)

  return () => {
    mobileQuery.removeEventListener("change", onChange)
    portraitQuery.removeEventListener("change", onChange)
    window.removeEventListener("orientationchange", onChange)
    window.removeEventListener("resize", onChange)
  }
}
