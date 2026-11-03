#!/usr/bin/env bash
set -euo pipefail
SERIAL="${ADB_SERIAL:-127.0.0.1:5555}"
adb -s "$SERIAL" shell "if [ -f /data/local/tmp/shenjing-watchdog.pid ]; then kill \$(cat /data/local/tmp/shenjing-watchdog.pid) && rm -f /data/local/tmp/shenjing-watchdog.pid; else echo 'No watchdog pid file'; fi"
