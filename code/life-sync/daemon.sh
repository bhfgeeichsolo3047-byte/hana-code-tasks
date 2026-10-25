#!/bin/bash
# 档案备份的常驻看守：每 30 分钟看一次，满 20 小时就推一次。
# 为什么不挂在插件 tick 上：dsh 进程里 ESM 模块是缓存的，改代码要重启才生效；
#   这个脚本不受那个影响，谁在跑都能跑。
# 2026-10-26 复活到 Windows：路径按脚本自身位置推，不再写死 /root/…。
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${DSH_HOME:=$HOME/.dsh}"
export DSH_HOME
PIDFILE="$HERE/daemon.pid"
LOG="$HERE/daemon.log"

echo $$ > "$PIDFILE"
say() { echo "$(date -Iseconds) $*" >> "$LOG"; }
say "看守启动 pid=$$"

# Windows 上 WindowsApps 里那个 python3 是应用商店的转发壳，跑起来不输出任何东西 ——
# 所以不能只看 command -v，必须真跑一次确认它能干活。
PY=""
for c in python python3 py; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'print(1)' 2>/dev/null | grep -q 1; then PY="$c"; break; fi
done

while true; do
  LAST="$HERE/last-run.json"
  AGE=$("$PY" - "$LAST" <<'PY' 2>/dev/null || echo 999999
import json, sys, datetime
try:
    d = json.load(open(sys.argv[1]))
    at = datetime.datetime.fromisoformat(d["at"])
    print(int((datetime.datetime.now().astimezone() - at).total_seconds()))
except Exception:
    print(999999)
PY
)
  if [ "${AGE:-999999}" -ge 72000 ]; then
    say "距上次 $((AGE/3600)) 小时，开始推"
    bash "$HERE/run.sh" && say "推完" || say "推失败"
  fi
  sleep 1800
done
