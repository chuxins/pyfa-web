# pyfa Web —— 独立抽取版运行栈

从 `/opt/pyfa` 抽取出来的 pyfa Web 服务栈，**可脱离原仓库独立运行**：`python -m web`
启动 FastAPI 服务，对外提供 pyfa 的装配计算引擎（eos）REST API，并直接托管已构建好的前端页面。

## 1. 来源与版本

| 项 | 值 |
| --- | --- |
| 来源仓库 | `/opt/pyfa` |
| 分支 / 提交 | `master` / `c07d408490c0a85e24f2baea984e0f617bfd48f4` |
| pyfa 版本 | `v2.69.0`（`version.yml`）；web 版本 `0.1.0` |
| 抽取时间 | 2026-10-01 |
| 抽取方式 | 从 `web/__main__.py`、`web/main.py` 入口做 AST 导入闭包 → 366 个 `.py`，零未解析导入；再逐个 `diff -rq` 与原仓库比对一致；`compileall` 无错误 |
| 线上部署 | `https://eve-tools.xyz/AssemblyPlanning/`（2026-10-01 上线，2026-10-02 迁到 `/AssemblyPlanning`，见 §8、§9） |

## 2. 目录内容

| 路径 | 作用 | 必需 |
| --- | --- | --- |
| `web/` | FastAPI 应用：`__main__.py` 入口、`api/`、`auth.py`、`engine.py`、`userdata.py`、`admin.py`、`static/`（预构建前端）、`frontend/`（前端源码）、`docs/`、`tests/` | 是 |
| `pyfa_compat/` | 无头 wx 兼容层（服务端不需要 wxPython） | 是 |
| `eos/` | 装配计算引擎、数据模型、`eos/db` 数据库层 | 是 |
| `service/` | 业务服务层（fit/设置/翻译等） | 是 |
| `config.py`、`db_update.py` | pyfa 配置与 `eve.db` 构建入口 | 是 |
| `gui/`、`graphs/`、`utils/` | 被上层 import 依赖（不含桌面 UI 运行所需） | 是（import 依赖） |
| `staticdata/` | EVE 静态数据，构建 `eve.db` 的唯一数据源 | 是 |
| `imgs/` | 图标与舰船渲染图，`/img/*` 路由的数据源 | 是 |
| `locale/` | 翻译资源 | 是 |
| `version.yml`、`pyproject.toml`、`uv.lock`、`web.yml.example`、`Dockerfile`、`compose.yml`、`LICENSE`、`.python-version` | 版本/依赖/配置/打包参考 | 是 |
| `eve.db` | 运行时生成的 SQLite 静态数据库（97 MB，18 张表，27808 条 `invtypes`）；**已预生成，可删**，首启会自动重建 | 否（自动生成） |

未包含：仓库根 `tests/`（与 web 无关）、`dist_assets/`、`pyfa.spec`（桌面打包用）。

## 3. 依赖与运行

- Python：3.14（见 `.python-version`）
- 依赖 pin：`pyproject.toml` 的 `dependencies` + 可选组 `web`；完整锁在 `uv.lock`

```bash
# uv（推荐）
uv sync --group web

# 或 pip
python3.14 -m venv .venv && . .venv/bin/activate
pip install logbook==1.9.2 numpy==2.5.1 matplotlib==3.11.1 python-dateutil==2.9.0.post0 \
            requests==2.34.2 sqlalchemy==2.0.51 cryptography==50.0.0 markdown2==2.5.5 \
            packaging==26.2 roman==5.2 beautifulsoup4==4.15.0 pyyaml==6.0.3 \
            python-jose==3.5.0 requests-cache==1.3.3 fastapi==0.141.1 \
            "uvicorn[standard]==0.54.0" itsdangerous==2.2.0 httpx==0.28.1
```

启动：

```bash
cd /opt/pyfa-web
PYFA_WEB_DEV_AUTH_BYPASS=1 python -m web --host 127.0.0.1 --port 8080 --data-dir /path/to/data
```

配置：`cp web.yml.example web.yml` 后编辑；环境变量 `PYFA_WEB_*` 优先于该文件。
`--data-dir` 下存放账号库、每用户 `saveddata.db`、设置与日志。
线上部署请勿开启 `dev_auth_bypass`（默认关闭）。

本机 venv：生产用 `/opt/pyfa-web/.venv`（已装齐上述依赖，属主 `pyfaweb`）；
验证/测试用 `/tmp/pyfaweb-venv`（额外含 pytest）。

## 4. 首次启动行为（实测）

- 目录内**没有** `eve.db` 时，服务会先打印
  `Building EVE static data database (eve.db) from staticdata/, this can take a minute`，
  从 `staticdata/` 构建（本机约 57 秒），完成后再开始监听。
