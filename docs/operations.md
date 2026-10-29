# 部署与运维

> **现网**：<https://eve-tools.xyz/AssemblyPlanning/> —— 服务器 `103.210.237.192`，`pyfa-web.service` 监听 `127.0.0.1:8091`，nginx 只 strip 子路径前缀（前缀由构建期 Vite `base` 补齐）。
>
> 索引：§1 当前服务器与换机记录 · §2 自动部署（含参数、命令、回滚）· §3 初次上线（2026-10-01，历史）

## 1. 2026-10-25 换机重建（103.210.237.192）—— 当前服务器

域名 `eve-tools.xyz` 在 10-25 之前已切到新机器 `103.210.237.192`，但 GitHub secrets 仍是
10-02 的旧值（指向已失联的 `8.156.88.102`），而那次失败又被 workflow 里 `ssh-keyscan … 2>/dev/null`
吞掉 —— 10-25 01:55 起连续 7 次部署全红、线上站空窗。本节记录在新机器上重建的完整状态。

| 项 | 值 |
| --- | --- |
| 主机 | `103.210.237.192`（Ubuntu 20.04.1，2 vCPU / 3.8 GB / 49 GB） |
| 系统访问 | `root` + `~/.ssh/eve-test.pem`（公钥已装 `/root/.ssh/authorized_keys`） |
| Python | 3.14.9（uv 装到共享目录 `/opt/uv-python`，venv 为 `/opt/pyfa-web/.venv`，owner `pyfaweb`） |
| 服务 | `pyfa-web.service`（`User=pyfaweb`，`127.0.0.1:8091`，`Restart=always`），`enabled` |
| 内存上限 | drop-in 提到 `MemoryHigh=1500M` / `MemoryMax=2600M`（见下"踩到的坑①"） |
| 配置 | `web.yml`：`data_dir=/var/lib/pyfa-web`、`port=8091`、`public_url=https://eve-tools.xyz/AssemblyPlanning`、`root_path=/AssemblyPlanning`、`language=zh_CN`；`web.env` 目前只有注释（SSO 见"待补"） |
| nginx | `/etc/nginx/sites-available/pyfa-web`：两段都只 strip 前缀（`/AssemblyPlanning/api/` 关缓冲、SSE 3600s；`/AssemblyPlanning/` 走 SPA fallback），**不再做任何 `sub_filter` 改写** —— 前缀已在构建期由 Vite `base` 补齐（见下"子路径"一条）；幂等 `proxy_redirect` 两条；`/` 302 到 `/AssemblyPlanning/` |
| 维护页 | 同上文件的 HTTPS `server{}`：`error_page 502 503 504 =503 /AssemblyPlanning/maintenance.html`（页本体 `web/static/maintenance.html` 由 nginx 直接读磁盘，不经 Python）、`proxy_connect_timeout 3s` / `proxy_send_timeout 15s`、该路径的 `location =`（`no-store` + `Retry-After: 30`）。备份依次在 `/root/pyfa-web.nginx.bak.*`（最新一次 2026-10-27 全套配置） |
| 证书 | certbot（`--nginx --redirect`），`eve-tools.xyz`，到期 2027-01-23，系统自带 `certbot.timer` 自动续期 |
| 兜底轮询 | `pyfa-web-update.timer`（2 分钟，`User=root`），带 CI 闸门（见下） |
| 备份 | `pyfa-web-backup.timer` 每日 04:30 → `deploy/backup.sh`：SQLite 在线备份 + tar 到 `/var/backups/pyfa-web`（600，保留 14 份） |
| 看门狗 | `pyfa-web-watchdog.timer` 每 5 分钟探 `api/meta`，连续 2 次失败重启服务；告警走 `/opt/pyfa-web/monitor.env` 的 `PYFAWEB_ALERT_URL`（未配置，现在只写 journal） |
| pypi | `/etc/pip.conf` 与 `/etc/uv/uv.toml` 指向清华源 —— 这台机器到 pypi.org 只有 **27 KB/s**，换源后约 1.1 MB/s |
| 实测 | `https://eve-tools.xyz/AssemblyPlanning/` 200、`api/meta` 200（`gamedata.build=3532181`、`language=zh_CN`）、`/` 302、HTTP 自动 301 到 HTTPS、证书链校验通过；`auto-update.sh` 手工跑一次打印"已是最新" |

