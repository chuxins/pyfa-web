# 相对上游 pyfa 的改动

本文记录本目录相对上游 `pyfa` 的每一处改动：为什么改、怎么改、用什么测试钉住它。
上游基线：分支 `master` / 提交 `c07d408490c0a85e24f2baea984e0f617bfd48f4`（`v2.69.0`）。
与上游 `diff -rq` 时，内容差异应当只落在本文列出的文件上（外加部署侧文件与被 git 忽略的运行期文件）。

## 1. `db_update.py`：首启建库的时序修复

`db_update.py` 新增 `_release_gamedata_connections()`，并在 `update_db()` 删除旧 `eve.db`
之前调用它（释放 `eos.db.gamedata_session`、`dispose()` 掉 `gamedata_engine`）。

原因：web 引擎在决定重建 `eve.db` 之前就已经导入 `eos.db` 并做过版本探测，探测的数据库连接
被 session 持有并绑定到旧文件；随后 `os.remove(eve.db)` 只是 unlink，旧连接仍指向被删除的
inode，于是 `create_all` 把表建到了新文件、而 `flush()` 走旧连接，首启必然崩在
`sqlite3.OperationalError: no such table: alphaClones`。补丁后首启正常（见 [verification.md](verification.md) 的首启实测）。

## 2. `web/config.py`、`web/main.py`、`web/__main__.py`：子路径部署支持

新增 `root_path` 配置项（`PYFA_WEB_ROOT_PATH` / `web.yml: root_path` / `--root-path`），
规范化后交给 uvicorn 与 FastAPI，让**应用自己生成**的 URL（`/api/docs` 加载的
`openapi.json`、未构建前端时的占位页链接）带上挂载前缀。路由行为不变（前缀仍由反代 strip），
`public_url` 依旧带前缀，所以 SSO 回调不受影响。

## 3. `web/deps.py`、`web/main.py`：`root_path` 下的会话解析（2026-10-01 修复）

uvicorn 会把 `root_path` **拼进** `scope["path"]`（正因如此 Starlette 路由在匹配前又把它去掉），
而 `web/deps.py:UserContextMiddleware`（解析会话 cookie）与 `web/main.py:OriginCheckMiddleware`
（跨站兜底）都用 `scope["path"].startswith("/api")` 做前置判断 -- 子路径部署下这句永远为假：
会话 cookie 从不被解析（`/api/auth/me` 恒为 `authenticated:false`、`/api/meta.user` 恒为 `null`，
界面于是始终显示登录按钮），`OriginCheckMiddleware` 的检查也被静默跳过。

修法：新增 `web/deps.route_path(scope)`，语义与 Starlette 私有的 `get_route_path` 完全一致
（只在段边界剥离前缀；挂载根返回 `""`；形似前缀的路径不剥离），两个中间件改用它。
新增 `web/tests/test_deps.py`（10 项）覆盖以上场景并与 Starlette 官方 helper 逐例对拍。

## 4. `pyfa_compat/wx_headless.py`：翻译目录支持 `.po` 源文件（2026-10-01 修复）

垫片原来只加载编译好的 `lang.mo`（wxWidgets 认的那种），而本仓库带的是 pyfa 的 `.po` 译文源文件
（`*.mo` 是构建产物、已 gitignore），于是 `wx.GetTranslation` 实际是恒等映射：凡是 pyfa 自己写、
而非取自 eve.db 语言列的文案都保持英文。可见的一处正是飞船浏览器里 pyfa 合成的
「Limited Issue Ships」分组 —— 它挂在 `service/market.py` 的 `_t("Limited Issue Ships")` 上，
界面因此永远显示英文（中文词条其实早就有：`locale/zh_CN` 全量 916 条，含 `限量版舰船`）。