- 该次进程内 `/api/meta` 的 `gamedata.build` 会是 `null`（版本在导入期读取，早于建库）；
  **重启一次即返回正常值**（如 `3532181`）。其余接口当次即可正常使用。

## 5. 本目录相对上游的改动

**5.1 `db_update.py`：首启建库的时序修复。**

`db_update.py` 新增 `_release_gamedata_connections()`，并在 `update_db()` 删除旧 `eve.db`
之前调用它（释放 `eos.db.gamedata_session`、`dispose()` 掉 `gamedata_engine`）。

原因：web 引擎在决定重建 `eve.db` 之前就已经导入 `eos.db` 并做过版本探测，探测的数据库连接
被 session 持有并绑定到旧文件；随后 `os.remove(eve.db)` 只是 unlink，旧连接仍指向被删除的
inode，于是 `create_all` 把表建到了新文件、而 `flush()` 走旧连接，首启必然崩在
`sqlite3.OperationalError: no such table: alphaClones`。补丁后首启正常（详见第 6 节）。

**5.2 `web/config.py`、`web/main.py`、`web/__main__.py`：子路径部署支持。**

新增 `root_path` 配置项（`PYFA_WEB_ROOT_PATH` / `web.yml: root_path` / `--root-path`），
规范化后交给 uvicorn 与 FastAPI，让**应用自己生成**的 URL（`/api/docs` 加载的
`openapi.json`、未构建前端时的占位页链接）带上挂载前缀。路由行为不变（前缀仍由反代 strip），
`public_url` 依旧带前缀，所以 SSO 回调不受影响。

**5.3 `web/deps.py`、`web/main.py`：`root_path` 下的会话解析（2026-10-01 修复）。**

uvicorn 会把 `root_path` **拼进** `scope["path"]`（正因如此 Starlette 路由在匹配前又把它去掉），
而 `web/deps.py:UserContextMiddleware`（解析会话 cookie）与 `web/main.py:OriginCheckMiddleware`
（跨站兜底）都用 `scope["path"].startswith("/api")` 做前置判断 -- 子路径部署下这句永远为假：
会话 cookie 从不被解析（`/api/auth/me` 恒为 `authenticated:false`、`/api/meta.user` 恒为 `null`，
界面于是始终显示登录按钮），`OriginCheckMiddleware` 的检查也被静默跳过。

修法：新增 `web/deps.route_path(scope)`，语义与 Starlette 私有的 `get_route_path` 完全一致
（只在段边界剥离前缀；挂载根返回 `""`；形似前缀的路径不剥离），两个中间件改用它。
新增 `web/tests/test_deps.py`（10 项）覆盖以上场景并与 Starlette 官方 helper 逐例对拍。

**5.4 `pyfa_compat/wx_headless.py`：翻译目录支持 `.po` 源文件（2026-10-01 修复）。**

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

**5.5 舰船树加一层「种族」（2026-10-01 修复）。**

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
（§5.4），组本身仍是一行（id `-1`），种族是客户端画的层，不再需要合成的 `-2`…`-8` 行。

顺带修掉一个会**静默丢组**的隐患：该组的 50 艘船只活在内存里 —— `Market.getShipList` 读的是 pyfa
初始化时挂上的 `addItems`（它没有 `invgroups` 行可查），而这份 `addItems` 属于**某一个** Market 实例。
一旦进程里出现过第二个 Market（根因见 §5.7），类别里会有**两份同 id 的合成组**，树若拿到那份空白的，
整组就从浏览器里消失（本机测试在 CPU 繁忙时失手过两次）。接口侧两处兜底：`group_ships()` 在该组取不到
船时，按**分组 id**（两份副本共享）回退到当初挂载用的 `ITEMS_FORCEGROUP_R` 名称表；`get_tree()` 再按
分组 id 去重、并按 id 排序遍历（保留哪一份与集合迭代顺序无关）。

测试 6 项：`test_tree_ships_carry_the_race_row_the_client_draws`、
`test_the_limited_issue_group_survives_an_empty_market_list`（monkeypatch 造出「内存列表为空」这一条件）、
`test_the_group_is_found_by_id_when_the_tree_holds_another_copy`（造出「树拿着另一份 -1 组」这一条件）、
`test_a_class_of_several_races_splits_into_them`、
`test_a_race_row_carries_the_game_id_and_the_order_it_sits_in`、`test_race_labels_follow_the_gamedata_language`。