**P0/P1 落地（2026-10-27）**：`deploy/nginx.conf` 已按新版铺到服务器并验证 ——
JS 由 gzip 传输（原 316 KB 明文）、`/assets/` 一年 `expires` 长缓存、入口 HTML 与
`sw.js` 不缓存、`client_max_body_size 16m`、安全响应头（nosniff / X-Frame-Options /
Referrer-Policy / Permissions-Policy / HSTS）经 `/etc/nginx/snippets/pyfa-web-headers.conf`
覆盖到每个 location（`add_header` 不继承的坑）、`listen 443 ssl http2` 实测
`http_version=2`。应用侧加了 `GZipMiddleware`（SSE 默认排除）与 `HEAD` 支持
（`curl -I` 之前是 405）。CI 见 `.github/workflows/ci.yml`（后端全量 pytest + ruff +
前端构建），`deploy.yml` 改挂 `workflow_run`，服务器定时器另有自己的 CI 闸门
（读 GitHub 的 check-runs，见 `deploy/auto-update.sh`；用 python 解析，忽略 deploy 作业）。

**踩到的坑与修法**

1. **首次建库被 cgroup 打死**：`memory.conf` 的旧值 `MemoryMax=1200M` 不够 —— 从 `staticdata/`
   建 `eve.db` 的峰值超过 1.2 GB，于是 `Restart=always` 把服务拖进「建库 → OOM KILL → 重启」死循环
   （实测连挂 21 次，`eve.db` 永远停在 164 KB）。已把 drop-in 提到 1.5 G 软线 / 2.6 G 硬线；
   另外可先手工把库建好再起服务（`python -m web` 跑一次到 `/api/meta` 200 即可）。
2. **uv 的 Python 不能放进 `/root`**：默认装到 `/root/.local/share/uv/python`，`pyfaweb` 读不到，
   影子解释器一执行就 `Permission denied`。改用 `UV_PYTHON_INSTALL_DIR=/opt/uv-python`。
3. **workflow 静默失败**：`ssh-keyscan` 在主机不回 banner 时只是超时退出，配上 `2>/dev/null` 与
   `bash -e`，整步无任何输出地失败。现在直接交给 `ssh -o StrictHostKeyChecking=accept-new`，并补了
   "secret 缺失就报错"的前置检查与 `LogLevel=VERBOSE`。
4. **nginx reload 后旧 worker 仍在服务**：改完立即测可能看到旧行为（`/AssemblyPlanning/` 仍 404），
   等几秒或 `systemctl restart nginx` 再验。

**维护页实测（2026-10-26）**：`systemctl stop pyfa-web` 后请求
`https://eve-tools.xyz/AssemblyPlanning/` 返回 **503 + 维护页正文**（6633 B，含
`Under maintenance`），`/AssemblyPlanning/maintenance.html` 直接 200 且带
`Cache-Control: no-store`、`Retry-After: 30`，SSE `/api/events` 仍 200；服务恢复后一切 200。
前端还有一层兜底：`web/frontend/public/sw.js` 注册的 Service Worker 只缓存维护页，
导航拿到 502/503/504 时用它顶上（即使 nginx 没配也生效，见 `web/docs/web.md`）。

**EVE SSO（2026-10-25 已恢复）**。旧机器的 `/opt/pyfa-web/web.env` 随机器丢了，换机后重新填好了同一套
CCP 应用凭据（回调登记 `https://eve-tools.xyz/AssemblyPlanning/api/auth/callback`）。密钥只在服务器上，
不进版本库：

```bash
# /opt/pyfa-web/web.env（640 root:pyfaweb），环境变量优先于 web.yml，所以 web.yml 里那两行留空
PYFA_WEB_SSO_CLIENT_ID=...
PYFA_WEB_SSO_CLIENT_SECRET=...
# 改完：systemctl restart pyfa-web
```

核验（2026-10-25，服务器侧实测）：

