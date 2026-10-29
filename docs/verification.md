# 验证记录

本文件收集各次实测（本机 + 公网）。部署侧的现网状态与换机实测见 [operations.md](operations.md) §1。

## 1. 本机验证（2026-10-01）

- 模拟全新克隆（删除 `eve.db` 与本地数据）后 `python -m web` 首启：自动建库成功
- HTTP：`/api/meta` 200、`/api/ships/tree` 200（真实数据）、`/` 200、
  `/assets/index-CXsZ08Eo.js` 200（141 KB）、`/api/docs` 200、
  `/img/icons/0` 200、`/img/renders/10006` 与 `@2x` 200
- `python -m pytest web/tests -q`：**184 passed, 1 warning**（含 [changes.md](changes.md) §3 的 10 项、§4 的 5 项、§5 的 6 项）
- 稳定性（[changes.md](changes.md) §7）：6 路 CPU 负载下连跑 2 轮 `pytest web/tests -q`，均 **184 passed、0 skip**
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
  [changes.md](changes.md) §2–§7 所涉文件（`db_update.py`、`pyfa_compat/wx_headless.py`、`service/market.py`、
  `web/{config,deps,main,__main__}.py`、`web/api/ships.py`、`web/tests/`、`web/frontend/src/`）
  与重建后的 `web/static`，其余仅部署侧文件（`eve.db`、`web.yml`、`__pycache__`）

## 2. 公网上线实测（2026-10-01，走公网 HTTPS）

- `/eveskillplanner/` 200（HTML 已带前缀）、`/eveskillplanner` 301 → 带斜杠版本
- `/assets/index-BqOryJcr.js` 200、`.../index-BM9PFjtv.css` 200；JS 里裸 `/api/` 残留 **0 处**
- `/api/meta` 200（`sso.configured=true`、`language=zh_CN`、`gamedata.build=3532181`）、
  `/api/ships/tree` 200、`/api/openapi.json` 200、`/api/docs` 200（spec 路径含前缀）
- `/img/icons/0`、`/img/renders/10006`、`/img/renders/10006@2x` 均 200
- `/api/commands`、`/api/events` 401（未登录，符合预期）；未知路径 SPA 兜底 200
- 登录跳转 303 → `login.eveonline.com`，`redirect_uri` 与门户登记逐字符一致
- 同域其他服务未受影响：`/` 仍 301 → `/SnowLuma/`、`/SnowLuma/` 200、eve-isk 的 `/callback/`、`/login` 正常
- `web/tests`：**173 passed**（含 [changes.md](changes.md) §3 新增的 10 项）

## 3. 登录（SSO）链路核验（2026-10-01，实测）

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
| 未登录接口 | `/api/auth/me` → `{"authenticated":false}`；游客可读可写装配（共享 guest 库），`/api/commands`、`/api/events` 均可用；仅 `POST /api/esi/fittings/import`、`/api/esi/fittings/export` 需登录 → 401 |
| 登出 | `POST /api/auth/logout` → 303 到 `/eveskillplanner/` 并清 `pyfa_session`（会话 cookie：`HttpOnly`、`SameSite=lax`、`Secure`、`Path=/`） |
| 前端 | bundle 里登录入口为 `/eveskillplanner/api/auth/login`，且含 `sso_error` 与四个错误码（loginExpired / loginCancelled / loginFailed / ssoUnreachable），可渲染提示句 |

> **「假 code 换来 HTTP 500」不是本部署的问题**：CCP 的 token 端点在「客户端合法、授权码不存在」时返回的是 SSO 前端的
> HTML 页（`Internal Server Error … Error code: 526069474480f5fcf63b20e0271f56c3`），而不是标准的 `invalid_grant` JSON；
> 用错 secret 或未知 client 才得到 JSON 400。链路唯一未覆盖的一步就是真人登录本身（authorize → code → token → JWKS 验签 → 建会话）。