**5.6 重建前端（2026-10-01）。** 上一版只能把种族做成「组名 · 种族」的同级行，因为当时本机没有 Node、
bundle 是构建产物、改不了。本次确认 `registry.npmjs.org` 可达后装了 `nodejs`/`npm`（apt：node 22.22.1 +
npm 9.2.0），按 `web/docs/web.md` 的做法 `npm ci && npm run build`（vite 6.4.3，版本由
`package-lock.json` 锁死）重建 `web/static`。可复现性已核对：先用原仓库（`/opt/pyfa/web/frontend`）
重建一次，产物与线上 bundle **逐字节相同**（`index-BqOryJcr.js`、`index-BM9PFjtv.css` 的 sha256 一致，
`index.html` 无差异），说明这条构建链能精确复现生产产物，本次改动造成的差异只有预期的那部分
（JS +0.98 KB、CSS +0.34 KB）。Vite `base` 仍是默认 `/`，所以 §7/§8 的反代 `sub_filter` 前缀改写
原样保留、继续生效。

**5.7 `service/market.py`：`Market.getInstance()` 加锁（2026-10-01 修复）。**

上游的单例没有保护：`Market.__init__` 会启动飞船浏览器的 worker 线程，而那个线程只
`mktRdy.wait(5)` 等 5 秒就继续，并在 `processRequests()` 里立刻回调 `Market.getInstance()`。冷启动
（`eve.db` 未进页缓存、机器繁忙）一旦让构造超过 5 秒，worker 会**再建一个 Market**。麻烦在于
`Market.__init__` 把自己合成的限量版分组挂进了类别对象（`self.les_grp.category = ships`，而
`getGroupsByCategory()` 正是遍历 `cat.groups`），于是类别里会多出一份 `-1` 组；树拿到的那份若不含
船表，整组就从浏览器里消失。本机测试在 CPU 繁忙的两轮里各失手一次（该轮耗时 42.8s vs 正常 22s）。
手工并发验证：8 个线程同时直接 `Market()` 会造出 8 个实例，改走 `getInstance()` 只造 1 个。

修法：`_instanceLock` + 双重检查（`getInstance`），落败的线程等构造完成、拿到同一个实例。
配套的接口侧兜底见 §5.5（`group_ships` 按分组 id 回退 + 树按分组 id 去重、并把该组显式补进树），
即使将来又出现第二份分组，树也不会丢船、也不会出现重复行。

## 6. 已验证（2026-10-01，本机）

- 模拟全新克隆（删除 `eve.db` 与本地数据）后 `python -m web` 首启：自动建库成功
- HTTP：`/api/meta` 200、`/api/ships/tree` 200（真实数据）、`/` 200、
  `/assets/index-CXsZ08Eo.js` 200（141 KB）、`/api/docs` 200、
  `/img/icons/0` 200、`/img/renders/10006` 与 `@2x` 200
- `python -m pytest web/tests -q`：**184 passed, 1 warning**（含 §5.3 的 10 项、§5.4 的 5 项、§5.5 的 6 项）
- 稳定性（§5.7）：6 路 CPU 负载下连跑 2 轮 `pytest web/tests -q`，均 **184 passed、0 skip**
  （修复前同样的负载下会丢限量版分组：138.9s 那轮 2 skip，41.8s/42.8s 那两轮各 1–2 个失败）
- 前端：`npm ci && npm run build` 重建 `web/static`（node 22.22.1 + npm 9.2.0 + vite 6.4.3）；
  用原仓库源码重建的产物与线上 bundle **逐字节相同**（sha256 一致），`npm run typecheck` 零输出；
  公网取到的新 bundle 内含 `collapsedRaces`/`toggleRace`/`in-race`，CSS 内含 `.race`/`.shiprow.in-race`
- `/api/ships/tree` 的四层结构（公网 HTTPS 与本地 8091 一致）：舰船 → 巡洋舰 → 6 个种族行
  （艾玛 8 / 加达里 8 / 盖伦特 8 / 米玛塔尔 7 / 三神裔 2 / 其他 1）；舰船 → 攻击战列巡洋舰 → 艾玛 →
  **预言级**；舰船 → 限量版舰船（id `-1`，一行）→ 7 个种族行（盖伦特 13 / 艾玛 11 / 加达里 10 /
  米玛塔尔 8 / 其他 5 / 三神裔 2 / ORE 1），合计 50 艘；英文 `Limited Issue Ships` 残留 0 处；
  组名与组 id 均唯一
- 结构：入口 AST 闭包 366 个 `.py`、零未解析导入；与原仓库 `diff -rq` 的内容差异集中在
  §5.2–§5.7 所涉文件（`db_update.py`、`pyfa_compat/wx_headless.py`、`service/market.py`、
  `web/{config,deps,main,__main__}.py`、`web/api/ships.py`、`web/tests/`、`web/frontend/src/`）
  与重建后的 `web/static`，其余仅部署侧文件（`eve.db`、`web.yml`、`__pycache__`）

