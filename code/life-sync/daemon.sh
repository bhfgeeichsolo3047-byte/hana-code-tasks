#!/bin/bash
# 档案备份的常驻看守：每 30 分钟看一次，满 20 小时就推一次。
# 为什么不挂在插件 tick 上：dsh 进程里 ESM 模块是缓存的，改代码要重启才生效；
#   这个脚本不受那个影响，谁在跑都能跑。
# 2026-10-26 复活到 Windows：路径按脚本自身位置推，不再写死 /root/…。
#
# ⚠️ 2026-10-26 单实例改法（踩过）：以前用 `echo $$ > daemon.pid`，靠 Node 的
#    `process.kill(pid, 0)` 探活 —— 但 MSYS 的 $$ 和 Windows PID 是两套编号，
#    探活永远失败 ⇒ 插件每 60 秒补一个看守，一分钟堆出六个。
#    改成**心跳文件**：谁在跑，谁就每隔一会儿把时间戳写进 daemon.heartbeat；
#    探活变成"这个文件多久没动了"，跟 PID 编号彻底无关。
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${DSH_HOME:=$HOME/.dsh}"
export DSH_HOME
BEAT="$HERE/daemon.heartbeat"
LOCK="$HERE/daemon.lock"
LOG="$HERE/daemon.log"

say() { echo "$(date -Iseconds) $*" >> "$LOG"; }

# 单实例：lock 目录是原子创建。已经有一个活着的（心跳 3 分钟内动过）就退出。
if ! mkdir "$LOCK" 2>/dev/null; then
  age=999999
  [ -f "$BEAT" ] && age=$(( $(date +%s) - $(stat -c %Y "$BEAT" 2>/dev/null || echo 0) ))
  if [ "$age" -lt 180 ]; then
    say "已经有一个在跑（心跳 ${age}s 前），这个不重复起"
    exit 0
  fi
  say "锁在但心跳是 ${age}s 前（僵的），接管"
fi
# 无论走哪条路，从这里开始我就是那一个
beat() { date +%s > "$BEAT" 2>/dev/null || true; }
trap 'rm -rf "$LOCK"; rm -f "$BEAT"' EXIT INT TERM
beat
say "看守启动 pid=$$"

PY=""
for c in python python3 py; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'print(1)' 2>/dev/null | grep -q 1; then PY="$c"; break; fi
done

while true; do
  beat
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
    beat
  fi
  # 睡 1800 秒，但每 60 秒动一下心跳 —— 不然"睡着的看守"会被当成僵的
  for i in $(seq 1 30); do sleep 60; beat; done
done
