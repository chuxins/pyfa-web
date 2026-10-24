# pyfa-web React 前端（合并 eveship.fit 界面）

这是 pyfa-web（Python eOS 引擎 + FastAPI）的新前端，用 **Vite + React + TypeScript**
重写了 eveship.fit 的界面（深色三栏：左侧舰船/硬件浏览器、中间装配、右侧统计），
数据全部来自 pyfa-web API，图标来自 **[@eveshipfit/images](https://github.com/EVEShipFit/images)**。

后端引擎与数据保持零改动：`web/api`、`eos`、`service` 等 Python 代码不动，
前端构建产物输出到 `web/static`（FastAPI 现有的 SPA fallback 直接伺服）。

## 目录结构

```
web/frontend-react/
  src/
    api.ts          # 完整类型化 API 客户端（服务端权威）
    store/          # zustand 状态：session / browser / fitting / port / ui
    components/     # Banner、PageMain、HullListing、HardwareListing、ShipFit、
                    #   ShipStatistics、CharacterSelection、SlotPicker、对话框…
    images.tsx      # @eveshipfit/images 分层图标（TypeIcon，含科技等级角标）
    i18n.ts         # 中文界面文案（chrome），游戏内名称由后端 zh_CN 数据提供
    format.ts       # 与桌面版一致的数值格式化
    offline.ts      # 离线模式开发接口（占位，未实现）
    styles/app.css  # eveship.fit 视觉语言（#111111 深色、圆角面板）
```

## 开发

```powershell
# 1. 启动后端（端口 8100，见 pyfa-web/web.yml）
cd D:\dsh\pyfa-web
.\.venv\Scripts\python.exe -m web

# 2. 启动前端 dev server（vite 5173，/api 与 /img 代理到 8100）
cd D:\dsh\pyfa-web\web\frontend-react
npm install
npm run dev
# 打开 http://localhost:5173
```

## 构建 / 部署

```powershell
cd D:\dsh\pyfa-web\web\frontend-react
npm run build   # tsc --noEmit && vite build → ../static（清空旧产物，含 images/ 图标）
```

构建后 `python -m web` 即在 http://localhost:8100 伺服 React 应用。
旧 Vue 产物在 git 历史中可恢复（`web/static/assets/index-BmvVM36Y.js` 等）。

## EVE SSO 单角色隔离

- 后端在 `web/api/auth.py` 实现：登录后会话 cookie 绑定**一个** EVE 角色；
  装配数据按角色隔离（每个角色一个独立数据库）。
- 前端 `CharacterSelection` 显示「使用 EVE 登录」→ `/api/auth/login`，
  回调 `http://localhost:8100/api/auth/callback`（CCP 注册的地址），
  登录后顶部显示角色名，可退出登录。
- 开发（无 EVE 账号）：
  ```powershell
  $env:PYFA_WEB_DEV_AUTH_BYPASS = "1"
  .\.venv\Scripts\python.exe -m web --dev-login
  ```
  此时 `/api/auth/login` 直接以共享本地账号（角色名 All 5）登录。
  注意：回调地址指向 8100，所以开发时通过 vite(5173) 点登录后浏览器会跳到 8100，
  在那里继续使用；生产环境单源无此问题。

## 离线模式

当前**不启用**离线模式，但保留了开发接口（`src/offline.ts`）：

- `VITE_OFFLINE=1` 启动会在页面顶部显示离线模式横幅；
- `offlineDataSource()` 是未来本地引擎的接入点，目前直接抛错，避免静默返回过期数据。
- 离线模式的开发认证走后端的 `--dev-login`（仍是服务端）。

## URL 分享

支持 eveship.fit 风格的 `?fit=` 分享：`http://localhost:8100/?fit=<EFT 文本>`，
页面加载时自动导入并打开（见 `src/App.tsx` 的 `boot()`）。

## 编辑器能力（对应后端命令）

- 槽位点击 → 槽位物品选择器（按槽位 scope 搜索，服务端按舰船过滤）
- 模块：状态循环（单击/右键过载/Ctrl 离线）、装填弹药、更换变体、移除
- 无人机/货舱/植入体/增效剂：数量、状态、移除
- 撤销/恢复、清空、另存为、导出 TXT / 导出到游戏、导入/导出对话框（EFT/DNA/Smiley/XML/EFS/ESI）
- XML 备份导出/恢复；`?fit=` 分享导入
- SSE 实时同步（另一标签页编辑同一装配时自动刷新）
## UI 重写为 eveship.fit 完全一致（2026-10）

装配面板从 pyfa 式堆叠排架改为 **eveship.fit 的游戏内式径向环**：

- 舰船渲染居中（`images.evetech.net` render），槽位（高/中/低/改装件/子系统）
  按 eveship.fit 的旋转角分布在环上，含炮塔/发射器硬点、rig/CPU/PG 用量弧线、
  径向菜单标记、槽位 SVG 状态着色（在线绿/过载红/离线灰）。
- 左侧 "舰船与装配 / 硬件" 树：Hull & Fits 按 类别→组→族→船→装配 展示
  （`GET /api/fits` 全量装配按船分组，本地/游戏内筛选图标、当前船筛选），
  Hardware 为搜索驱动 + 槽位筛选图标（后端无市场树端点，见下）。
- 右侧统计：可折叠分类卡（电容/火力/防御/锁定/导航/无人机），
  防御区带 EM/热能/动能/爆炸抗性进度条与回充速率下拉。
- 底部 FitButtonBar：保存/剪贴板/分享链接/重命名（悬停弹出），
  分享链接复制 `?fit=` URL；剪贴板保留完整 导入/导出 对话框入口。
- 货舱/无人机舱悬浮面板、模拟历史（撤销/恢复条带）、角色选择条（单角色 SSO）。
- 全量中文界面；UI 图标（`public/images/ui/*.png`）与 Noto Sans 字体（`public/fonts/*.woff2`）
  已随构建复制到 `web/static`。

**交互约定**（与 eveship.fit 相同，均由后端命令驱动）：

- 从 Hardware 拖拽物品到槽位/舰船中心装配；双击条目直接装配；悬停显示预览（sephia）。
- 单击槽位循环状态（后端 `changeLocalModuleStates cycle`，被动模块自动只在高/离线间切换），
  Shift+单击 后退一步（`left`），槽位悬停操作：卸弹药/卸模块/设离线。
- 槽位间拖拽交换（`swapLocalModules`）；弹药拖到槽位装填（`changeLocalModuleCharges`）。

**后端最小修复**（`web/services/commands.py`）：

- `execute()` 与 `CommandContext.require()` 的参数存在性校验由
  `payload.get(name) is None` 改为 `name not in payload`，使
  `changeLocalModuleCharges` 的 `chargeItemId: null`（卸空弹药）能够通过校验。

**已知限制**（后端未改动，前端适配）：

- Hardware 页没有完整市场树（后端仅有搜索端点），为搜索驱动：
  输入关键词 + 槽位筛选图标（按 scope high/med/low/rig 搜索）或无人机筛选。
- 统计中的"含装填 DPS"未显示（后端 firepower 无 withReload 字段）；
  无人机的激活数量按 已有状态 展示。