## 7. 已知限制

- **子路径部署的前半段仍需反代配合**：服务端已支持 `PYFA_WEB_ROOT_PATH`（见 §5.2），但前端
  bundle 里的 `/assets/*`、`/api/*`、`/img/*` 是**构建期写死**的，挂到子路径时要么用 Vite `base`
  重新构建，要么在反代层改写这三类前缀。本机现在有 Node（§5.6），但仍继续走反代改写：改 `base`
  会同时影响前端路由与静态资源路径，收益只是一条可省的配置，风险却覆盖整站，故不动（见 §8）。
  `/api/docs` 的「Try it out」在子路径下会把请求发到域名根，改用 `/api/openapi.json` 或 curl。
  同类还有**登出后的硬跳转**：bundle 里是 `async logout(){await ae.logout(),window.location.href="/"}`，
  这个裸 `"/"` 也是构建期写死的，在子路径部署下会把用户送到域名根（本机 `location = /` 又 301 到
  `/SnowLuma/`，于是登出后跑到别的应用去了）；线上用一条精确的 `sub_filter` 改写成
  `window.location.href="/eveskillplanner/"` 覆盖（已核对：bundle 里同形片段仅此一处，
  `encodeURIComponent(x||"/")` 之类兜底常量不受影响）。
  注意**改写发生在反代层、磁盘文件没变**：若把浏览器带来的 `If-None-Match` / `If-Modified-Since`
  透传给上游，上游会答 304、浏览器继续用改写前的旧缓存（表现为“修了也不生效”，必须硬刷新），
  所以该 location 会丢掉这两个条件头（详见 §8）。
- **登录 state 存在进程内存里**：`LoginStateStore` 是单进程字典（TTL 900 s），因此服务必须以**单进程**运行
  （当前 systemd 未加 `--workers`，实际只有 1 个进程）。将来若改成多 worker，回调可能落到另一个进程而报
  `loginExpired`；重启也会丢掉进行中的登录（重新点一次登录即可）。
- 服务端 `language` 是全局设置，切换需要重启（eve.db 的语言列在模型导入时绑定；引擎自身文案也按它
  挑 `.po` 目录，见 §5.4）。
- `gui/` 只是 import 依赖；桌面版（wxPython）不在本目录范围内。
- `staticdata/` 缺失且没有 `eve.db` 时，引擎在启动阶段会直接报错（无游戏数据可用）。
- `/img/{kind}/{id}` 只认 `imgs/{icons,renders,gui}` 下真实存在的 `{id}@1x.png`/`{id}.png`，
  不存在的图标 id 返回 404（属正常行为）。

## 8. 线上部署：https://eve-tools.xyz/eveskillplanner/

> **2026-10-02 路径迁移**：站点前缀由 `/eveskillplanner/` 改为 `/AssemblyPlanning/`（nginx 的
> `location`、内部 `rewrite`/`proxy_redirect`/`sub_filter` 与 `web.yml` 的 `public_url`/`root_path`
> 同步改名，SSO 回调改为 `…/AssemblyPlanning/api/auth/callback`）。本节其余内容保留迁移前的原文。
>
> **2026-10-02 起自动部署**：本目录在服务器上已是 git 克隆，push 到 `master` 即自动更新（见 §9）。

2026-10-01 起本目录即该地址的后端，取代原 `eve-skill-planner`（Flask + Vue，`127.0.0.1:8090`）。

