#!/usr/bin/env bash
set -euo pipefail
SERIAL="${ADB_SERIAL:-127.0.0.1:5555}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
adb -s "$SERIAL" push "$HERE/device-watchdog.sh" /data/local/tmp/shenjing-watchdog.sh
adb -s "$SERIAL" shell chmod 700 /data/local/tmp/shenjing-watchdog.sh
adb -s "$SERIAL" shell "if [ -f /data/local/tmp/shenjing-watchdog.pid ]; then kill \$(cat /data/local/tmp/shenjing-watchdog.pid) 2>/dev/null || true; fi"
adb -s "$SERIAL" shell "nohup /system/bin/sh /data/local/tmp/shenjing-watchdog.sh >/data/local/tmp/shenjing-watchdog.nohup 2>&1 </dev/null & echo \$! >/data/local/tmp/shenjing-watchdog.pid"
echo "Started device watchdog on $SERIAL"