修法：`configure_i18n` 仍先找 `lang.mo`，找不到时读同目录的 `lang.po`（多行 msgid/msgstr、C 转义、
`msgstr[0]` 单数形式的复数条目都处理；带 `#, fuzzy` 的条目跳过，与 msgfmt 编译时一致），交给一个
`gettext.NullTranslations` 子类做查表（基类本身不查表，只会原样回传）。副作用是同源文案
（`service/ammo.py` 的 `_t('Misc')`、`service/character.py` 的 `_t("Not learned")` 等）也一并本地化；
这些都是展示用标签，`service/` 里没有拿译文当键比较的地方（已逐处核对，全部 4 处）。
新增 `web/tests/test_i18n.py`（5 项）。`web/docs/web.md` 的「Interface language」与「Limitations」
两段随之改写（原文档把「引擎文案只有 `.mo` 才能翻译」写成已知限制）。

## 5. 舰船树加一层「种族」（2026-10-01 修复）

pyfa 把所有限量版（锦标赛奖励、纪念礼、活动奖励等）舰船塞进同一个合成分组
（`Market.ITEMS_FORCEGROUP` → `les_grp`，ID 恒为 `-1`，`invgroups` 里没有这一行），而这 50 艘舰船
种族并不相同；「巡洋舰」这类正常分组同样跨 6–7 个种族，两者原来都平铺成一行。现在树是四层：

```
舰船（类别） → 巡洋舰（分组） → 艾玛（种族） → 预言级（舰船）
```

做法分两半：

- **接口**（`web/api/ships.py`）：树里的每艘舰船多带一个 `race` 对象 —— `{id, name, order}`
  （`invtypes.raceID`、服务器语言下的族名、用来排序的编号）；接口形状仍是
  `categories[].groups[].ships[]`，前端的 `findShip`、每艘船的装配数、搜索接口都不受影响。
  族名只对已知的列：raceID 1/2/4/8/16 = 加达里/米玛塔尔/艾玛/盖伦特/朱庇特（ESI `universe/races`），
  128 = ORE、135 = 三神裔（各自舰船的中文描述可证：「联合矿业运载舰」「基于三神裔…护卫舰打造」），
  其余 —— 包括 CCP 内部那条被多种海盗舰船共用的 raceID 32、以及 raceID 为空的 —— 统一归入「其他」，
  不做猜测。`order` 把四个帝国排在前、其后是自带舰船的势力（朱庇特/ORE/三神裔）、最后是「其他」：
  编号而非按名排序，因为按族名排序只在一种语言里成立。
- **前端**（`ShipBrowser.vue` + `stores/browser.ts` + `api.ts`）：分组展开后按 `race` 分节渲染，
  种族行可各自折叠（`collapsedRaces`，默认展开，与分组默认折叠相反）。**只有跨两个以上种族的分组
  才画这一层**：单一族的分组、以及游戏数据没给种族的建筑，保持原来的平铺，不画一行重复每艘船身份的标题。

限量版舰船于是自然得到「限量版舰船 → 艾玛 → 传道者级…」：组名仍是 pyfa 写的中文 `限量版舰船`
（§4），组本身仍是一行（id `-1`），种族是客户端画的层，不再需要合成的 `-2`…`-8` 行。

顺带修掉一个会**静默丢组**的隐患：该组的 50 艘船只活在内存里 —— `Market.getShipList` 读的是 pyfa
初始化时挂上的 `addItems`（它没有 `invgroups` 行可查），而这份 `addItems` 属于**某一个** Market 实例。
一旦进程里出现过第二个 Market（根因见 §7），类别里会有**两份同 id 的合成组**，树若拿到那份空白的，
整组就从浏览器里消失（本机测试在 CPU 繁忙时失手过两次）。接口侧两处兜底：`group_ships()` 在该组取不到
船时，按**分组 id**（两份副本共享）回退到当初挂载用的 `ITEMS_FORCEGROUP_R` 名称表；`get_tree()` 再按
分组 id 去重、并按 id 排序遍历（保留哪一份与集合迭代顺序无关）。

测试 6 项：`test_tree_ships_carry_the_race_row_the_client_draws`、
`test_the_limited_issue_group_survives_an_empty_market_list`（monkeypatch 造出「内存列表为空」这一条件）、
`test_the_group_is_found_by_id_when_the_tree_holds_another_copy`（造出「树拿着另一份 -1 组」这一条件）、
`test_a_class_of_several_races_splits_into_them`、
`test_a_race_row_carries_the_game_id_and_the_order_it_sits_in`、`test_race_labels_follow_the_gamedata_language`。