| 项 | 值 |
| --- | --- |
| 服务 | `pyfa-web.service`（enabled、`Restart=always`），`ExecStart=/opt/pyfa-web/.venv/bin/python -m web` |
| 监听 | `127.0.0.1:8091`（仅回环，对外一律经 nginx；`ProtectSystem=full` 等沙箱已开） |
| 运行用户 | `pyfaweb`（系统用户，home = `/var/lib/pyfa-web`）；`/opt/pyfa-web` 属主即该用户 |
| 数据目录 | `/var/lib/pyfa-web`：`app.db`（账号库）、`users/<id>/saveddata.db`、`system/`、`session.key` |
| 配置 | `/opt/pyfa-web/web.yml`（非敏感，640 root:pyfaweb）＋ `/opt/pyfa-web/web.env`（SSO 密钥，640 root:pyfaweb） |
| nginx | `/etc/nginx/sites-available/snowluma`：`location ^~ /eveskillplanner/api/`（strip 前缀、关缓冲、不改写、`proxy_redirect` 修根路径跳转、SSE 超时 3600s）＋ `location ^~ /eveskillplanner/`（strip 前缀 + `sub_filter` 改写 `/assets/`、`/api/`、`/img/`）。两段的 `proxy_redirect` 都是**幂等**两条：`~^/(eveskillplanner/)+(.*)$ /eveskillplanner/$2`（已带前缀，重复的收敛为一次）＋ `~^/(?!eveskillplanner/)(.*)$ /eveskillplanner/$1`（纯根相对补前缀）。前端登录按钮把 `window.location.pathname` 当 `next=` 传回，所以成功回调的 Location 本身就是 `/eveskillplanner/...`，无脑补前缀会滚成 `/eveskillplanner/eveskillplanner/...`；SPA 段另有 4 条 `sub_filter`：`/assets/`、`/api/`、`/img/` 三类前缀，外加把 bundle 里登出的 `window.location.href="/"` 改成 `"/eveskillplanner/"`（否则登出后落到域名根 → 301 → `/SnowLuma/`）；并把 `If-None-Match`/`If-Modified-Since` 置空不给上游，避免上游 304 让浏览器继续用改写前的旧缓存 |
| SSO | 沿用原应用登记的同一个 CCP 应用：回调 URL 恰好是 `https://eve-tools.xyz/eveskillplanner/api/auth/callback`，与 pyfa-web 默认 `callback_path` 一致，**无需改开发者门户** |
| 语言 | `zh_CN`（物品名/组名走 eve.db 中文列，引擎自身文案走 `locale/zh_CN/lang.po`，界面默认中文；见 §5.4） |

运维命令：

```bash
systemctl status pyfa-web          # 或 restart / stop
journalctl -u pyfa-web -f          # 引擎启动、SSO 登录、SSE 断开等日志
cd /opt/pyfa-web && .venv/bin/python -c \
  "from web.config import load_config; print(load_config().callback_url())"   # 核对回调地址
```

原部署的移除与回滚：

- 已移除：`eve-skill-planner.service` 停用并移出（`/opt/backups/eve-skill-planner.service.removed`）、
  用户 `evespl` 删除、`/opt/eve-skill-planner`（57 MB）与 `/var/lib/eve-skill-planner` 删除。
- 归档：`/opt/backups/eve-skill-planner-opt-20261001.tar.gz`（17 MB）、
  `/opt/backups/eve-skill-planner-varlib-20261001.tar.gz`、
  改动前的 nginx 配置 `/opt/backups/snowluma.nginx.pre-pyfaweb.20261001.bak`。
- 回滚路由：把 nginx 两个 `/eveskillplanner/` location 的 `8091` 改回 `8090` 并 `nginx -s reload`；
  恢复旧应用则解包上面两个 tar、把 unit 移回 `/etc/systemd/system/`、
  `systemctl daemon-reload && systemctl enable --now eve-skill-planner`。

上线实测（2026-10-01，走公网 HTTPS）：

- `/eveskillplanner/` 200（HTML 已带前缀）、`/eveskillplanner` 301 → 带斜杠版本
- `/assets/index-BqOryJcr.js` 200、`.../index-BM9PFjtv.css` 200；JS 里裸 `/api/` 残留 **0 处**
- `/api/meta` 200（`sso.configured=true`、`language=zh_CN`、`gamedata.build=3532181`）、
  `/api/ships/tree` 200、`/api/openapi.json` 200、`/api/docs` 200（spec 路径含前缀）
- `/img/icons/0`、`/img/renders/10006`、`/img/renders/10006@2x` 均 200
- `/api/commands`、`/api/events` 401（未登录，符合预期）；未知路径 SPA 兜底 200
- 登录跳转 303 → `login.eveonline.com`，`redirect_uri` 与门户登记逐字符一致
- 同域其他服务未受影响：`/` 仍 301 → `/SnowLuma/`、`/SnowLuma/` 200、eve-isk 的 `/callback/`、`/login` 正常
- `web/tests`：**173 passed**（含 §5.3 新增的 10 项）

### 登录（SSO）链路核验（2026-10-01，实测）

浏览器以外能验的都验了（探针脚本 `/tmp/ssocheck.sh`，另外用真实凭据直接压过 CCP 的 token 端点）：

