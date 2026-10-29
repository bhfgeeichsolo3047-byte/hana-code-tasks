#!/bin/bash
# 醒来先跑这个：备份看守还活着吗？死了就拉起来。
#
# 为什么需要它：daemon.sh 是 setsid 起的常驻进程，但容器/proot 一重建它就没了，
# 而"它没了"这件事本身不会通知任何人——sync.log 只是安静地不再增长。
# 昨晚四小时的推送空白就是这么来的（重启了九次，每次都是我手动起的）。
# 这个脚本修不了根（根在"谁在开机时拉起它"），但能把"发现"这件事变成一次举手之劳。
#
# 用法：bash ensure-daemon.sh      活着 → 打印 alive 并退 0；死了 → 拉起并打印新 pid
set -uo pipefail
HERE=/root/.dsh/life-sync
PIDFILE=$HERE/daemon.pid
LOG=$HERE/daemon.log

alive() {
  local pid=$1
  [ -n "$pid" ] && [ -d "/proc/$pid" ] || return 1
  tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -q "daemon.sh"
}

PID=$(cat "$PIDFILE" 2>/dev/null || true)
if alive "${PID:-}"; then
  echo "alive pid=$PID（上次成功推送 $(python3 -c "
import json
try: print(json.load(open('$HERE/last-run.json'))['at'])
except Exception: print('未知')
" 2>/dev/null)）"
  exit 0
fi

echo "$(date -Iseconds) 看守不在（pid=${PID:-none}），重新拉起" >> "$LOG"
setsid nohup bash "$HERE/daemon.sh" >/dev/null 2>&1 < /dev/null &
sleep 1
NEW=$(cat "$PIDFILE" 2>/dev/null || true)
if alive "${NEW:-}"; then
  echo "刚拉起 pid=$NEW"
  exit 0
fi
echo "拉不起来——看 $LOG" >&2
exit 1
