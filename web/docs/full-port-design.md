# pyfa-web 全量移植设计文档（v1 评审稿）

- 日期：2026-10-05
- 基线：pyfa-web `master@fbf0bb74`（2026-10-05）/ pyfa `v2.69.0`（`c07d4084` 抽取）
- 目标：把桌面 pyfa 尚未进入 web 的功能按 P1→P5 补齐，使 pyfa-web 达到"日常配装全流程可替代桌面"
- 状态：**部分落地**（2026-10-30 核对，见下方「落地状态」）

## 落地状态（2026-10-30 核对）

P1 与 P4 已落地；P2 只落地了**配装级**价格；P3、P5 未开始。原文档写于 2026-10-05，之后前端由
Vue 3 换成 React（`web/frontend/`），所以下文出现的 `.vue` 文件名、`stores/*.ts` 路径与现状已不对应：
读路径时以 `web/frontend/src/` 下同名的 `.tsx` / `store/*.ts` 为准（这些 `.vue` 文件已不在仓库里）。

| 项 | 状态 | 证据 / 还差什么 |
| --- | --- | --- |
| P1 导入/导出（M1） | ✅ 已落地 | 后端 `web/api/port.py` + `web/services/port.py` + `web/tests/test_port.py`；前端 `components/ImportExportDialog.tsx` + `store/port.ts` |
| P2 价格 | ◐ 部分 | 有 `GET /api/fits/{id}/price`、`POST /api/fits/{id}/price/refresh`（`web/services/prices.py`、`web/tests/test_prices.py`、`components/FitPrice.tsx`）；缺 `GET /api/items/{id}/price`、`GET /api/prices/status`、以及前端按 itemId 的 TTL 缓存层 |
| P3 伤害模式/目标画像/植入体套装管理 | ✗ 未开始 | 无 `web/api/profiles.py`、`web/tests/test_profiles.py`、`ProfileManagerDialog`；目标画像目前只在 `/api/fits/{id}/graphs` 里被只读列出 |
| P4 角色/技能（M4） | ✅ 已落地 | `web/api/characters.py`（技能、植入体、ESI 同步）+ `web/services/{character,skills,charimplants,customskills}.py` + `web/tests/{test_skills,test_implants}.py` + `components/SkillsSidebar.tsx`、`CharacterSelection.tsx` |
| P5 残项 | ✗ 未开始 | 无 `CompareDialog`、无物品统计 CSV 端点、无 `optimizeFitPrice` 命令、无 `SettingsDialog`；`/api/meta` 只报 gamedata 版本 |


## 0. 设计原则

1. **引擎/服务层零重写**：`eos/`、`service/`、`graphs/` 已 100% 复用，web 层只做"适配 + API + 前端"。
2. **一切编辑走命令注册表**：新增编辑功能一律追加 `web/services/commands.py` 的 `@command`，自动获得 undo/redo、重算、提交、SSE 语义。
3. **错误码统一**：沿用 `web/frontend/src/errors.ts` 词汇体系（`esiFailed`、`tokenRefused`…），新增码登记该文件。
4. **每模块交付 pytest**：参照 `web/tests/test_graphs.py` 基建（`conftest.py` 的 app/client/用户上下文）。
5. **不触碰 eos 引擎核心**（唯一例外：P4 需要的极小扩展，见 §6.1）。

## 1. 现状基线（新模块的脚手架，均已就绪）