## 6. 重建前端（2026-10-01）

上一版只能把种族做成「组名 · 种族」的同级行，因为当时本机没有 Node、
bundle 是构建产物、改不了。本次确认 `registry.npmjs.org` 可达后装了 `nodejs`/`npm`（apt：node 22.22.1 +
npm 9.2.0），按 `web/docs/web.md` 的做法 `npm ci && npm run build`（vite 6.4.3，版本由
`package-lock.json` 锁死）重建 `web/static`。可复现性已核对：先用原仓库（`/opt/pyfa/web/frontend`）
重建一次，产物与线上 bundle **逐字节相同**（`index-BqOryJcr.js`、`index-BM9PFjtv.css` 的 sha256 一致，
`index.html` 无差异），说明这条构建链能精确复现生产产物，本次改动造成的差异只有预期的那部分
（JS +0.98 KB、CSS +0.34 KB）。Vite `base` 当时仍是默认 `/`，所以当时的反代 `sub_filter` 前缀改写
原样保留、继续生效（2026-10-25 起改为构建期 `base`，那几条改写随之删除，见 [operations.md](operations.md) §1.1）。

## 7. `service/market.py`：`Market.getInstance()` 加锁（2026-10-01 修复）

上游的单例没有保护：`Market.__init__` 会启动飞船浏览器的 worker 线程，而那个线程只
`mktRdy.wait(5)` 等 5 秒就继续，并在 `processRequests()` 里立刻回调 `Market.getInstance()`。冷启动
（`eve.db` 未进页缓存、机器繁忙）一旦让构造超过 5 秒，worker 会**再建一个 Market**。麻烦在于
`Market.__init__` 把自己合成的限量版分组挂进了类别对象（`self.les_grp.category = ships`，而
`getGroupsByCategory()` 正是遍历 `cat.groups`），于是类别里会多出一份 `-1` 组；树拿到的那份若不含
船表，整组就从浏览器里消失。本机测试在 CPU 繁忙的两轮里各失手一次（该轮耗时 42.8s vs 正常 22s）。
手工并发验证：8 个线程同时直接 `Market()` 会造出 8 个实例，改走 `getInstance()` 只造 1 个。

修法：`_instanceLock` + 双重检查（`getInstance`），落败的线程等构造完成、拿到同一个实例。
配套的接口侧兜底见 §5（`group_ships` 按分组 id 回退 + 树按分组 id 去重、并把该组显式补进树），
即使将来又出现第二份分组，树也不会丢船、也不会出现重复行。

## 8. `eos/saveddata/fighter.py`：舰载机只算一门主武器（2026-10-25 修复）

出厂舰队（Templar II、Dragonfly II 等 36 种战斗舰载机）在游戏数据里同时带两个**会造成伤害**的能力：
主攻击 `fighterAbilityAttackM` 和反舰载机导弹 `fighterAbilityMissiles`，而在游戏里同一时刻只可能用其中一门。

上游是**一遍遍历**里决定默认激活哪些能力：碰到 `fighterAbilityAttackM` 就把它打开并记下
`standardAttackActive = True`，其余能力在 `standardAttackActive is False` 时才打开。于是**顺序**决定结果 ——
本仓库的 `eve.db` 里 effectID 小的排在前（`fighterAbilityMissiles` = 6431 早于 `fighterAbilityAttackM` = 6465），
导弹先被看到时 `standardAttackActive` 还是 False，于是**两门武器全开**：

| 凤凰级(Templar II 中队) | 修前 | 修后 |
| --- | --- | --- |
| 激活能力 | Turret Attack + **Missile Attack** | 只有 Turret Attack |
| 齐射 | 3768.19 EM | 1336.5 EM |
| 无人机/舰载机 DPS | **440.99** | **267.3** |

