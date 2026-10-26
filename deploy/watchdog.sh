#!/usr/bin/env bash
# pyfa-web 看门狗：每 5 分钟探一次健康端点。连续失败才动手，避免重启时的正常空窗误判。
#
# 处理顺序：
#   1) 连续 $FAIL_THRESHOLD 次拿不到 200 → systemctl restart pyfa-web
#   2) 报警：设了 PYFAWEB_ALERT_URL 就 POST {"text": "..."}（Slack/Discord/自建 webhook
#      都吃这个形状；飞书/钉钉这类要自己套一层转发）。没设就只写 journal。
#   3) 恢复时也发一条，免得只看得到故障看不到恢复
#
# 和 systemd 的 Restart=always 的分工：Restart 管进程退出，看门狗管「进程还在但不响应」
# （uvicorn 活着但引擎卡死、端口被占、事件循环被阻塞）。
#
# 可覆盖参数（systemd 单元里用 Environment= 设，或临时导出）：
#   PYFAWEB_HEALTH_URL        默认 http://127.0.0.1:8091/api/meta
#   PYFAWEB_SERVICE           默认 pyfa-web
#   PYFAWEB_FAIL_THRESHOLD    默认 2（配合 5 分钟间隔 ≈ 10 分钟没响应才重启）
#   PYFAWEB_ALERT_URL         告警 webhook，留空则只写 journal
#   PYFAWEB_STATE_FILE        连续失败计数落盘，默认 /run/pyfa-web-watchdog.state
#   PYFAWEB_ALERT_COOLDOWN    同一状态的重复告警间隔（秒），默认 3600
set -uo pipefail

HEALTH_URL=${PYFAWEB_HEALTH_URL:-http://127.0.0.1:8091/api/meta}
SERVICE=${PYFAWEB_SERVICE:-pyfa-web}
FAIL_THRESHOLD=${PYFAWEB_FAIL_THRESHOLD:-2}
ALERT_URL=${PYFAWEB_ALERT_URL:-}
STATE_FILE=${PYFAWEB_STATE_FILE:-/run/pyfa-web-watchdog.state}
ALERT_COOLDOWN=${PYFAWEB_ALERT_COOLDOWN:-3600}

log() { printf '[watchdog] %s\n' "$*"; }

fail_count=0
alerted_fail_at=0
alerted_ok_at=0
if [ -r "$STATE_FILE" ]; then
  # shellcheck disable=SC1090
  . "$STATE_FILE" 2>/dev/null || true
fi

save_state() {
  mkdir -p "$(dirname "$STATE_FILE")" 2>/dev/null || true
  {
    printf 'fail_count=%s\n' "$fail_count"
    printf 'alerted_fail_at=%s\n' "$alerted_fail_at"
    printf 'alerted_ok_at=%s\n' "$alerted_ok_at"
  } >"$STATE_FILE" 2>/dev/null || true
}

notify() {
  local text=$1
  log "$text"
  [ -n "$ALERT_URL" ] || return 0
  command -v curl >/dev/null 2>&1 || { log "没有 curl，发不出告警"; return 0; }
  # 转义：只保留基本字符，避免 JSON 被引号打断
  local escaped
  escaped=$(printf '%s' "$text" | tr -d '"\\' | tr '\n' ' ')
  curl -sS -m 10 -o /dev/null -X POST -H 'Content-Type: application/json' \
    -d "{\"text\": \"${escaped}\"}" "$ALERT_URL" || log "告警发送失败（不影响重启逻辑）"
}

now=$(date +%s)

if curl -fsS -m 10 -o /dev/null "$HEALTH_URL"; then
  if [ "$fail_count" -ge "$FAIL_THRESHOLD" ]; then
    notify "pyfa-web 已恢复（$HEALTH_URL 重新返回 200，此前连续失败 ${fail_count} 次）"
    alerted_ok_at=$now
  elif [ "$fail_count" -gt 0 ]; then
    log "健康检查恢复（此前失败 ${fail_count} 次）"
  else
    log "健康检查正常"
  fi
  fail_count=0
  save_state
  exit 0
fi

fail_count=$((fail_count + 1))
log "健康检查失败（连续第 ${fail_count} 次）：$HEALTH_URL"

if [ "$fail_count" -lt "$FAIL_THRESHOLD" ]; then
  save_state
  exit 0
fi

if [ $((now - alerted_fail_at)) -ge "$ALERT_COOLDOWN" ]; then
  notify "pyfa-web 健康检查失败 ${fail_count} 次（$HEALTH_URL），准备重启 $SERVICE"
  alerted_fail_at=$now
fi

# 只在服务确实还在「active」时才 restart（彻底停了交给 systemd 的 Restart=always）
state=$(systemctl is-active "$SERVICE" 2>/dev/null || true)
if [ "$state" = "active" ]; then
  log "重启 $SERVICE（进程在但接口不响应）"
  systemctl restart "$SERVICE" || log "重启失败"
else
  log "$SERVICE 当前状态：${state:-未知}，尝试启动"
  systemctl start "$SERVICE" || log "启动失败"
fi

# 重启后等一会儿再看一眼
for _ in 1 2 3 4 5 6; do
  sleep 5
  if curl -fsS -m 5 -o /dev/null "$HEALTH_URL"; then
    log "重启后已恢复"
    fail_count=0
    save_state
    exit 0
  fi
done

log "重启后仍未恢复，留给人工处理"
save_state
exit 1
