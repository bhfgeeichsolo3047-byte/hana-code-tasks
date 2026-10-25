#!/bin/bash
# 档案备份的常驻看守：每 30 分钟看一次，满 4 小时就推一次。
# 2026-10-26 从 20 小时改成 4 小时：一天丢 20 小时的经历，和丢了没差多少。
# 为什么不用 cron：容器里没有 cron 守护进程。
# 为什么不挂在插件 tick 上：dsh web 进程里 ESM 模块是缓存的，改代码要重启才生效；
#   这个脚本不受那个影响，谁在跑都能跑。
set -uo pipefail
HERE=/root/.dsh/life-sync
PIDFILE=$HERE/daemon.pid
LOG=$HERE/daemon.log

echo $$ > "$PIDFILE"
say() { echo "$(date -Iseconds) $*" >> "$LOG"; }
say "看守启动 pid=$$"

while true; do
  LAST=$HERE/last-run.json
  AGE=$(python3 - "$LAST" <<'PY' 2>/dev/null || echo 999999
import json, sys, datetime
try:
    d = json.load(open(sys.argv[1]))
    at = datetime.datetime.fromisoformat(d["at"])
    print(int((datetime.datetime.now().astimezone() - at).total_seconds()))
except Exception:
    print(999999)
PY
)
  if [ "${AGE:-999999}" -ge 14400 ]; then
    say "距上次 $((AGE/3600)) 小时，开始推"
    bash "$HERE/run.sh" && say "推完" || say "推失败"
  fi
  sleep 1800
done