修法：先把"有没有主攻击"判完（`hasStandardAttack`），再遍历激活 —— 有主攻击就只开它，
没有主攻击（支援舰载机，例如 Cenobite I 只有能量中和 + 微曲）才按原意打开其余能力，
微曲与规避机动仍然默认关闭。两个集合写成类常量 `STANDARD_ATTACK_EFFECTS` / `DEFAULT_OFF_EFFECTS`。
回归测试见 `web/tests/test_fighters.py`（7 项：只开主武器、DPS = 齐射/5 s、手动打开导弹后 DPS 变大、
第二种战斗舰载机同样、一队 6 架占 1 个发射管、收回后不计伤害、支援舰载机保留其干扰能力）。

## 9. 未训练技能按 1 级模拟（仅船体加成），与游戏内拟合窗口一致（2026-10-30 修复）

游戏内的装配模拟器（fitting window）在角色**未训练**某项技能时，仍按 **1 级**套用**船体**加成；
而 pyfa 引擎按真实等级（0 级）计算。两者在依赖未训练船体技能的装配上会差一个技能等级，例如：

| 装配（寡妇级 + 5×巡航导弹发射器II + 雷神愤怒巡航 + 3×共和舰队弹道控制） | 游戏内 | 网站（修前） |
| --- | --- | --- |
| 每门 DPS | 112 | 100.8 |
| 每门齐射 | 936.6 | 936.6（不变，该技能只影响射速） |
| 每门循环（BCS 启用） | 8.36 s | 9.29 s |
| 每门循环（BCS 全部停用） | 11.1 s | 12.3 s |

角色 chuxins1 没有学"加达里战列舰"（0 级），而寡妇级"每级 10% 导弹发射器射速"的船体加成在游戏里按 1 级算，
网站按 0 级算 —— 差的就是那 10% 射速（0.9 倍 DPS / 1.111 倍循环）。

**注意：这条 1 级下限只作用于船体加成，不作用于模块技能。** 同一角色的另一处对比证实了这一点：
"护盾补偿"（Shield Compensation，每级 -2% 护盾回充器电容需求）未训练时，游戏按 **0 级**算，
而网站最初按 1 级算，导致吉斯特超大型护盾回充增量器 X 型的电容消耗是 49.98 GJ/s（游戏是 51 GJ/s = 204/4），
电容回充差 1.1 GJ/s。第一版修法把下限放在 `Skill.level` 上，把这个模块技能也抬到了 1 级，因此收窄。

修法：

- `eos/modifiedAttributeDict.py` 的 `__handleSkill()` —— **船体加成读技能等级的唯一入口** —— 在技能未训练（0 级）
  时返回 1。模块技能效果走的是各自技能对象（`container.level`），不经这里，保持真实等级。
  All 5 / All 0 预设不适用（模拟工具，保持固定等级）。
- `web/services/character.py` 新增 `clear_simulation_floor()`：上一版曾把 SSO 角色的 `defaultLevel` 置为 1
  并持久化，现在要清回 `None`。在 SSO 登录与角色条（`/api/meta`）两处调用，一次清理；
  同时丢弃已物化的"1 级"临时技能并从库重读技能表，避免同一会话里旧值残留。

效果（用真实 `users/1` 的 chuxins1 技能表实测）：
- 船体加成：寡妇+巡航装配 **每门 DPS 112.029 / 齐射 936.609 / 循环 8.360 s**（与游戏一致；
  护盾补偿修正后 BCS 停用循环 11.08 s 也一致）。
- 模块技能：吉斯特超大型护盾回充增量器 X 型 **51.0 GJ/s**（游戏同值；修前 49.98）。
回归测试见 `web/tests/test_skill_floor.py`（3 项：未训练船体技能按 1 级、**未训练模块技能不被抬高**、
All 0 预设不受影响）。

顺带修掉一个会**破坏整页**的未提交改动：`web/api/fits.py` 里 `@router.get("/{fit_id}")` 被误挂在
`_dirty` 辅助函数上（`get_fit` 反而没有路由），`GET /api/fits/{id}` 会因缺少 `userData` 查询参数返回 422，
刷新页面即坏。装饰器移回 `get_fit`，`_dirty` 保持为普通辅助函数（`dirty` 字段仍随详情返回）。

