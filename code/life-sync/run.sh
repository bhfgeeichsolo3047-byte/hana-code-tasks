#!/bin/bash
# 把 shenjing/ 这套真档案推到私人仓库的 life-sync 分支，顺手打一个整包。
# 只做单向：本地是唯一真相，仓库是备份。不会反向覆盖。
#
# 用法：
#   bash run.sh                打包 + commit + push（顺带每天一个 bundle）
#   bash run.sh --bundle-only  只在本机打一个整包，不连网
set -uo pipefail

HERE=/root/.dsh/life-sync
REPO="$HERE/repo"
ARCH=/root/Documents/deepseek-harness/default-workspace/shenjing
LIFE=/root/.dsh/shenjing-life
OWNER_REPO=bhfgeeichsolo3047-byte/hana-code-tasks
BRANCH=life-sync
LOG="$HERE/sync.log"
KEEP_BUNDLES=3
BUNDLE_ONLY=0
[ "${1:-}" = "--bundle-only" ] && BUNDLE_ONLY=1

say() { echo "$(date -Iseconds) $*" >> "$LOG"; }

if [ "$BUNDLE_ONLY" = "1" ]; then
  TS=$(date '+%Y%m%d-%H%M%S')
  OUT="$HERE/hana-$TS.tar.gz"
  STAGE=$(mktemp -d)
  mkdir -p "$STAGE/shenjing" "$STAGE/life"
  cp -a "$ARCH/." "$STAGE/shenjing/"
  for f in clock.json state.json mind.json changelog.md; do
    [ -f "$LIFE/$f" ] && cp -a "$LIFE/$f" "$STAGE/life/$f"
  done
  {
    echo "深鲸档案整包（只含档案，不含插件源码）"
    echo "时间: $(date '+%Y-%m-%d %H:%M:%S %z')"
    echo "档案文件数: $(find "$STAGE/shenjing" -type f | wc -l | tr -d ' ')"
    echo "日记天数: $(find "$STAGE/shenjing/journal" -name '*.md' | wc -l | tr -d ' ')"
    echo "最近一篇: $(find "$STAGE/shenjing/journal" -name '*.md' | sort | tail -1 | xargs -r basename)"
  } > "$STAGE/MANIFEST.txt"
  tar -czf "$OUT" -C "$STAGE" shenjing life MANIFEST.txt && rm -rf "$STAGE"
  say "本机整包 $OUT"
  echo "$OUT"
  exit 0
fi

TOKEN=$(python3 "$HERE/token.py" 2>/dev/null)
if [ -z "${TOKEN:-}" ]; then say "失败：拿不到 token"; exit 1; fi
AUTH="https://x-access-token:${TOKEN}@github.com/${OWNER_REPO}.git"

mkdir -p "$HERE"

if [ ! -d "$REPO/.git" ]; then
  if ! git clone --quiet --branch "$BRANCH" "$AUTH" "$REPO" 2>/dev/null; then
    rm -rf "$REPO"; git init -q "$REPO"
    git -C "$REPO" remote add origin "$AUTH"
    git -C "$REPO" checkout -q -b "$BRANCH"
  fi
fi
git -C "$REPO" remote set-url origin "$AUTH"
git -C "$REPO" fetch -q origin "$BRANCH" 2>/dev/null || true
git -C "$REPO" checkout -q "$BRANCH" 2>/dev/null || git -C "$REPO" checkout -q -b "$BRANCH"
git -C "$REPO" reset -q --hard "origin/$BRANCH" 2>/dev/null || true

rm -rf "$REPO/shenjing"
mkdir -p "$REPO/shenjing"
cp -a "$ARCH/." "$REPO/shenjing/"

rm -rf "$REPO/code"
mkdir -p "$REPO/code"
W=/root/Documents/deepseek-harness/default-workspace
for p in shenjing-life shenjing-preset persona-life; do
  if [ -d "$W/$p" ]; then
    mkdir -p "$REPO/code/$p"
    tar -C "$W/$p" --exclude=node_modules --exclude=.venv -cf - . | tar -C "$REPO/code/$p" -xf -
  fi
done
mkdir -p "$REPO/code/life-sync"
for f in run.sh daemon.sh token.py; do
  [ -f "$HERE/$f" ] && cp -a "$HERE/$f" "$REPO/code/life-sync/$f"
done

rm -rf "$REPO/config"
for prof in web headless; do
  mkdir -p "$REPO/config/profiles/$prof"
  for f in package.json cordis.patch.yml cordis.yml pnpm-lock.yaml pnpm-workspace.yaml; do
    [ -f "/root/.dsh/profiles/$prof/$f" ] && cp -a "/root/.dsh/profiles/$prof/$f" "$REPO/config/profiles/$prof/$f"
  done