| 环节 | 实测结果 |
| --- | --- |
| `GET /api/auth/login` | 303 → `login.eveonline.com/v2/oauth/authorize`，含 `response_type=code`、`client_id`、`redirect_uri=https://eve-tools.xyz/eveskillplanner/api/auth/callback`、三个 scope、`state`、PKCE `code_challenge_method=S256` |
| 授权端点 | 302 → CCP 登录页（`ReturnUrl` 回指同一 URL），未被拒（无 invalid_client / invalid_redirect_uri） |
| 回调：缺 code / 未知 state / 重复 state | 303 → `/eveskillplanner/?sso_error=loginExpired`（`state` 一次性消费，重放被拒） |
| 回调：`error=access_denied` | 303 → `?sso_error=loginCancelled`；其它 `error` → `?sso_error=loginFailed` |
| 回调：真 state + 假 code | 303 → `?sso_error=loginFailed`（EVE 以 HTTP 500 拒掉假 code，见下） |
| OpenID 元数据 / JWKS | `issuer=https://login.eveonline.com`、`jwks_uri=…/oauth/jwks`，返回 RSA/RS256 + EC/ES256 两把键，可用于 RS256 的 1 把（验签路径可用） |
| 凭据是否有效 | 同一 client 用 `grant_type=refresh_token`（假 token）→ **JSON 400 `invalid_grant: Invalid refresh token. Unable to migrate grant.`**，说明 client_id/secret 已被 CCP 承认并进入 grant 处理；未知 client 的答复是 `Grant type authorization_code is not supported.` |
| 未登录接口 | `/api/auth/me` → `{"authenticated":false}`；`/api/commands`、`/api/events` → 401 |
| 登出 | `POST /api/auth/logout` → 303 到 `/eveskillplanner/` 并清 `pyfa_session`（会话 cookie：`HttpOnly`、`SameSite=lax`、`Secure`、`Path=/`） |
| 前端 | bundle 里登录入口为 `/eveskillplanner/api/auth/login`，且含 `sso_error` 与四个错误码（loginExpired / loginCancelled / loginFailed / ssoUnreachable），可渲染提示句 |

> **「假 code 换来 HTTP 500」不是本部署的问题**：CCP 的 token 端点在「客户端合法、授权码不存在」时返回的是 SSO 前端的
> HTML 页（`Internal Server Error … Error code: 526069474480f5fcf63b20e0271f56c3`），而不是标准的 `invalid_grant` JSON；
> 用错 secret 或未知 client 才得到 JSON 400。链路唯一未覆盖的一步就是真人登录本身（authorize → code → token → JWKS 验签 → 建会话）。

### 「登录成功了，页面却还是未登录」（2026-10-01 定位并修复）

现象：真人点「Sign in with EVE」并完成授权后，`journalctl -u pyfa-web` 里能看到
`web.api.auth: User chuxins1 (2124544250) signed in`，但回到站点仍是未登录状态（登录按钮还在）。
两个原因叠加：

1. **成功回调的重定向目标被加了两次前缀。** 前端登录按钮的 `next=` 取的是
   `window.location.pathname`（子路径部署下已经是 `/eveskillplanner/`），应用原样把它作为回调的
   `Location`；API 段原来的 `proxy_redirect ~^/(.*)$ /eveskillplanner/$1` 又无脑补一次前缀 →
   浏览器落到 `/eveskillplanner/eveskillplanner/`（在那页再点一次登录就变三重前缀），该路径不匹配
   任何前端路由，页面也不会再去拉接口。已改为上文那对**幂等**规则；同样的规则也补进了 SPA 那个
   location（它原先没有 `proxy_redirect`，`/?error=…` 兜底转发会被送到域名根，那是另一个应用）。
   排查提示：`nginx -s reload` 之后旧 worker 仍会接手若干新连接，改完立刻测可能看到旧行为。
2. **`root_path` 让会话 cookie 从不被解析**（见 §5.3）：即使浏览器落在正确的 `/eveskillplanner/`，
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

### 「Limited Issue Ships 显示英文、限量版舰船混成一堆」（2026-10-01 定位并修复）

两个互不相干的问题叠在同一个分组上：

1. **分组名是 pyfa 自己写的字符串，而垫片的翻译目录其实是恒等映射**（只找编译好的 `lang.mo`，
   本仓库只有 `.po` 源文件）→ 界面永远显示英文。修法见 §5.4。
2. **该分组 50 艘舰船种族各异，却平铺成一行**（pyfa 把限量版舰船全塞进 `les_grp`）→ 看不出谁是谁。
   修法见 §5.5。

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
| 回归 | `web/tests` **184 passed**（§5.4 +5、§5.5 +6）；`npm run typecheck` 通过 |

> 种族这一层由前端渲染、数据由接口给（每艘船带 `race`），所以「哪个分组该分层」不写在反代或数据里，
> 只写在 `ShipBrowser.vue`/`stores/browser.ts` 的一处判断里（跨两族以上才分层）。
> 仍留在反代的那几条 `sub_filter` 前缀改写（§7）是有意保留的：Vite `base` 未改，重建后它们照旧生效。