| 检查 | 结果 |
| --- | --- |
| `/api/meta` | `sso.configured=true`、`server=Tranquility`、`devBypass=false` |
| 算出的回调 | `https://eve-tools.xyz/AssemblyPlanning/api/auth/callback`，与登记值逐字符一致 |
| `GET /api/auth/login` | 303 → `login.eveonline.com/v2/oauth/authorize`，含 `response_type=code`、`client_id`、该回调、四个 scope（含 `esi-clones.read_implants.v1`）、32 字节 `state`、PKCE `S256`（43 字符 challenge） |
| CCP authorize 端点 | 302 → 账号登录页（`/account/logon?ReturnUrl=…`），未被拒（无 `invalid_client` / `invalid_redirect_uri`） |
| 凭据有效性 | 用假 `refresh_token` 打 token 端点 → `HTTP 400 {"error":"invalid_grant"}`（若是错 secret 会是 `invalid_client`），说明 client 已被 CCP 承认 |
| 回调分支（经 nginx） | 无 code → 303 `…/AssemblyPlanning/?sso_error=loginExpired`；`error=access_denied` → `?sso_error=loginCancelled`；错 state → `loginExpired` —— 都回到**单层**子路径，`proxy_redirect` 没有滚雪球 |
| 未登录 | `/api/auth/me` → `{"authenticated":false}`；游客可正常浏览/装配 |

未覆盖：真人登录那一步（authorize → code → token → JWKS 验签 → 建会话）需要浏览器里输 EVE 账号，
无法在服务器侧代做；失败时看 `journalctl -u pyfa-web -f`（日志不打印 token），页面会带 `?sso_error=<code>`。

### 1.1 子路径部署改为构建期补齐（2026-10-25）

换机后浏览器控制台暴露了老做法的破绽：`sub_filter` 只认得 `"/assets/`、`"/api/`、`"/img/` 三种
**双引号**形态，而 React 版里有几处它够不着 —— API 基址是运行期拼的、图标走
`import.meta.env.BASE_URL`、字体在 CSS 里是 `url(/fonts/…)`、`/img/icons/0@1x.png` 写在
`index.html`。结果这些请求全落到域名根（`/api/fits` 404、`/fonts/*.woff2` 404、
`/images/ui/*.png` 404）。改写 JS 字符串本身也是坏做法：既脆，又会让 `ETag`/304 与改写后的内容失配。

现在改成**构建期**解决，反代只负责 strip 前缀：

- `web/frontend/vite.config.ts`：`base = process.env.PYFA_BASE ?? "/AssemblyPlanning/"`，与
  `PYFA_WEB_ROOT_PATH` 一致；开发服务器把 `<base>/api`、`<base>/img` 前缀去掉再转给 `:8100`。
- `web/frontend/src/api.ts`：新增 `apiUrl()`，`request()`、`requestFile()`、`imageUrl()` 全部经过它；
  `TopBar`/`LoginPrompt` 的登录链接、`EventSource` 的 `/api/events`、登出后的
  `window.location.href` 也都用它 / 用 `import.meta.env.BASE_URL`。
- `web/frontend/index.html`：favicon 用 `%BASE_URL%img/icons/0@1x.png`，由 Vite 展开。
- `web/static` 重新构建：产物里的 `/assets/`、`/api/`、`/img/`、`/images/`、`/fonts/` 都已带前缀。
- nginx 相应去掉全部 `sub_filter` 与 `If-None-Match`/`If-Modified-Since` 的置空（不再需要），
  只保留 strip 前缀、SSE 参数与两条幂等 `proxy_redirect`。

部署在域名根时用 `PYFA_BASE=/ npm run build` 重建即可，反代不需要改动。

## 2. 自动部署（push 即部署 + 兜底轮询）

2026-10-02 起本目录在服务器上是 **git 克隆**（`origin=https://github.com/chuxins/pyfa-web.git`，分支 `master`），
push 到 `master` 后由 GitHub Actions 经 SSH 以 `deploy` 用户执行 `deploy/auto-update.sh`；
服务器上的 `pyfa-web-update.timer`（每 2 分钟）作为兜底轮询，防 Actions 链路偶发失败。

