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
#     /etc/gitconfig 的 safe.directory 放行（一次性配置见 README §9）；
#   - web.yml / web.env / eve.db / webdata/ / saveddata/ / *.db / session.key 都在
#     .gitignore 里，git reset --hard 不会触碰它们；本脚本也**绝不**执行 git clean；
#   - 重启走 sudoers 里给 deploy 的 NOPASSWD systemctl restart pyfa-web。
#
# 可覆盖参数（systemd 单元里用 Environment= 设，或临时导出）：
#   PYFAWEB_APP_DIR / PYFAWEB_APP_USER / PYFAWEB_BRANCH / PYFAWEB_SERVICE
#   PYFAWEB_HEALTH_URL / PYFAWEB_HEALTH_TRIES / PYFAWEB_HEALTH_INTERVAL
set -euo pipefail

APP_DIR=${PYFAWEB_APP_DIR:-/opt/pyfa-web}
APP_USER=${PYFAWEB_APP_USER:-pyfaweb}
BRANCH=${PYFAWEB_BRANCH:-master}
SERVICE=${PYFAWEB_SERVICE:-pyfa-web}
HEALTH_URL=${PYFAWEB_HEALTH_URL:-http://127.0.0.1:8091/api/meta}
HEALTH_TRIES=${PYFAWEB_HEALTH_TRIES:-30}
HEALTH_INTERVAL=${PYFAWEB_HEALTH_INTERVAL:-2}
VENV="$APP_DIR/.venv"

log() { printf '[auto-update] %s\n' "$*"; }

cd "$APP_DIR"

# 以运行服务的用户身份执行 git / pip，保证新建文件属主与服务用户一致。
# 脚本本身以 pyfaweb 或 deploy 运行时直接执行：前者就是本人，后者靠组权限。
run_as_app() {
  if [ "$(id -u)" = 0 ]; then
    runuser -u "$APP_USER" -- "$@"
  else
    "$@"
  fi
}

before=$(run_as_app git rev-parse HEAD)
run_as_app git fetch --quiet origin "$BRANCH"
after=$(run_as_app git rev-parse "origin/$BRANCH")

if [ "$before" = "$after" ]; then
  log "已是最新（${before:0:12}），无需更新"
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
