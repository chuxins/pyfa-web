#!/usr/bin/env bash
# pyfa-web 服务器自动更新：拉取 origin/<BRANCH>，按需更新依赖，代码有变化时重启服务并做健康检查。
#
# 触发方式（两种都以 deploy 用户运行）：
#   - pyfa-web-update.timer（systemd 定时器，兜底轮询，默认每 2 分钟）
#   - GitHub Actions 经 SSH 执行（push 即部署；见 .github/workflows/deploy.yml）
#
# 说明：
#   - 仓库是公开仓库，origin 用 https 匿名只读拉取，无需 Deploy Key；
#   - 仓库属主是服务用户 pyfaweb，deploy 靠「附加组 pyfaweb + 目录 g+w +
#     core.sharedRepository=group」获得写权限；git 的 ownership 检查由
#     /etc/gitconfig 的 safe.directory 放行（一次性配置见 docs/operations.md §2.1）；
#   - web.yml / web.env / eve.db / webdata/ / saveddata/ / *.db / session.key 都在
#     .gitignore 里，git reset --hard 不会触碰它们；本脚本也**绝不**执行 git clean；
#   - 重启走 sudoers 里给 deploy 的 NOPASSWD systemctl restart pyfa-web；
#   - 组共享细节：脚本 umask 002 + 目录 setgid + core.sharedRepository=group，
#     保证 deploy 新建的文件（含 .git/FETCH_HEAD 这种普通 open 建的文件）对组
#     pyfaweb 可写；请勿用 root 直接在仓库里跑 git —— root 建的文件是普通 umask，
#     会把 deploy 挡在 .git/FETCH_HEAD 上（脚本会给修复提示，root 运行时还会自动重试）。
#
# 可覆盖参数（systemd 单元里用 Environment= 设，或临时导出）：
#   PYFAWEB_APP_DIR / PYFAWEB_APP_USER / PYFAWEB_BRANCH / PYFAWEB_SERVICE
#   PYFAWEB_HEALTH_URL / PYFAWEB_HEALTH_TRIES / PYFAWEB_HEALTH_INTERVAL / PYFAWEB_LOCK
set -euo pipefail
# 组共享仓库：新建文件/目录对组可写（配合 core.sharedRepository=group 与目录 setgid）
umask 002

# 并发保护：定时器（每 2 分钟）与 Actions 可能同时触发同一次更新，
# 用 flock 串行化，后到的排队等前一个跑完（再判断一次就多半是「已是最新」）。
# 打不开锁文件时（例如锁文件被别人以不可写权限建过）不阻塞部署，按无锁继续。
LOCK_FILE=${PYFAWEB_LOCK:-/run/lock/pyfa-web-update.lock}
if command -v flock >/dev/null 2>&1 && exec 9>"$LOCK_FILE" 2>/dev/null; then
  flock 9
fi