| 项 | 值 |
| --- | --- |
| 仓库侧 | `deploy/auto-update.sh`、`deploy/pyfa-web.service` + `deploy/pyfa-web.service.d/memory.conf`、`deploy/pyfa-web-update.service`、`deploy/pyfa-web-update.timer`、`.github/workflows/deploy.yml`、`.gitattributes`（部署文件统一 LF） |
| 服务器侧 | **2026-10-25 换机后**：SSH 与部署都用 `root`，脚本内部 `runuser` 降权到 `pyfaweb` 跑 git，因此不再需要 `deploy` 用户与 `/etc/sudoers.d/pyfaweb-deploy`（旧机器那套保留在本节末尾的 §2.1 作为历史）；仍需 `/etc/gitconfig` 的 `safe.directory=/opt/pyfa-web`（root 直接查仓库时用） |
| 仓库可见性 | **公开仓库**，服务器用 https 匿名只读拉取，**不需要 Deploy Key** |
| Actions secrets | `SSH_HOST=103.210.237.192`、`SSH_USER=root`、`SSH_KEY`（2026-10-25 换机时更新；对应公钥在服务器 `/root/.ssh/authorized_keys`，见 §1） |
| 触发 | `push` 到 `master`（也可在 Actions 页 `workflow_dispatch` 手动跑）；`pyfa-web-update.timer` 每 2 分钟兜底 |
| 并发 | 两种触发各跑一次脚本可能撞在一起：脚本在 `/run/lock/pyfa-web-update.lock` 上取 `flock` 串行化，后到的排队（跑完再判断多半就是「已是最新」）；锁文件打不开时不阻塞部署 |
| 受保护数据 | `web.yml`、`web.env`、`eve.db*`、`webdata/`、`saveddata/`、`session.key`、`logs/` 均在 `.gitignore` 内；脚本用 `git reset --hard`，**绝不**执行 `git clean` |
| 依赖更新 | 仅当 `pyproject.toml`/`uv.lock` 有变化时，把 `[project.dependencies]` + `[project.optional-dependencies].web` 的 pinned 清单装进 `/opt/pyfa-web/.venv`；**解析不出依赖就报错退出且不重启**，旧版本继续可用 |
| 健康检查 | `http://127.0.0.1:8091/api/meta`，30 次 × 2 秒内拿到 200 才算成功，否则打印服务日志尾部并失败 |

### 2.1 服务器一次性配置

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
#    - 别在仓库里用 root 直接跑 git：root 建的文件按普通 umask（644）落盘，之后 deploy 会被挡在
#      .git/FETCH_HEAD 上（error: cannot open '.git/FETCH_HEAD': Permission denied）。脚本已 umask 002、
#      并在 fetch 失败时打印修法（root 直接跑脚本时还会 chmod -R g+w .git 自动重试一次）；
#      日常排查请用 sudo -u deploy git -C /opt/pyfa-web …
#    - 首次可手工跑一次：sudo -u deploy bash /opt/pyfa-web/deploy/auto-update.sh（无更新会打印「已是最新」）。
```

### 2.2 部署参数（环境变量覆盖）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PYFAWEB_APP_DIR` | `/opt/pyfa-web` | 部署目录 |
| `PYFAWEB_APP_USER` | `pyfaweb` | 服务用户（脚本以 root 跑时降权到它，保证新文件属主一致） |
| `PYFAWEB_BRANCH` | `master` | 跟踪分支 |
| `PYFAWEB_SERVICE` | `pyfa-web` | 重启的 unit 名 |
| `PYFAWEB_HEALTH_URL` | `http://127.0.0.1:8091/api/meta` | 健康检查地址；端口与 `web.yml` 不一致时改这里 |
| `PYFAWEB_HEALTH_TRIES` | `30` | 健康检查重试次数 |
| `PYFAWEB_HEALTH_INTERVAL` | `2` | 每次重试间隔（秒） |
| `PYFAWEB_LOCK` | `/run/lock/pyfa-web-update.lock` | 并发锁文件（`flock`） |

覆盖方式：在 `deploy/pyfa-web-update.service` 里加 `Environment=`（文件里留有注释示例），
或在 Actions 里导出后执行脚本。改动 unit 后记得 `systemctl daemon-reload`。