## 10. 附：线上问题的定位记录

下面两节是线上问题的排查过程（原 README §8 的两段），修复本身的摘要见 §3、§4、§5。

### 10.1 「登录成功了，页面却还是未登录」（2026-10-01 定位并修复）

现象：真人点「Sign in with EVE」并完成授权后，`journalctl -u pyfa-web` 里能看到
`web.api.auth: User chuxins1 (2124544250) signed in`，但回到站点仍是未登录状态（登录按钮还在）。
两个原因叠加：

1. **成功回调的重定向目标被加了两次前缀。** 前端登录按钮的 `next=` 取的是
   `window.location.pathname`（子路径部署下已经是 `/eveskillplanner/`），应用原样把它作为回调的
   `Location`；API 段原来的 `proxy_redirect ~^/(.*)$ /eveskillplanner/$1` 又无脑补一次前缀 →
   浏览器落到 `/eveskillplanner/eveskillplanner/`（在那页再点一次登录就变三重前缀），该路径不匹配
   任何前端路由，页面也不会再去拉接口。已改为 [operations.md](operations.md) §3 里那对**幂等**规则；同样的规则也补进了 SPA 那个
   location（它原先没有 `proxy_redirect`，`/?error=…` 兜底转发会被送到域名根，那是另一个应用）。
   排查提示：`nginx -s reload` 之后旧 worker 仍会接手若干新连接，改完立刻测可能看到旧行为。
2. **`root_path` 让会话 cookie 从不被解析**（见 §3）：即使浏览器落在正确的 `/eveskillplanner/`，
   `/api/meta` 的 `user` 也永远为 `null`。这正是「登录成功」和「界面仍未登录」能同时出现的原因。

复核（2026-10-01，公网 HTTPS）：

| 检查 | 结果 |
| --- | --- |
| 未登录 | `/api/auth/me` → `{"authenticated":false}`；`/api/commands` → 401 `Sign in with EVE to continue` |
| 带合法会话 cookie | `/api/auth/me` → 200 `authenticated:true`，`user` = chuxins1（角色 2124544250、三个 scope）；`/api/meta` → `user` 有值（界面据此显示登录态）；`/api/commands` → 200 |
| 回调跳转 | 成功 → 303 `https://eve-tools.xyz/eveskillplanner/`（单前缀，不再滚雪球）；`/?error=…` 兜底 → `…/eveskillplanner/api/auth/callback?…`；`error=access_denied` → `…/eveskillplanner/?sso_error=loginCancelled`；登出 → `…/eveskillplanner/` |
| 登出后的前端跳转 | 前端 `await logout()` 后硬跳 `/`（构建期写死），会落到域名根 → 301 `/SnowLuma/`；已在反代层改写为 `window.location.href="/eveskillplanner/"`。且带着旧 `ETag` 的协商请求现在返回 **200 + 新 JS**（旧缓存第一次访问即被替换，不必硬刷新） |
| 回归 | `web/tests` **173 passed**；`route_path` 与 Starlette `get_route_path` 逐例一致 |

> 「带合法会话 cookie」一项是在服务器上用本部署自己的密钥（`/var/lib/pyfa-web/session.key`）临时签了
> 一个只用于 `/api/auth/me`、`/api/meta` 读取的会话（无状态 cookie：没有改数据、没有打印 cookie 值、
> 没有签名以外的副作用）。端到端闭环仍以真人浏览器完成一次 SSO 为准；失败时看 `journalctl -u pyfa-web -f`
> （日志不打印 token），页面会带 `?sso_error=<code>`。

### 10.2 「Limited Issue Ships 显示英文、限量版舰船混成一堆」（2026-10-01 定位并修复）

两个互不相干的问题叠在同一个分组上：

1. **分组名是 pyfa 自己写的字符串，而垫片的翻译目录其实是恒等映射**（只找编译好的 `lang.mo`，
   本仓库只有 `.po` 源文件）→ 界面永远显示英文。修法见 §4。
