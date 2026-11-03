#!/system/bin/sh
# Device-side watchdog for DSH Go. Runs independently of the proot container.
PKG=io.github.ccch1mneyyy.dsh_app
ACTIVITY=io.github.ccch1mneyyy.dsh_app/.MainActivity
LOG=/data/local/tmp/shenjing-watchdog.log
FAIL=0
INTERVAL=30
while true; do
  NOW=$(date '+%F %T')
  if pidof "$PKG" >/dev/null 2>&1; then
    FAIL=0
    echo "$NOW alive pid=$(pidof "$PKG")" >> "$LOG"
  else
    FAIL=$((FAIL + 1))
    echo "$NOW missing failure=$FAIL" >> "$LOG"
    if [ "$FAIL" -ge 2 ]; then
      echo "$NOW launching $PKG" >> "$LOG"
      am start -n "$ACTIVITY" >> "$LOG" 2>&1 || \
        monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >> "$LOG" 2>&1
      FAIL=0
      sleep 15
    fi
  fi
  sleep "$INTERVAL"
done