### 2.3 运维命令

```bash
sudo -u deploy bash /opt/pyfa-web/deploy/auto-update.sh   # 手动跑一次更新
systemctl list-timers pyfa-web-update.timer --no-pager    # 兜底定时器
journalctl -u pyfa-web-update.service -n 50               # 定时器触发的更新日志
journalctl -u pyfa-web -n 50                              # 服务自身日志
gh run list --repo chuxins/pyfa-web --limit 5             # Actions 侧执行记录
git -C /opt/pyfa-web log --oneline -3                     # 服务器当前版本
```

### 2.4 回滚

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

### 2.5 首次验证结果（2026-10-02）

| 检查 | 结果 |
| --- | --- |
| 一次性配置 | `deploy` 建好（uid 1000，附加组 `pyfaweb`）；`/etc/sudoers.d/pyfaweb-deploy` `visudo -cf` 解析通过；`/etc/gitconfig` 的 `safe.directory=/opt/pyfa-web` 生效（`sudo -u deploy git status` 正常）；目录 2775（setgid）、`core.sharedRepository=group` |
| 兜底定时器 | `pyfa-web-update.timer` `enabled`+`active`，首次自触发即 `[auto-update] 已是最新（e2a4450f162f），无需更新`，`status=0/SUCCESS` |
| sudoers 边界 | `sudo -u deploy sudo -n /usr/bin/systemctl restart pyfa-web` 成功；同一用户带额外参数（如 `status … --no-pager`）会被拒绝 —— sudoers 按「命令+参数」精确匹配，脚本里因此不附加参数 |
| SSH 通道 | 用 Actions 那把密钥以 `deploy` 登录成功（`id -un` = deploy，`groups` = deploy pyfaweb） |
| push 即部署（Actions） | 提交 → `Deploy to server` 作业 16 秒内 `success`，日志：`[auto-update] 更新 e2a4450f162f -> 1a471274f558` → `HEAD is now at 1a47127 …` → `已重启 pyfa-web，等待健康检查通过` → `健康检查通过（第 2 次尝试，HTTP 200）` |
| 更新后状态 | 服务器 `git log` 与 `origin/master` 一致、`git status` 干净；`docs/operations.md` §2 存在；服务 `active`、`/api/meta` 200 |
| 权限 | 更新由 `deploy` 执行，文件组仍是 `pyfaweb`（目录 setgid 生效）、仓库属主 `pyfaweb` 可继续写；`web.yml`/`web.env` 仍为 `640 root:pyfaweb`，`git reset --hard` 未触碰（`.gitignore` 覆盖） |
| 幂等 | 无新提交时再跑脚本只打印「已是最新」，不重启服务 |
| 两种失败（各一次，均已排除） | ① **secrets 还没建就 push**：那次运行的环境变量全是空串，SSH 秒失败（`Process completed with exit code 1`）。后来 `gh secret set` 建好三个 secret 后 `workflow_dispatch` 复跑即成功 → **务必先设 secrets 再 push**；② 就是上面「踩过的坑」里那次 `FETCH_HEAD` 权限失败（exit 255）。此后 5 次运行（3 次 push + 2 次手动）全部 success |
| 连续上线 | 连续多次 `push` 各触发一次，日志形状固定为 `[auto-update] 更新 <旧> -> <新>` → `HEAD is now at …` → `已重启 pyfa-web，等待健康检查通过` → `健康检查通过（第 N 次尝试，HTTP 200）`（实测第 2~3 次尝试即通过，一次上线 16~20 秒）；没有新提交时用 `workflow_dispatch` 复跑得到「已是最新」 |
| 踩过的坑（已修） | 维护时**用 root 在仓库里跑过一次 git**，生成的 `.git/FETCH_HEAD` 是 `644 pyfaweb:pyfaweb`，部署用户 `deploy` 虽在组 `pyfaweb` 内也写不动 → 一次 Actions 失败（`error: cannot open '.git/FETCH_HEAD': Permission denied`）。修法：目录 setgid + 组可写（`chmod -R g+w`）+ 脚本 `umask 002`（`runuser` 分支再显式套一层，防 PAM 改回 022）+ fetch 失败提示修法（root 运行自动修正重试） |
| 落地权限 | `deploy` 经 git 新建/覆盖的文件为 `deploy:pyfaweb`（目录 setgid 继承），`auto-update.sh` 落地后仍是 `775`（保留可执行位）；`web.yml`/`web.env` 始终 `640 root:pyfaweb`，`reset --hard` 不触碰 |
| 并发 | 持锁 5 秒期间再跑脚本实测等待 5 秒（串行化生效）；把锁文件改成 `600` 使其打不开时脚本仍能正常完成（降级为无锁） |
| 服务 | 每次重启后 `systemctl is-active pyfa-web` = active、`/api/meta` = 200；`web/tests` 与线上页面不受部署流程影响 |