| 基础设施 | 位置 | 新模块怎么用 |
|---|---|---|
| 命令注册表 | `web/services/commands.py`（78 命令，`COMMANDS` + `CommandContext`） | 追加 `@command` |
| 序列化 | `web/services/serialize.py`：`serialize_fit(fit, includeStats)` / `serialize_fit_summary` | 新端点复用 |
| 统计 | `web/services/stats.py`：`build_stats`（SECTIONS） | 配装对比、requirements 展示 |
| 事件 | `web/events.py`：`Dispatcher`（模拟 wx 线程）+ `EventBus`（SSE）+ `publishing_as(user_id)` | 价格 worker、导入完成通知 |
| 用户绑定 | `web/deps.py`：`user_context` / `get_user_data` / `user_or_guest` / `require_user` | 全部新端点依赖 |
| 无头 wx | `pyfa_compat/wx_headless.py`（`CallAfter`→Dispatcher，`PostEvent`→EventBus） | `service/price.py` 等 wx 依赖点已可运行 |
| ESI token | 登录时写入该用户 saveddata.db 的 `SsoCharacter`；`EsiAccess.refresh` 自动刷新（`web/services/esiFittings.py` 已验证） | P4 技能拉取直接复用 |
| 前端 | React 18 + zustand（原方案 Vue3+Pinia，已换）；`api.ts`（含 401→登录提示）、`store/fitting.ts`、`i18n.ts`（en/zh） | 新组件/ store 照此 |

## 2. 统一约定（新模块共用）

### 2.1 新增 API 文件与路由前缀

| 文件 | 前缀 | 职责 | 注册点 |
|---|---|---|---|
| `web/api/port.py` | `/api/port` | 导入/导出、变异字符串、备份 | `web/api/__init__.py` 追加 `include_router` |
| `web/api/prices.py` | `/api/prices` + `/api/fits/{id}/price` | 价格查询/刷新/总价 | 同上 |
| `web/api/profiles.py` | `/api/profiles` | damage-patterns / target-profiles / implant-sets CRUD | 同上 |
| `web/api/character.py` | `/api/character` | 角色/技能/植入体/requirements | 同上 |
| 命令扩展 | 现有 `web/services/commands.py` | `setDamagePattern`、`setTargetProfile`、`optimizeFitPrice` | 同文件 |

### 2.2 新增错误码（登记 `web/frontend/src/errors.ts`）

- `importUnreadable` / `importUnsupported` / `importPartial`（导入失败/不支持/部分失败）
- `exportUnsupported`（该格式不适用此配装）
- `priceSourceUnavailable` / `priceNoData`（价格源不可达/无数据）
- `patternNameTaken` / `profileNameTaken` / `setNameTaken`（重名，409）
- `noSsoCharacter`（未登录 ESI 角色；可复用现有词汇）
- `skillImportFailed`（技能导入失败）

### 2.3 SSE 事件扩展（`web/events.py` 的 EventBus，沿用 `publishing_as`）

- `fits.imported`（已存在；导入配装后发）
- `prices.changed`（价格刷新完成 → 前端重绘价格列）
- `character.changed`（技能/植入体变更 → 前端重拉当前配装，因统计依赖角色）

## 3. P1 导入/导出

### 3.1 复用映射（`service/port/port.py` 原方法；`progress` 一律传 `None`，`callback` 兜底 `noop`）

