# pyfa Web —— 独立抽取版运行栈

从 `/opt/pyfa` 抽取出来的 pyfa Web 服务栈，**可脱离原仓库独立运行**：`python -m web`
启动 FastAPI 服务，对外提供 pyfa 的装配计算引擎（eos）REST API，并直接托管已构建好的前端页面。

本文只讲**是什么 / 怎么跑 / 目录结构 / 已知限制**；改动史、验证记录、部署运维在 `docs/`（见 §6）。

## 1. 来源与版本

| 项 | 值 |
| --- | --- |
| 来源仓库 | `/opt/pyfa` |
| 分支 / 提交 | `master` / `c07d408490c0a85e24f2baea984e0f617bfd48f4` |
| pyfa 版本 | `v2.69.0`（`version.yml`）；web 版本 `0.1.0` |
| 抽取时间 | 2026-10-01 |
| 抽取方式 | 从 `web/__main__.py`、`web/main.py` 入口做 AST 导入闭包 → 366 个 `.py`，零未解析导入；再逐个 `diff -rq` 与原仓库比对一致；`compileall` 无错误 |
| 线上部署 | <https://eve-tools.xyz/AssemblyPlanning/>（2026-10-01 首次上线于 `/eveskillplanner/`，2026-10-02 迁到 `/AssemblyPlanning`；见 [docs/operations.md](docs/operations.md)） |

## 2. 目录内容

分三层：**上游 pyfa 引擎**（与 `/opt/pyfa` 同名同级，方便继续 `diff -rq`）、**本项目自己的 web 应用**、
**部署与运行期数据**（后者全部被 git 忽略）。

```
pyfa-web/
├─ eos/ gui/ graphs/ utils/ service/ staticdata/ imgs/ locale/   # 上游 pyfa 引擎（顶层路径不能改）
├─ config.py  db_update.py  version.yml  eve.db                  # 引擎路径约定：eve.db/version.yml
│                                                                #   必须与这些文件同级
├─ pyfa_compat/                                                  # 无头 wx 兼容层
├─ web/                                                          # FastAPI 应用（本项目）
│  ├─ __main__.py main.py config.py deps.py engine.py ...
│  ├─ api/  services/                                            # HTTP 层 / 应用服务层
│  ├─ frontend/                                                  # React 源码（npm run build →）
│  ├─ static/                                                    #   构建产物（已提交，直接伺服）
│  ├─ docs/  tests/
├─ deploy/                                                       # systemd / auto-update.sh
├─ docs/                                                         # 改动史、验证记录、部署运维（见 §6）
└─ webdata/ web.yml eve.db                                       # 运行期数据与配置（git 忽略）
```

| 路径 | 作用 | 必需 |
| --- | --- | --- |
| `web/` | FastAPI 应用：`__main__.py` 入口、`api/`、`services/`、`auth.py`、`engine.py`、`userdata.py`、`admin.py`、`config.py`（服务端配置，别与仓库根的 pyfa `config.py` 混淆）、`docs/`、`tests/` | 是 |
| `web/frontend/` | React + Vite 前端源码（当前界面），`npm run build` 输出到 `web/static/` | 是 |
| `web/static/` | 前端**构建产物**（已提交，部署时直接伺服；`web/config.py` 的 `frontend_dist`） | 是 |
| `pyfa_compat/` | 无头 wx 兼容层（服务端不需要 wxPython） | 是 |
| `eos/` | 装配计算引擎、数据模型、`eos/db` 数据库层 | 是 |
| `service/` | pyfa 业务服务层（fit/设置/翻译/市场等），**不是** web 层，见 `web/services/` | 是 |
| `config.py`、`db_update.py` | pyfa 配置与 `eve.db` 构建入口 | 是 |
| `gui/`、`graphs/`、`utils/` | 被上层 import 依赖（不含桌面 UI 运行所需） | 是（import 依赖） |
| `staticdata/` | EVE 静态数据，构建 `eve.db` 的唯一数据源 | 是 |
| `imgs/` | 图标与舰船渲染图，`/img/*` 路由的数据源 | 是 |
| `locale/` | 翻译资源 | 是 |
| `deploy/` | 服务器侧部署资产：systemd unit/timer、`auto-update.sh`、渲染图回填脚本 | 部署用 |
| `docs/` | 改动史（相对上游）、验证记录、部署运维手册；索引见 §6 | 文档 |
| `.github/workflows/` | push 到 `master` 即 SSH 触发服务器自动更新 | CI 用 |
| `version.yml`、`pyproject.toml`、`uv.lock`、`web.yml.example`、`Dockerfile`、`.dockerignore`、`compose.yml`、`LICENSE`、`.python-version` | 版本/依赖/配置/打包参考 | 是 |
| `eve.db` | 运行时生成的 SQLite 静态数据库（97 MB，18 张表，27808 条 `invtypes`）；**已预生成，可删**，首启会自动重建。位置由 `eos/config.py` 写死为 `eos/` 的上一级，**不能挪** | 否（自动生成） |
| `webdata/` | 运行期数据目录（`app.db`、每用户 `saveddata.db`、日志、`session.key`），默认 `DATA_DIR`，已被 git 忽略 | 否（自动生成） |
| `web.yml`、`web.env` | 本机/生产部署配置（含 EVE SSO 密钥），从 `web.yml.example` 生成，已被 git 忽略 | 部署用 |