## 3. 初次上线（2026-10-01，站点前缀 `/eveskillplanner/`，历史）

> 2026-10-02 站点前缀迁到 `/AssemblyPlanning/`，同日起改为 push 即自动部署（见 §2），本节保留迁移前的记录。
> 当时的上线实测与 SSO 核验已拆到 [verification.md](verification.md) §2、§3；两个线上问题的定位过程在 [changes.md](changes.md) §10。

2026-10-01 起本目录即 `https://eve-tools.xyz/eveskillplanner/` 的后端，取代原 `eve-skill-planner`（Flask + Vue，`127.0.0.1:8090`）。

| 项 | 值 |
| --- | --- |
| 服务 | `pyfa-web.service`（enabled、`Restart=always`），`ExecStart=/opt/pyfa-web/.venv/bin/python -m web` |
| 监听 | `127.0.0.1:8091`（仅回环，对外一律经 nginx；`ProtectSystem=full` 等沙箱已开） |
| 运行用户 | `pyfaweb`（系统用户，home = `/var/lib/pyfa-web`）；`/opt/pyfa-web` 属主即该用户 |
| 数据目录 | `/var/lib/pyfa-web`：`app.db`（账号库）、`users/<id>/saveddata.db`、`system/`、`session.key` |
| 配置 | `/opt/pyfa-web/web.yml`（非敏感，640 root:pyfaweb）＋ `/opt/pyfa-web/web.env`（SSO 密钥，640 root:pyfaweb） |
| nginx | `/etc/nginx/sites-available/snowluma`：`location ^~ /eveskillplanner/api/`（strip 前缀、关缓冲、不改写、`proxy_redirect` 修根路径跳转、SSE 超时 3600s）＋ `location ^~ /eveskillplanner/`（strip 前缀 + `sub_filter` 改写 `/assets/`、`/api/`、`/img/`）。两段的 `proxy_redirect` 都是**幂等**两条：`~^/(eveskillplanner/)+(.*)$ /eveskillplanner/$2`（已带前缀，重复的收敛为一次）＋ `~^/(?!eveskillplanner/)(.*)$ /eveskillplanner/$1`（纯根相对补前缀）。前端登录按钮把 `window.location.pathname` 当 `next=` 传回，所以成功回调的 Location 本身就是 `/eveskillplanner/...`，无脑补前缀会滚成 `/eveskillplanner/eveskillplanner/...`；SPA 段另有 4 条 `sub_filter`：`/assets/`、`/api/`、`/img/` 三类前缀，外加把 bundle 里登出的 `window.location.href="/"` 改成 `"/eveskillplanner/"`（否则登出后落到域名根 → 301 → `/SnowLuma/`）；并把 `If-None-Match`/`If-Modified-Since` 置空不给上游，避免上游 304 让浏览器继续用改写前的旧缓存 |
| SSO | 沿用原应用登记的同一个 CCP 应用：回调 URL 恰好是 `https://eve-tools.xyz/eveskillplanner/api/auth/callback`，与 pyfa-web 默认 `callback_path` 一致，**无需改开发者门户** |
| 语言 | `zh_CN`（物品名/组名走 eve.db 中文列，引擎自身文案走 `locale/zh_CN/lang.po`，界面默认中文；见 [changes.md](changes.md) §4） |

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