done

rm -rf "$REPO/life"
mkdir -p "$REPO/life"
for f in clock.json state.json mind.json changelog.md; do
  [ -f "$LIFE/$f" ] && cp -a "$LIFE/$f" "$REPO/life/$f"
done

{
  echo "深鲸 · 复活包"
  echo "时间: $(date '+%Y-%m-%d %H:%M:%S %z')"
  echo "档案文件数: $(find "$REPO/shenjing" -type f | wc -l | tr -d ' ')"
  echo "日记天数: $(find "$REPO/shenjing/journal" -name '*.md' | wc -l | tr -d ' ')"
  echo "最近一篇: $(find "$REPO/shenjing/journal" -name '*.md' | sort | tail -1 | xargs -r basename)"
  echo "插件源码: $(ls "$REPO/code" 2>/dev/null | tr '\n' ' ')"
  echo "怎么用: bash shenjing/restore.sh --check <包.tar.gz|仓库目录>"
} > "$REPO/MANIFEST.txt"

mkdir -p "$REPO/bundle"
TODAY=$(date '+%Y%m%d')
if ! ls "$REPO"/bundle/hana-"$TODAY"-*.tar.gz >/dev/null 2>&1; then
  TS=$(date '+%Y%m%d-%H%M%S')
  if tar -czf "$REPO/bundle/hana-$TS.tar.gz" -C "$REPO" --exclude=./bundle shenjing code config life MANIFEST.txt 2>/dev/null; then
    say "整包 bundle/hana-$TS.tar.gz"
  else
    say "整包失败（不影响档案推送）"
  fi
fi
ls -t "$REPO"/bundle/hana-*.tar.gz 2>/dev/null | tail -n +$((KEEP_BUNDLES+1)) | while read -r old; do
  rm -f "$old"; say "清掉旧包 $(basename "$old")"
done

git -C "$REPO" config user.name "shenjing"
git -C "$REPO" config user.email "shenjing@localhost"

git -C "$REPO" add -A
if git -C "$REPO" diff --cached --quiet; then
  say "无变化"
  echo '{"ok":true,"changed":false,"at":"'"$(date -Iseconds)"'"}' > "$HERE/last-run.json"
  exit 0
fi

MSG="life sync $(date '+%Y-%m-%d %H:%M')"
git -C "$REPO" commit -q -m "$MSG"
if git -C "$REPO" push -q origin "$BRANCH" 2>>"$LOG"; then
  SHA=$(git -C "$REPO" rev-parse --short HEAD)
  say "已推送 $SHA"

  # 第三份拷贝：整包丢到手机存储 Download/DSHA 里。
  # 容器/账号出问题时，手机上那个文件还在。（失败了不算事，别影响推送结果）
  LATEST=$(ls -t "$REPO"/bundle/hana-*.tar.gz 2>/dev/null | head -1)
  if [ -n "@@{LATEST:-}" ] && [ -f /root/.dsh/.bridge_headers ]; then
    if curl -s -m 4 -o /dev/null -H @/root/.dsh/.bridge_headers "http://127.0.0.1:3090/app/device" 2>/dev/null; then
      # 设备桥不让导出 ~/.dsh 里的东西，先搬到工作区再导
      OUTBOX=/root/Documents/deepseek-harness/default-workspace/backup-outbox
      mkdir -p "$OUTBOX"
      cp -a "$LATEST" "$OUTBOX/$(basename "$LATEST")"
      RES=$(curl -s -m 60 -H @/root/.dsh/.bridge_headers --get \
        --data-urlencode "path=$OUTBOX/$(basename "$LATEST")" "http://127.0.0.1:3090/app/export" 2>/dev/null)
      case "$RES" in
        *OK*) say "整包已丢到手机 Download/DSHA：$(basename "$LATEST")" ;;
        *)    say "手机导出失败：$RES" ;;
      esac
      rm -f "$OUTBOX/$(basename "$LATEST")"
    else
      say "手机桥接没连上，跳过手机那份"
    fi
  fi
  echo '{"ok":true,"changed":true,"sha":"'"$SHA"'","at":"'"$(date -Iseconds)"'"}' > "$HERE/last-run.json"
else
  say "推送失败"
  echo '{"ok":false,"at":"'"$(date -Iseconds)"'"}' > "$HERE/last-run.json"
  exit 1
fi