APP_DIR=${PYFAWEB_APP_DIR:-/opt/pyfa-web}
APP_USER=${PYFAWEB_APP_USER:-pyfaweb}
BRANCH=${PYFAWEB_BRANCH:-master}
SERVICE=${PYFAWEB_SERVICE:-pyfa-web}
HEALTH_URL=${PYFAWEB_HEALTH_URL:-http://127.0.0.1:8091/api/meta}
HEALTH_TRIES=${PYFAWEB_HEALTH_TRIES:-30}
HEALTH_INTERVAL=${PYFAWEB_HEALTH_INTERVAL:-2}
VENV="$APP_DIR/.venv"

# CI 闸门：目标提交在 GitHub 上的 CI 结论不是 success 就不上线。
# 兜底定时器不看 Actions 的 workflow 依赖，没有这一步的话 CI 红的提交照样会在两分钟内
# 被定时器拉下来。GITHUB_REPO 空字符串可关掉闸门（PYFAWEB_CI_GATE=0）。
GITHUB_REPO=${PYFAWEB_GITHUB_REPO-chuxins/pyfa-web}
CI_GATE=${PYFAWEB_CI_GATE:-1}

log() { printf '[auto-update] %s\n' "$*"; }

cd "$APP_DIR"

# 以运行服务的用户身份执行 git / pip，保证新建文件属主与服务用户一致。
# 脚本本身以 pyfaweb 或 deploy 运行时直接执行：前者就是本人，后者靠组权限。
run_as_app() {
  if [ "$(id -u)" = 0 ]; then
    # 再用 bash -c 显式套一层 umask 002：runuser 的 PAM 会话可能把 umask 改回 022
    runuser -u "$APP_USER" -- bash -c 'umask 002; exec "$@"' _ "$@"
  else
    "$@"
  fi
}

before=$(run_as_app git rev-parse HEAD)

# fetch：失败时给出可执行的修复提示；脚本以 root 运行时还能自行按组共享修正后重试一次
# （典型故障：.git/FETCH_HEAD 曾被 root 以 644 建过，deploy 虽在组 pyfaweb 也写不动）
if ! run_as_app git fetch --quiet origin "$BRANCH"; then
  if [ "$(id -u)" = 0 ]; then
    log "git fetch 失败，按组共享修正 $APP_DIR/.git 权限后重试"
    chmod -R g+w "$APP_DIR/.git" || true
  fi
  if ! run_as_app git fetch --quiet origin "$BRANCH"; then
    log "git fetch 失败。若为 Permission denied（.git/FETCH_HEAD 等），请在服务器以 root 执行："
    log "  chmod -R g+w $APP_DIR/.git"
    log "并避免用 root 直接在仓库里跑 git（它建的文件不带组可写）。"
    exit 1
  fi
fi

after=$(run_as_app git rev-parse "origin/$BRANCH")

if [ "$before" = "$after" ]; then
  log "已是最新（${before:0:12}），无需更新"
  exit 0
fi

# ---- CI 闸门 ---------------------------------------------------------------
# 读 GitHub 上这个提交的 check-runs 结论：只要有一个没成功/还在跑就不上线。
#
# 用 python 解析 JSON 而不是 grep 数字段：check-run 对象里 "id" 出现好几次
# （run/app/suite 各有 id），之前按 '"id":' 计数会得出 3/12 这种假结论，把绿的提交
# 也拦下来（2026-10-27 实际踩过）。机器上一定有 venv 里的 python（服务就是它跑的）。
#
# 拿不到结论（断网、API 限流、仓库未公开）时放行并大声记一笔 —— 部署被一次网络抖动
# 永久卡住，比偶尔放行一个红提交更难查。CI 还没开始跑（没有 check-run）时则等下一轮
# 轮询，除非这个提交已经超过 GATE_MAX_AGE 秒还没见到任何检查（那种情况多半是仓库没配 CI）。
ci_gate_allows() {
  [ "$CI_GATE" = "1" ] || return 0
  [ -n "$GITHUB_REPO" ] || return 0

  local python_bin="$VENV/bin/python"
  [ -x "$python_bin" ] || python_bin=$(command -v python3 || true)
  if [ -z "$python_bin" ] || ! command -v curl >/dev/null 2>&1; then
    log "没有 curl/python，跳过 CI 闸门"
    return 0
  fi

  local api="https://api.github.com/repos/$GITHUB_REPO/commits/$after/check-runs"
  local json tmp verdict
  if ! json=$(curl -sS -m 15 -H 'Accept: application/vnd.github+json' -H 'User-Agent: pyfa-web-auto-update' "$api" 2>/dev/null); then
    log "警告：取不到 CI 结论（网络/限流），按放行处理"
    return 0
  fi

  tmp=$(mktemp)
  printf '%s' "$json" >"$tmp"
  verdict=$("$python_bin" - "$tmp" <<'PY'
import json
import sys

data = json.load(open(sys.argv[1], encoding="utf-8-sig"))
# 本仓库 deploy.yml 的 job 叫 deploy，它自己就会调这个脚本：把它算进闸门会变成
# "部署等部署" —— 手动从 Actions 上线时会白跑一趟。只认 CI 的作业。
IGNORED = {"deploy"}
runs = [
    run
    for run in (data.get("check_runs") or [])
    if (run.get("name") or "").strip().lower() not in IGNORED
]
if not runs:
    print("none")
    raise SystemExit(0)
bad = [
    "{}/{}".format(run.get("name"), run.get("conclusion") or run.get("status"))
    for run in runs
    if run.get("status") != "completed" or run.get("conclusion") != "success"
]
print("ok:{}".format(len(runs)) if not bad else "blocked:{}".format(",".join(bad)))
PY
  ) || verdict="unknown"
  rm -f "$tmp"

  case "$verdict" in
    ok:*)
      log "CI 闸门通过（${verdict#ok:} 个检查全绿）"
      return 0
      ;;
    blocked:*)
      log "CI 闸门拦截：${after:0:12} 有未成功的检查（${verdict#blocked:}）"
      return 1
      ;;
    none)
      # 没有 check-run：CI 可能还没开始。提交很旧就说明这个仓库根本没有 CI，放行。
      age=$(git log -1 --format=%ct "$after" 2>/dev/null || echo 0)
      now=$(date +%s)
      if [ "$age" != "0" ] && [ $((now - age)) -gt "${PYFAWEB_CI_WAIT_MAX:-1800}" ]; then
        log "警告：${after:0:12} 提交超过 30 分钟仍没有 check-runs，按放行处理"
        return 0
      fi
      log "CI 还没开始跑（没有 check-runs），等下一轮轮询"
      return 1
      ;;
    *)
      log "警告：看不懂 CI 结论，按放行处理"
      return 0
      ;;
  esac
}

