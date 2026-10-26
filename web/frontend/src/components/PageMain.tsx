import React from "react"
import { TopBar } from "./TopBar"
import { SelectionPanel } from "./SelectionPanel"
import { FitButtonBar } from "./FitButtonBar"
import { ShipFitExtended } from "./ShipFitExtended"
import { ShipStatistics } from "./ShipStatistics"
import { CharacterSelection } from "./CharacterSelection"
import { SkillsSidebar } from "./SkillsSidebar"
import { ModalDialogAnchor } from "./ModalDialog"
import { ImportExportDialog } from "./ImportExportDialog"
import { PortraitLayout } from "./PortraitLayout"
import { useLayoutStore } from "../store/layout"
import { t } from "../i18n"

/**
 * 页面主体，按屏幕方向分两套界面（判定见 store/layout.ts）：
 *
 *  - 竖屏（手机）：原 pyfa 式的三栏内容，用底部标签一屏一栏，中间是竖排排架
 *    （PortraitLayout / PyfaRacks）；
 *  - 横屏与桌面：eveship.fit 的界面 —— 顶栏下面一个圆角容器，装着左侧选择栏
 *    （舰船与装配 / 硬件）、中间的径向环装配、右侧角色与统计，技能抽屉贴右沿。
 */
export const PageMain = () => {
  const mode = useLayoutStore((state) => state.mode)

  if (mode === "portrait") return <PortraitLayout />

  return (
    <>
      <TopBar />
      <div className="content">
        <ModalDialogAnchor />
        <div className="selection">
          <SelectionPanel />
          {/* 保存 / 剪贴板 / 分享 / 重命名：桌面和横屏用的悬停菜单 */}
          <FitButtonBar />
        </div>
        <div className="fit">
          <div className="fitRing">
            <ShipFitExtended />
          </div>
        </div>
        <div className="statistics">
          <CharacterSelection />
          <ShipStatistics />
        </div>
        <SkillsSidebar />
      </div>
      <div className="footer">
        © 2014 CCP hf. 保留所有权利。 &quot;EVE&quot;、&quot;EVE Online&quot;、&quot;CCP&quot; 及相关标识为 CCP hf 的商标或注册商标。
        <br />
        {t("Kindly hosted by")}{" "}
        <a href="https://cloudflare.com">Cloudflare</a>.
      </div>

      <ImportExportDialog />
    </>
  )
}