2. **该分组 50 艘舰船种族各异，却平铺成一行**（pyfa 把限量版舰船全塞进 `les_grp`）→ 看不出谁是谁。
   修法见 §5。

复核（2026-10-01，公网 HTTPS 与本地 8091 一致）：

| 检查 | 结果 |
| --- | --- |
| 分组名 | `限量版舰船`（id `-1`，仍是**一行**，50 艘）；英文 `Limited Issue Ships` 残留 0 处 |
| 必定出现 | 该组只活在内存里，而树读到的类别可能是从库里来的（没有它这一行）；`get_tree()` 会把它显式补上，所以冷启动/繁忙时也不会整组消失 —— 6 路 CPU 负载下连跑 2 轮全绿、无 skip |
| 种族层 | 该组展开出 7 个种族行：盖伦特 13 / 艾玛 11 / 加达里 10 / 米玛塔尔 8 / 其他 5 / 三神裔 2 / ORE 1；`巡洋舰` 6 行；`攻击战列巡洋舰 → 艾玛 → 预言级` 可逐级展开 |
| 语言无关 | 种族行的先后由接口给的 `order` 决定（帝国 → 自带舰船的势力 → 其他），不依赖族名字符串排序 |
| 只对跨族分组 | 单一种族的分组与建筑不画种族行（展开后就是原来的平铺），不会多出一行重复所有人身份的标题 |
| 折叠键 | 分组用 `${类别}/${组名}`、种族用 `${类别}/${组名}/${族名}`，两者层级不同、键都唯一；种族默认展开 |
| 引擎文案 | 同一机制下 `_t('Misc')`→`杂项`、`_t("Limited Issue Ships")`→`限量版舰船`；`web/tests/test_i18n.py` 固定该行为（含多行/转义/复数/fuzzy 跳过） |
| 前端产物 | 公网 `index-CXsZ08Eo.js`（141 KB）/`index-DmO-Lpxb.css` 200；bundle 内含 `collapsedRaces`/`toggleRace`/`in-race`；nginx 前缀改写仍生效（页面引用 `/eveskillplanner/assets/…`） |
| 未受影响 | 其它分组名仍中文（偷运舰 / 力场侦察舰 / 勘探护卫舰…）；`/api/meta`、`/api/ships/587`、`/api/openapi.json`、`/` 均 200 |
| 服务 | `systemctl restart pyfa-web` 后 `active`、`NRestarts=0`；页面每次实读磁盘、`/api/ships/tree` 无缓存头，普通刷新即可看到新树 |
| 回归 | `web/tests` **184 passed**（§4 +5、§5 +6）；`npm run typecheck` 通过 |

> 种族这一层由前端渲染、数据由接口给（每艘船带 `race`），所以「哪个分组该分层」不写在反代或数据里，
> 只写在 `ShipBrowser`/`store/browser.ts` 的一处判断里（跨两族以上才分层）。
> 当时靠反代 `sub_filter` 补齐的 `/assets/`、`/api/`、`/img/` 前缀改写，2026-10-25 起改为构建期 Vite `base`
> （见 [operations.md](operations.md) §1.1），那几条改写已删除。

## 11. 已删除的遗留物（2026-10-30）

- **`legacy/vue-frontend/`**：pyfa-web 最早的 Vue 3 + Vite 界面，提交 `711bca76` 起被 `web/frontend/`
  （React + Vite，合并 eveship.fit 界面）取代，`web/static` 里的产物也早已换成 React 版。它不参与构建、
  不参与部署、也不被任何 Python 代码引用（`Dockerfile` 与 `deploy/auto-update.sh` 都不碰它）。原先保留的
  唯一理由是 `web/docs/` 的界面说明还指向那些 `.vue` 文件；这些说明已改指 React 侧（本文 §10.2 与
  `web/docs/web.md` 的图表面板一段），故整目录删除。历史仍可取回：
  `git show 711bca76:legacy/vue-frontend/src/App.vue`。
- 随目录一起删掉的两条排除规则：`.gitignore` 的 `legacy/*/node_modules/`、`.dockerignore` 的 `legacy`。