## 9. 自动部署（push 即部署 + 兜底轮询）

2026-10-02 起本目录在服务器上是 **git 克隆**（`origin=https://github.com/chuxins/pyfa-web.git`，分支 `master`），
push 到 `master` 后由 GitHub Actions 经 SSH 以 `deploy` 用户执行 `deploy/auto-update.sh`；
服务器上的 `pyfa-web-update.timer`（每 2 分钟）作为兜底轮询，防 Actions 链路偶发失败。

| 项 | 值 |
| --- | --- |
| 仓库侧 | `deploy/auto-update.sh`、`deploy/pyfa-web.service` + `deploy/pyfa-web.service.d/memory.conf`、`deploy/pyfa-web-update.service`、`deploy/pyfa-web-update.timer`、`.github/workflows/deploy.yml`、`.gitattributes`（部署文件统一 LF） |
| 服务器侧 | 部署用户 `deploy`（附加组 `pyfaweb`）；`/etc/sudoers.d/pyfaweb-deploy`（NOPASSWD 只放 `systemctl restart/status pyfa-web`）；`/etc/gitconfig` 的 `safe.directory=/opt/pyfa-web`；仓库 `core.sharedRepository=group` |
| 仓库可见性 | **公开仓库**，服务器用 https 匿名只读拉取，**不需要 Deploy Key** |
| Actions secrets | `SSH_HOST=8.156.88.102`、`SSH_USER=deploy`、`SSH_KEY`（对应公钥在 `/home/deploy/.ssh/authorized_keys`） |
| 触发 | `push` 到 `master`（也可在 Actions 页 `workflow_dispatch` 手动跑）；`pyfa-web-update.timer` 每 2 分钟兜底 |
| 受保护数据 | `web.yml`、`web.env`、`eve.db*`、`webdata/`、`saveddata/`、`session.key`、`logs/` 均在 `.gitignore` 内；脚本用 `git reset --hard`，**绝不**执行 `git clean` |
| 依赖更新 | 仅当 `pyproject.toml`/`uv.lock` 有变化时，把 `[project.dependencies]` + `[project.optional-dependencies].web` 的 pinned 清单装进 `/opt/pyfa-web/.venv`；**解析不出依赖就报错退出且不重启**，旧版本继续可用 |
| 健康检查 | `http://127.0.0.1:8091/api/meta`，30 次 × 2 秒内拿到 200 才算成功，否则打印服务日志尾部并失败 |

### 9.1 服务器一次性配置

```bash
# 1) 部署用户：公钥即 Actions 用的那把私钥对应的公钥
useradd -m -s /bin/bash deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
cat /root/.ssh/github_actions.pub >> /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys

# 2) 组权限：deploy 靠附加组 pyfaweb + 目录 g+w 写仓库
usermod -aG pyfaweb deploy
chown -R pyfaweb:pyfaweb /opt/pyfa-web
chown root:pyfaweb /opt/pyfa-web/web.yml /opt/pyfa-web/web.env   # 配置/密钥不进组可写
chmod -R g+w /opt/pyfa-web
find /opt/pyfa-web -type d -exec chmod g+s {} +                     # setgid：deploy 新建文件自动归组 pyfaweb
chmod 640 /opt/pyfa-web/web.yml /opt/pyfa-web/web.env
git -C /opt/pyfa-web config core.sharedRepository group
git config --system --add safe.directory /opt/pyfa-web

# 3) sudoers（只给重启/查状态，NOPASSWD）
printf 'deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart pyfa-web, /usr/bin/systemctl status pyfa-web\n' \
  > /etc/sudoers.d/pyfaweb-deploy
chmod 440 /etc/sudoers.d/pyfaweb-deploy && visudo -cf /etc/sudoers.d/pyfaweb-deploy

# 4) 兜底定时器
install -m 644 /opt/pyfa-web/deploy/pyfa-web-update.service /etc/systemd/system/
install -m 644 /opt/pyfa-web/deploy/pyfa-web-update.timer   /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now pyfa-web-update.timer

# 5) 排查要点
#    - sudoers 按「命令+参数」精确匹配：脚本里必须写成 sudo -n /usr/bin/systemctl restart pyfa-web，
#      多带 --no-pager 之类参数就会匹配失败；
#    - 目录要加 setgid（find -type d -exec chmod g+s）：否则 deploy 用 git 新建/覆盖的文件
#      会变成 deploy:deploy，与仓库属主 pyfaweb 不一致（功能上仍可用，但组语义混乱）；
#      加 setgid 后新文件是 deploy:pyfaweb，组 pyfaweb 始终有权限；
#    - deploy 的私钥不要留在服务器上（否则拿到 deploy 就等于拿到 root）；
#    - 首次可手工跑一次：sudo -u deploy bash /opt/pyfa-web/deploy/auto-update.sh（无更新会打印「已是最新」）。
```