未包含：仓库根 `tests/`（与 web 无关）、`dist_assets/`、`pyfa.spec`（桌面打包用）。

## 3. 依赖与运行

- Python：3.14（见 `.python-version`）
- 依赖 pin：`pyproject.toml` 的 `dependencies` + 可选组 `web`；完整锁在 `uv.lock`
- **wxPython 不在默认组里**：服务端走 `pyfa_compat/` 的无头兼容层，`uv sync --group web` 不会装它；
  桌面版要显式 `uv sync --group wx-source`（Linux 二进制轮子用 `--group wx-binary`）。

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

## 5. 已知限制

- **子路径部署靠构建期的 Vite `base`，不是反代改写**：bundle 里的 `/assets/*`、`/api/*`、`/img/*`、
  `/images/*`、`/fonts/*` 在构建时就带上了前缀（`PYFA_BASE`，默认 `/AssemblyPlanning/`，见
  [docs/operations.md](docs/operations.md) §1.1），nginx 只 strip 前缀。**挂到别的子路径、或部署在域名根时，
  必须用对应的 `PYFA_BASE` 重建 `web/static`**（`PYFA_BASE=/ npm run build`），否则静态资源与接口全 404。
  早期用 nginx `sub_filter` 改写 bundle 字符串的做法已废弃（既够不着运行期拼的地址，又会让 `ETag`/304 与改写后的内容失配）。
  `/api/docs` 的「Try it out」仍会把请求打到页面所在路径的根，子路径下改用 `/api/openapi.json` 或 curl。
- **服务端 `root_path` 与前端 `PYFA_BASE` 必须一致**：前者决定应用自己生成的 URL（`openapi.json`、
  占位页链接、SSO 回调），后者决定 bundle 里的静态资源与接口前缀（见 [changes.md](docs/changes.md) §2）。
- **登录 state 存在进程内存里**：`LoginStateStore` 是单进程字典（TTL 900 s），因此服务必须以**单进程**运行
  （当前 systemd 未加 `--workers`，实际只有 1 个进程）。将来若改成多 worker，回调可能落到另一个进程而报
  `loginExpired`；重启也会丢掉进行中的登录（重新点一次登录即可）。
- 服务端 `language` 是全局设置，切换需要重启（eve.db 的语言列在模型导入时绑定；引擎自身文案也按它
  挑 `.po` 目录，见 [changes.md](docs/changes.md) §4）。
- `gui/` 只是 import 依赖；桌面版（wxPython）不在本目录范围内。
- `staticdata/` 缺失且没有 `eve.db` 时，引擎在启动阶段会直接报错（无游戏数据可用）。
- `/img/{kind}/{id}` 只认 `imgs/{icons,renders,gui}` 下真实存在的 `{id}@1x.png`/`{id}.png`，
  不存在的图标 id 返回 404（属正常行为）。

## 6. 文档索引

| 文档 | 内容 |
| --- | --- |
| [docs/changes.md](docs/changes.md) | 本目录相对上游 `pyfa` 的 9 处改动（原因/做法/测试）+ 两个线上问题的定位记录 |
| [docs/operations.md](docs/operations.md) | 现网部署：服务器、systemd、nginx、自动部署（push 即部署 + 兜底轮询）、参数、命令、回滚、换机记录 |
| [docs/verification.md](docs/verification.md) | 本机与公网实测记录、SSO 链路核验 |
| [web/docs/web.md](web/docs/web.md) | 应用设计说明（英文，按模块讲 API 与取舍） |
| [web/docs/full-port-design.md](web/docs/full-port-design.md) | 全量移植设计（P1→P5）与落地状态 |
| [web/frontend/README.md](web/frontend/README.md) | React 前端源码说明 |
| [deploy/](deploy/) | systemd unit/timer、nginx 参考配置、`auto-update.sh`、备份与看门狗脚本 |

`eve.db`/`webdata/`/`web.yml` 等运行期文件不入库（见 [.gitignore](.gitignore)）。
