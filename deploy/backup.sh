#!/usr/bin/env bash
# pyfa-web 数据备份：把 /var/lib/pyfa-web 下的 SQLite 库与会话密钥打成一个压缩包，
# 按份数保留。由 pyfa-web-backup.timer 每天跑一次，也可以手工执行。
#
# 为什么用 Python 的 sqlite3 备份 API 而不是 cp：
#   app.db 与每用户的 saveddata.db 都是 WAL 模式，直接 cp（含 -wal）在写入中途会拿到
#   撕裂的快照；`.backup` 走的是 SQLite 自己的在线备份，能给出一致的一份。
#   机器上一定有 /opt/pyfa-web/.venv/bin/python（服务就是它跑的），所以不依赖 sqlite3 命令行。
#
# 可覆盖参数（systemd 单元里用 Environment= 设，或临时导出）：
#   PYFAWEB_DATA_DIR    默认 /var/lib/pyfa-web
#   PYFAWEB_BACKUP_DIR  默认 /var/backups/pyfa-web
#   PYFAWEB_BACKUP_KEEP 保留份数，默认 14
#   PYFAWEB_BACKUP_HOOK 备份成功后执行的命令，参数是压缩包路径（异地拉走用，例如
#                       rclone copy "$1" remote:pyfa-web-backup/）
set -euo pipefail

DATA_DIR=${PYFAWEB_DATA_DIR:-/var/lib/pyfa-web}
BACKUP_DIR=${PYFAWEB_BACKUP_DIR:-/var/backups/pyfa-web}
KEEP=${PYFAWEB_BACKUP_KEEP:-14}
HOOK=${PYFAWEB_BACKUP_HOOK:-}
PYTHON=${PYFAWEB_PYTHON:-}

log() { printf '[backup] %s\n' "$*"; }

if [ -z "$PYTHON" ]; then
  if [ -x /opt/pyfa-web/.venv/bin/python ]; then
    PYTHON=/opt/pyfa-web/.venv/bin/python
  else
    PYTHON=$(command -v python3 || true)
  fi
fi
if [ -z "$PYTHON" ]; then
  log "找不到 python3，无法用 SQLite 在线备份；中止"
  exit 1
fi

if [ ! -d "$DATA_DIR" ]; then
  log "数据目录不存在：$DATA_DIR"
  exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# 组权限：同组的 pyfaweb 读得到（数据目录是 pyfaweb 的）
umask 077

stamp=$(date +%Y%m%d-%H%M%S)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

log "备份 $DATA_DIR -> $BACKUP_DIR（临时目录 $work）"

# 1) 所有 SQLite 库都用在线备份 API 导出一份一致快照
"$PYTHON" - "$DATA_DIR" "$work" <<'PY'
import os
import sqlite3
import sys

data_dir, work = sys.argv[1], sys.argv[2]
count = 0
for root, _dirs, files in os.walk(data_dir):
    for name in files:
        if not (name.endswith(".db") or name.endswith(".sqlite") or name.endswith(".sqlite3")):
            continue
        src = os.path.join(root, name)
        rel = os.path.relpath(src, data_dir)
        dst = os.path.join(work, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        try:
            with sqlite3.connect(src) as source, sqlite3.connect(dst) as target:
                source.backup(target)
            count += 1
            print("[backup]   db %s" % rel, file=sys.stderr)
        except Exception as exc:  # 单个坏库不该让整次备份失败
            print("[backup]   跳过 %s：%s" % (rel, exc), file=sys.stderr)
print("[backup] 共 %d 个数据库" % count, file=sys.stderr)
PY

# 2) 非数据库的小文件（session.key、settings、目录结构）逐个拷过来；密钥开 600
if [ -f "$DATA_DIR/session.key" ]; then
  cp -a "$DATA_DIR/session.key" "$work/session.key"
  chmod 600 "$work/session.key"
fi
for dir in system users; do
  if [ -d "$DATA_DIR/$dir" ]; then
    # 只要非数据库的小文件；库已经在第 1 步导过了
    (cd "$DATA_DIR" && find "$dir" -type f ! -name '*.db' ! -name '*.db-wal' ! -name '*.db-shm' -print0 |
      while IFS= read -r -d '' f; do
        mkdir -p "$work/$(dirname "$f")"
        cp -a "$f" "$work/$f"
      done)
  fi
done

archive="$BACKUP_DIR/pyfa-web-$stamp.tar.gz"
tar -czf "$archive" -C "$work" .
chmod 600 "$archive"

size=$(du -h "$archive" | cut -f1)
log "已生成 $archive（$size）"

# 3) 保留最近 $KEEP 份
mapfile -t old < <(ls -1t "$BACKUP_DIR"/pyfa-web-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) || true)
if [ "${#old[@]}" -gt 0 ]; then
  for f in "${old[@]}"; do
    rm -f "$f"
    log "清理旧备份 $(basename "$f")"
  done
fi

# 4) 可选：交给外部命令拉走（异地备份）
if [ -n "$HOOK" ]; then
  log "执行 PYFAWEB_BACKUP_HOOK"
  bash -c "$HOOK" _ "$archive" || log "警告：备份钩子失败（本地备份仍然可用）"
fi

log "完成"