### 9.2 部署参数（环境变量覆盖）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PYFAWEB_APP_DIR` | `/opt/pyfa-web` | 部署目录 |
| `PYFAWEB_APP_USER` | `pyfaweb` | 服务用户（脚本以 root 跑时降权到它，保证新文件属主一致） |
| `PYFAWEB_BRANCH` | `master` | 跟踪分支 |
| `PYFAWEB_SERVICE` | `pyfa-web` | 重启的 unit 名 |
| `PYFAWEB_HEALTH_URL` | `http://127.0.0.1:8091/api/meta` | 健康检查地址；端口与 `web.yml` 不一致时改这里 |
| `PYFAWEB_HEALTH_TRIES` | `30` | 健康检查重试次数 |
| `PYFAWEB_HEALTH_INTERVAL` | `2` | 每次重试间隔（秒） |

覆盖方式：在 `deploy/pyfa-web-update.service` 里加 `Environment=`（文件里留有注释示例），
或在 Actions 里导出后执行脚本。改动 unit 后记得 `systemctl daemon-reload`。

### 9.3 运维命令

```bash
sudo -u deploy bash /opt/pyfa-web/deploy/auto-update.sh   # 手动跑一次更新
systemctl list-timers pyfa-web-update.timer --no-pager    # 兜底定时器
journalctl -u pyfa-web-update.service -n 50               # 定时器触发的更新日志
journalctl -u pyfa-web -n 50                              # 服务自身日志
gh run list --repo chuxins/pyfa-web --limit 5             # Actions 侧执行记录
git -C /opt/pyfa-web log --oneline -3                     # 服务器当前版本
```

### 9.4 回滚

```bash
systemctl disable --now pyfa-web-update.timer             # 先停兜底轮询
# （同时在 GitHub 上禁用/删除 deploy workflow，避免推送后又被自动更新）
sudo -u deploy git -C /opt/pyfa-web fetch origin master
sudo -u deploy git -C /opt/pyfa-web reset --hard <commit> # 例如上一个已知可用提交
sudo systemctl restart pyfa-web
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8091/api/meta   # 期望 200
```

`web.yml`/`web.env`/数据库等运行数据不在版本控制内，回滚代码不影响它们；
如果回滚跨越了依赖变更，还需要手工把 `.venv` 调整回对应版本
（`/opt/pyfa-web/.venv/bin/python -m pip install <pinned 列表>`）。

### 9.5 首次验证结果（2026-10-02）

| 检查 | 结果 |
| --- | --- |
| 一次性配置 | `deploy` 建好（uid 1000，附加组 `pyfaweb`）；`/etc/sudoers.d/pyfaweb-deploy` `visudo -cf` 解析通过；`/etc/gitconfig` 的 `safe.directory=/opt/pyfa-web` 生效（`sudo -u deploy git status` 正常）；目录 2775（setgid）、`core.sharedRepository=group` |
| 兜底定时器 | `pyfa-web-update.timer` `enabled`+`active`，首次自触发即 `[auto-update] 已是最新（e2a4450f162f），无需更新`，`status=0/SUCCESS` |
| sudoers 边界 | `sudo -u deploy sudo -n /usr/bin/systemctl restart pyfa-web` 成功；同一用户带额外参数（如 `status … --no-pager`）会被拒绝 —— sudoers 按「命令+参数」精确匹配，脚本里因此不附加参数 |
| SSH 通道 | 用 Actions 那把密钥以 `deploy` 登录成功（`id -un` = deploy，`groups` = deploy pyfaweb） |
| push 即部署（Actions） | 提交 → `Deploy to server` 作业 16 秒内 `success`，日志：`[auto-update] 更新 e2a4450f162f -> 1a471274f558` → `HEAD is now at 1a47127 …` → `已重启 pyfa-web，等待健康检查通过` → `健康检查通过（第 2 次尝试，HTTP 200）` |
| 更新后状态 | 服务器 `git log` 与 `origin/master` 一致、`git status` 干净；`README` §9 存在；服务 `active`、`/api/meta` 200 |
| 权限 | 更新由 `deploy` 执行，文件组仍是 `pyfaweb`（目录 setgid 生效）、仓库属主 `pyfaweb` 可继续写；`web.yml`/`web.env` 仍为 `640 root:pyfaweb`，`git reset --hard` 未触碰（`.gitignore` 覆盖） |
| 幂等 | 无新提交时再跑脚本只打印「已是最新」，不重启服务 |