if ! ci_gate_allows; then
  log "跳过本次更新，等服务端 CI 变绿（手动上线可设 PYFAWEB_CI_GATE=0）"
  exit 0
fi

log "更新 ${before:0:12} -> ${after:0:12}"
run_as_app git reset --hard "origin/$BRANCH"

# 仅当依赖清单变化时才安装，减少无谓耗时
if run_as_app git diff --name-only "$before" "$after" | grep -qE '^(pyproject\.toml|uv\.lock)$'; then
  log "依赖清单有变化，安装依赖到 $VENV"
  mapfile -t deps < <(
    "$VENV/bin/python" - "$APP_DIR/pyproject.toml" <<'PY'
import pathlib
import sys
import tomllib

data = tomllib.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
project = data.get("project", {})
# 运行所需的两组：基础依赖 + web 组（pip 侧等价写法 pip install -e ".[web]"）
wanted = list(project.get("dependencies", []))
wanted += list(project.get("optional-dependencies", {}).get("web", []))
seen, out = set(), []
for spec in wanted:
    name = spec.split("==")[0].split("[")[0].split(">")[0].split("<")[0].strip().lower()
    if name and name not in seen:
        seen.add(name)
        out.append(spec)
print("\n".join(out))
PY
  )
  if [ "${#deps[@]}" -eq 0 ]; then
    log "无法从 pyproject.toml 解析依赖，中止（不重启，保持旧版本继续可用）"
    exit 1
  fi
  run_as_app "$VENV/bin/python" -m pip install -q --disable-pip-version-check "${deps[@]}"
  log "依赖已更新（${#deps[@]} 项）"
fi

# 重启：root 直接调用；其它用户（deploy）走 sudoers 的 NOPASSWD
if [ "$(id -u)" = 0 ]; then
  systemctl restart "$SERVICE"
else
  sudo -n /usr/bin/systemctl restart "$SERVICE"
fi
log "已重启 $SERVICE，等待健康检查通过：$HEALTH_URL"

code=""
i=1
while [ "$i" -le "$HEALTH_TRIES" ]; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "$HEALTH_URL" || true)
  if [ "$code" = "200" ]; then
    log "健康检查通过（第 ${i} 次尝试，HTTP ${code}）"
    exit 0
  fi
  sleep "$HEALTH_INTERVAL"
  i=$((i + 1))
done

log "健康检查失败：${HEALTH_TRIES} 次尝试（每 ${HEALTH_INTERVAL} 秒一次）都没拿到 HTTP 200，最后一次 HTTP ${code:-无响应}"
# deploy 若不在 systemd-journal / adm 组，这里读不到日志会静默跳过，不影响上面的结论
journalctl -u "$SERVICE" -n 50 2>/dev/null || true
exit 1