| 方向 | 格式 | 方法 | 备注 |
|---|---|---|---|
| 导入 | 自动检测 | `Port.importAuto(string, path=None, activeFit=None, progress=None)` | 返回 `(importType, makesNewFits, fitsImport)`；importType ∈ {EFT, EFT Config, XML, ESI JSON, DNA, DNA-alt} |
| 导入 | 到当前配装 | `Port.importFitFromBuffer(bufferStr, activeFit)` | 桌面"粘贴到当前配装"语义 |
| 导入 | 变异字符串 | `muta.parseMutant` / `parseDynamicItemString` / `fetchDynamicItem` | 单独端点 |
| 导出 | EFT | `Port.exportEft(fit, options, callback)` | `PortEftOptions`（货舱等），见 `service/const.py` |
| 导出 | DNA | `Port.exportDna(fit, options, callback)` | `PortDnaOptions`（格式化标签） |
| 导出 | Multibuy | `Port.exportMultiBuy(fit, options, callback)` | `PortMultiBuyOptions`：装填弹药/植入体/增强剂/货舱/**优化价格** |
| 导出 | Shipstats | `Port.exportFitStats(fit, callback)` | |
| 导出 | EFS | `EfsPort.export` | `service/port/efs.py` |
| 导出 | ESI JSON | `Port.exportESI` | 桌面走剪贴板，web 下载文件 |
| 导出 | HTML | `service/port/html.py`（若存在） | 桌面实现可能含 wx 依赖 → **风险 #2**，前端可自实现 |
| 备份 | 全量 XML | `Port.exportXml(fits, progress, callback)` / `Port.importXml(text, progress)` | 桌面 backup 语义 |

> **M0 冒烟验证（第 8 节）第一步**：直接调用上述方法确认无头可用；重点查 `exportEft` 等函数内部是否无条件调 `callback(...)`（桌面传的是剪贴板回调），若有则在 `web/services/port.py` 包装层兜 `callback or noop`。
>
> **✅ 已实现（M1 后端）**：`web/services/port.py`（`import_text` / `export_fit` / `export_backup` / `import_backup` / `parse_mutant`，错误码 `PortError`）+ `web/api/port.py`（`POST /api/port/import`、`POST /api/fits/{id}/export`、`POST /api/backup/export|import`、`POST /api/items/mutant/parse`）+ `web/tests/test_port.py`（21 项）。M0 已验证所有 export 的 `callback` 均可省略，包装层无需 `noop` 兜底。两个 web 侧差异按风险处理：`optimizePrices: true` 返回 `exportUnsupported`（等 P2 价格桥接）；`html` 导出由前端自实现（后端返回 `exportUnsupported`）。

### 3.2 API 规格

```
POST /api/port/import
  请求: { "text": string, "targetFitId": int|null }     # text = 粘贴或文件内容
  响应 201: {
    "format": "eft"|"eftConfig"|"dna"|"dnaAlt"|"xml"|"esiJson"|"mutant",
    "created": [FitSummary...],           # 新建的配装（makesNewFits=true 时）
    "appliedToFitId": int|null,           # targetFitId 时
    "skipped": [ { "name": string, "reason": string } ]
  }
  错误: 400 importUnreadable | importUnsupported; 409 importPartial

POST /api/fits/{fit_id}/export
  请求: { "format": "eft"|"dna"|"multibuy"|"shipstats"|"efs"|"esiJson"|"html",
          "options": { "cargo": bool, "charges": bool, "implants": bool,
                       "boosters": bool, "optimizePrices": bool, "formatting": bool } }
  响应 200: { "format": string, "filename": string, "content": string,
              "contentType": "text/plain"|"text/html"|"application/json" }
  错误: 400 exportUnsupported

POST /api/backup/export        # 全量 XML 备份 → { "content": string, "filename": string }
POST /api/backup/import        # { "text": string } → { "imported": int, "errors": [...] }
POST /api/items/mutant/parse   # { "text": string } → 解析结果（物品/变异属性）或 400 importUnreadable
```

> **实现偏差（M1 定稿）**：`POST /api/fits/{id}/export` 与 `POST /api/backup/export`
> 直接返回文件本体（`PlainTextResponse` + `Content-Disposition: attachment;
> filename=...`），而非上表的 JSON 信封——浏览器下载/复制更直接，前端
> `api.ts` 的 `requestFile` 读取原始文本与文件名（EFS/ESI JSON 不会被误解析为
> 对象）。`POST /api/backup/import` 的 `errors` 字段暂恒为空（失败整体报错，无
> 逐条跳过），与导入端点一致的 `importUnreadable` 语义。

### 3.3 前端方案

- 新组件 `web/frontend/src/components/ImportExportDialog.vue`，入口：配装详情页工具栏"导入/导出"按钮。
- **导入标签**：文本域粘贴 + 文件选择（`<input type=file>`，`FileReader` 读文本）；"导入为新配装" / "应用到当前配装"单选；结果区展示新建/跳过条目，错误码本地化。
- **导出标签**：格式单选 + 选项复选框（文案对齐桌面 `gui/copySelectDialog.py`：Loaded Charges/Implants/Boosters/Cargo/Optimize Prices/Formatting Tags）+ "下载"（`Blob`+`a.download`）与"复制到剪贴板"。
- **备份标签**：导出备份（下载 .xml）/ 恢复（粘贴或选文件）。
- store：新 `stores/port.ts`；成功后调 `browser.loadTree()` 刷新舰船树。
- i18n：`i18n.ts` 增 `importExport.*` 键（en/zh）。

> **✅ 已实现（M1 前端）**：`stores/port.ts`（importText / exportFit /
> exportBackup / importBackup，`mutantParse` 已接线到 `api.ts` 供后续界面使用）
> + `components/ImportExportDialog.vue`（导入/导出/备份三页签；文件选择、
> 「下载」与「复制到剪贴板」；错误码经 `errors.ts` 本地化）+ `App.vue` 顶栏
> 「导入/导出」入口按钮。导入成功后 `browser.refreshFits()` 刷新舰船树，
> 应用型导入重载当前配装（走 undo 栈，history 同步更新）。导出选项卡只提供
> 后端真正生效的选项：`optimizePrices`（P2 前必被拒绝）不显示，「Mutated
> Attributes」在 EFT 中由后端恒为真，故不设复选框。

### 3.4 测试（`web/tests/test_port.py`）

- `importAuto` 对 EFT/DNA/XML/ESI JSON 样例的识别（样例取自桌面 port 单测输入）。
- 导出内容与桌面输出逐字节比对（固定配装 fixture）。
- 变异字符串解析、备份往返一致性、部分失败（`importPartial`）。

## 4. P2 市场/价格

### 4.1 缓存位置决策（开放问题 #1，推荐方案）

桌面 pyfa 把价格行存在**每用户 saveddata.db**（`eos/db/saveddata/queries.py: getPrice`）；pyfa-web 每用户有独立 saveddata.db，天然同构 → **推荐直接复用 per-user 存储**：零并发风险、行为与桌面一致，代价是 N 个用户重复拉取同一物品价格（可后续加全局只读 LRU 第二层）。`web/docs/web.md` 里 "price cache is global" 的顾虑指的是 `service/price.py` 的 worker 线程与 `requests_cache`，**不影响每用户表方案**。

### 4.2 wx 桥接改造（新 `web/services/prices.py`）

- `service/price.py: PriceWorkerThread` 完成后 `wx.CallAfter(callback, ...)` → `pyfa_compat` 已把 `CallAfter` 桥到 `web/events.Dispatcher`；Dispatcher 回调里再用 `bus.publish(..., "prices.changed")` 推给该用户 SSE 通道（回调运行时 `publishing_as(user_id)` 已由请求上下文带出）。
- 同步等待场景（`getPrices(..., waitforthread=True)`）在 FastAPI 端点里用 `await asyncio.to_thread(...)` 包裹，避免阻塞事件循环。
- 数据源：沿用 `Price.register(SourceClass)` 注册 4 源（fuzzwork / evemarketdata / evetycoon / cevemarket，`service/marketSources/`）；默认源与区域（`Price.systemsList`，Jita 等）由 `web.yml` 新增配置节 `prices:` 提供（默认 `fuzzwork` + `Jita`）。
- 并发去重：进程内 per-item 锁，同一物品的并发 refresh 只触发一次网络请求。

### 4.3 API 规格

```
GET  /api/items/{item_id}/price
  响应: { "itemId": int, "price": float|null, "currency": "ISK",
          "source": string, "region": string, "cached": bool,
          "updated": iso8601|null, "status": "ok"|"noData"|"unavailable" }
POST /api/items/{item_id}/price/refresh     # 强制拉取
GET  /api/fits/{fit_id}/price
  响应: { "total": float, "currency": "ISK",
          "lines": [ { "itemId": int, "name": string, "qty": int,
                       "unitPrice": float|null, "total": float|null,
                       "priceStatus": "ok"|"noData"|"notSupported" } ],
          "missing": [int...], "status": ... }
POST /api/fits/{fit_id}/price/refresh
GET  /api/prices/status      # 数据源 / 区域 / 缓存统计
```

`eos/saveddata/price.py: PriceStatus`（initialized / notSupported / …）映射为上述 `status`。

### 4.4 前端方案

- 新 `stores/prices.ts`：按 itemId 缓存已查价格，TTL 5 分钟。
- 展示点：① `ItemDetails.vue` 加 "市场价" 行 + 刷新按钮；② 配装面板底部 "总价" 行（含 missing 提示）；③ 市场浏览器结果列表价格列（可选，量大懒加载）。
- 配置走 `web.yml`（`prices.source/region`）；前端设置页归 P5。

### 4.5 测试（`web/tests/test_prices.py`）

- monkeypatch 假数据源（不回真实网络）验证 `getPriceNow` / `getPrices` / 总价聚合 / refresh 幂等。
- 并发 refresh 只触发一次网络请求（锁验证）。

## 5. P3 伤害模式 / 目标画像 / 植入体套装

### 5.1 复用映射

| 对象 | service 方法（均在 `service/`） | eos 模型 |
|---|---|---|
| 伤害模式 | `damagePattern.py: DamagePattern`：`getUserDamagePatternList` / `getBuiltinDamagePatternList` / `getDamagePattern` / `newPattern` / `renamePattern` / `deletePattern` / `copyPattern` / `saveChanges` / `importPatterns` / `exportPatterns` | `eos/saveddata/damagePattern.py`；`fit.damagePattern`（可 set） |
| 目标画像 | `targetProfile.py: TargetProfile`：同上 + `getBuiltinTargetProfileList` | `eos/saveddata/targetProfile.py`；`fit.targetProfile`（**setter 已确认存在**） |
| 植入体套装 | `implantSet.py: ImplantSets`：`getImplantSetList` / `getImplantSet` / `getImplants` / `addImplants` / `removeImplant` / `newSet` / `renameSet` / `deleteSet` / `copySet` / `saveChanges` / `importSets` / `exportSets` | `eos/saveddata/implantSet.py` |

内置项（builtin）只读；用户项可 CRUD。注：`addImplantSet` 命令（应用套装到配装）web 已有，本模块补 "套装管理"。

### 5.2 命令扩展（`web/services/commands.py` 追加 `@command`）

```
setDamagePattern   requires=(patternId|null)   # null = 清除
setTargetProfile   requires=(profileId|null)
```

实现：`fit.damagePattern = svcDamagePattern.getDamagePattern(patternId)`（null 清除）→ 走现有命令管线（重算/提交/SSE），天然支持 undo/redo。

### 5.3 API 规格

```
GET/POST   /api/profiles/damage-patterns
GET/PUT/DELETE /api/profiles/damage-patterns/{id}
POST /api/profiles/damage-patterns/{id}/duplicate
POST /api/profiles/damage-patterns/import     # 桌面文本格式导入
GET  /api/profiles/damage-patterns/export     # 全部导出文本
  模型: DamagePattern { id, name, builtin, em, thermal, kinetic, explosive }
── 同构三组 ──
/api/profiles/target-profiles   模型含 resists 结构（id/name/builtin/...）
/api/profiles/implant-sets      模型含 itemIds: int[]
```
重名 → 409（`patternNameTaken` 等）；改/删内置项 → 409。

### 5.4 前端方案

- `StatsPane.vue` 顶部：伤害模式下拉 + "管理…"；Targeting 区块：目标画像下拉 + "管理…"；植入体面板：套装下拉（应用 = `addImplantSet` 命令）+ "管理…"。
- 新 `ProfileManagerDialog.vue`：表格 + 新建/复制/重命名/删除/导入/导出；三份数据源共用一个通用实现；内置项灰显。
- 下拉选择调用 `setDamagePattern` / `setTargetProfile` 命令（可撤销）。

### 5.5 测试（`web/tests/test_profiles.py`）

- CRUD 往返、builtin 保护、重名 409、导入/导出文本往返。
- `setDamagePattern` / `setTargetProfile` 命令 undo/redo 后统计数值变化符合预期。


## 6. P4 角色/技能

### 6.1 后端现状与改造点

**现状（已就绪）**：SSO 登录已把 token 写入该用户 saveddata.db 的 `SsoCharacter`（`web/auth.py`）；`service/esi.py: Esi.getSkills(id)`（按 SsoCharacter 行 id）、`EsiAccess.refresh` 自动刷新均已验证（`web/services/esiFittings.py` 同路径）。桌面 `service/character.py: Character` 提供 `getSkillGroups` / `getSkills` / `getSkillLevel` / `changeLevel` / `addImplant` / `checkRequirements` 等，均无 GUI 依赖（备份线程用 wx，绕开即可）。

**改造点**：
1. `web.yml` 的 `sso.scopes` 启用 `esi-skills.read_skills.v1`（文件里已有注释样例）。
2. 新 `web/services/character.py`：包 `service/character.py` + `service/esi.py`，负责该用户 saveddata.db 中的角色；用 `Character.getSsoCharacter / setSsoCharacter` 把角色与登录的 SSO 角色关联。
3. 导入技能：`Esi.getSkills(ssoId)` → `Character.apiUpdateCharSheet(charID, skills, securitystatus)`。
4. 配装技能要求：`Character.checkRequirements(fit)`（内部走 `service/prereqsCheck.py`）→ 序列化为缺口列表。

### 6.2 API 规格

```
GET  /api/character
  响应: { "id": int, "name": string, "ssoCharacterId": int|null,
          "skillsImported": bool, "securityStatus": float|null,
          "alphaClone": string|null, "implants": [int...] }
POST /api/character/import-from-esi      # 拉 ESI 技能 → 更新；401/409 沿用 esi 错误码
GET  /api/character/skills?q=&group=&page=
  响应: { "groups": [ { "id": int, "name": string,
                        "skills": [ { "id": int, "name": string, "level": int,
                                      "maxLevel": int, "required": bool? } ] } ],
          "total": int }
PUT  /api/character/skills/{skill_id}    # { "level": 0..5, "ifHigher": bool }
GET  /api/character/requirements?fitId=  # 该配装技能要求 vs 角色 → 缺口列表
POST /api/character/implants             # 角色级植入体 { "itemId": int }
DELETE /api/character/implants/{item_id}
```

技能编辑属**角色全局数据**，不进配装 undo 栈（与桌面一致）；配装统计重算由 `character.changed` SSE 触发。

### 6.3 前端方案

- 新 `CharacterPanel.vue`：技能树（分组折叠 + 搜索 + 等级 +/- 按钮，受限 Alpha 克隆提示）、ESI 导入按钮、角色植入体列表、配装要求缺口徽标。
- 新 `stores/character.ts`：加载/编辑/导入；监听 `character.changed` 后让 `fitting` store 重拉当前配装（统计依赖技能等级）。
- `StatsPane.vue` 加 "技能要求" 行：有缺口 → 红色缺口清单。

### 6.4 测试（`web/tests/test_character.py`）

- 技能导入用 mock ESI 响应；`changeLevel` 幂等与 `ifHigher` 语义；requirements 缺口计算（构造已知配装）。

## 7. P5 桌面残项（按需裁剪）

- **配装对比**：`GET /api/fits/compare?ids=a&ids=b`（差分模块/属性/统计），前端 `CompareDialog.vue`。
- **物品统计 CSV**：`GET /api/fits/{id}/export` format=csv 或独立端点（复用 `gui/builtinItemStatsViews/itemAttributes.py` 的 ExportItemStats 逻辑）。
- **优化配装价格命令**：`optimizeFitPrice` @command → `Price.findCheaperReplacements` → 批量 `changeLocalModuleMetas` / `changeLocalModuleCharges`（单命令、可 undo）。
- **设置页**：`web/api/settings.py`（读 `service/settings.py: SettingsProvider`）+ 前端 `SettingsDialog.vue`（UI 语言、价格源/区域、图表默认、单位、重载开关）；服务端全局项（language）改后提示重启。
- **更新检查**：`/api/meta` 已有 gamedata 版本，可加"最新 pyfa 版本"探测（可选，低优先）。

## 8. 里程碑与工作量

| 里程碑 | 内容 | 估计 | 依赖 |
|---|---|---|---|
| M0 | 冒烟验证：Port / Price / Pattern 无头调用 + 每模块 1 个冒烟测试 | ✅ 完成（`web/tests/test_smoke_m0.py`，11 项全绿） | 无 |
| M1 | P1 导入/导出（API + 前端 + 测试） | ✅ 完成（后端 `web/api/port.py` + `web/services/port.py` + `web/tests/test_port.py` 21 项；前端 `store/port.ts` + `components/ImportExportDialog.tsx` + i18n en/zh + 顶栏入口按钮；当时全量 pytest 259 通过，vue-tsc / vite build 通过） | M0 |
| M2 | P2 价格（桥接 + API + 前端 + 测试） | ◐ 部分完成：配装级 `GET/POST /api/fits/{id}/price[/refresh]` 已上线；物品级查询、`/api/prices/status`、前端 TTL 缓存与设置项未做 | M0 |
| M3 | P3 模式/画像/套装（API + 命令 + 前端 + 测试） | ✗ 未开始（3~5 天） | M0 |
| M4 | P4 角色/技能（SSO scope + API + 前端 + 测试） | ✅ 完成（`web/api/characters.py` + `web/services/{character,skills,charimplants}.py` + `web/tests/{test_skills,test_implants}.py` + `components/SkillsSidebar.tsx`；配装技能要求缺口展示随 M3 未做） | M1（SSE） |
| M5 | P5 残项（对比/CSV/优化价格/设置页） | ✗ 未开始（~1 周） | M2、M3 |

合计 **4~6 周（单人）**；M1~M3 文件不重叠，可并行。
每个里程碑完成标准：pytest 全绿 + 前端手测清单（含移动端）+ `web/docs/web.md` Limitations 逐条勾销。

## 9. 风险与开放问题

1. **价格缓存位置**（开放问题 #1）：推荐 per-user 存储；实施后观察重复拉取量，必要时加全局只读 LRU。**需评审确认**。
2. **`service/port` 的 callback 参数**：✅ **M0 已排除**——所有 export 的 `callback` 均带 `None` 默认值（`exportEft/exportDna/exportMultiBuy/exportFitStats/exportXml/exportESI`），不传即同步返回文本；测试 `test_port_exports_return_text_without_gui_callback`、`test_port_export_callback_is_optional_and_still_works` 钉住此行为，包装层**无需** `noop` 兜底。
3. **HTML 导出**：桌面实现（`gui/mainFrame` 相关）可能含 wx 依赖；若无纯函数实现，web 前端用 React 组件自实现等价 HTML（低优先）。
4. **P4 多角色**：桌面支持多角色切换；web 当前账号 = 单角色。本期做单角色，多角色列为后续（涉及 userdb 结构变更）。
5. **每用户游戏数据语言**：需改 `eos/db/gamedata` 列绑定，属引擎级改造，**明确不纳入本期**。
6. **价格 worker 线程生命周期**：✅ **M0 已确认**——`PriceWorkerThread` 是进程级 daemon 线程，其线程**没有** saveddata context，`fetchPrices` 内 `Fit.getInstance()` 会命中 web 的 `UnboundSession` guard，因此 `Price.getPrices` 的**异步 worker 路径在 web 端不可用**（`trigger` 后回调永不触发）。M0 只验证了同步 `fetchPrices` + `wx.CallAfter → Dispatcher` 桥接（context 传播正确）；P2 必须改为请求线程内同步 fetch，或把抓取任务经 `web.events.Dispatcher` 提交（Dispatcher 会携带调用方的 context）。`optimizeFitPrice`（P5）依赖同一修复。
7. **上游同步边界**：pyfa 引擎更新时 `service/port` 等文件会变；保持"仅 `web/` + `pyfa_compat` 为本地改动"的边界（`docs/changes.md` 的 diff 流程），禁止 web 层反向修改引擎文件。
8. **`fill()` 的空槽模块（M0 新发现）**：`importDna/importEft` 返回的 fit 经 `svcFit.recalc + fill` 会用 `EmptyModule` 填满全部机架槽（仅内存，不入库）。`exportFitStats` 走 `getTotalDps()` 会遍历这些空模块并在 `getCycleParameters` 撞 `owner=None`。桌面行为是**先 `db.save(fit)` 再 `getFit(id)` 重载**（重载后不含空槽模块），web 导出端点必须同样对已保存的 fit 操作，或在调用前 `fit.unfill()`；P1 测试须覆盖「保存 → 重载 → 导出」链路。

