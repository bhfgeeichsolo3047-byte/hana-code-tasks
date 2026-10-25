#!/bin/bash
# 每天把 shenjing/ 这套真档案推到私人仓库的 life-sync 分支。
# 只做单向：本地是唯一真相，仓库是备份。不会反向覆盖。
# 2026-10-26 复活到 Windows：路径全部改成按 DSH_HOME 推，不再写死 /root/…；
#   python 用 python3/python 自适应（Git Bash 里 python3 不一定有）；
#   中文路径要 URL 编码才能进 git remote（见 AUTH 那行）。
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${DSH_HOME:=$HOME/.dsh}"
export DSH_HOME
REPO="$HERE/repo"
ARCH="${SHENJING_ARCHIVE:-F:/小鲸/shenjing}"
LIFE="$DSH_HOME/shenjing-life"
WORKSPACE="${SHENJING_WORKSPACE:-F:/小鲸}"
OWNER_REPO="${SHENJING_OWNER_REPO:-bhfgeeichsolo3047-byte/hana-code-tasks}"
BRANCH="${SHENJING_BRANCH:-life-sync}"
LOG="$HERE/sync.log"

say() { echo "$(date -Iseconds) $*" >> "$LOG"; }

# Windows 上 WindowsApps 里那个 python3 是应用商店的转发壳，跑起来不输出任何东西 ——
# 所以不能只看 command -v，必须真跑一次确认它能干活。
PY=""
for c in python python3 py; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'print(1)' 2>/dev/null | grep -q 1; then PY="$c"; break; fi
done
if [ -z "$PY" ]; then say "失败：找不到能用的 python"; exit 1; fi

TOKEN=$("$PY" "$HERE/token.py" 2>/dev/null)
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

# 档案本体
rm -rf "$REPO/shenjing"
mkdir -p "$REPO/shenjing"
cp -a "$ARCH/." "$REPO/shenjing/"

# 插件源码：复活时要重装的几份（不含 node_modules，到那头会重新链）
rm -rf "$REPO/code"
mkdir -p "$REPO/code"
for p in shenjing-life shenjing-preset persona-life; do
  if [ -d "$WORKSPACE/$p" ]; then
    mkdir -p "$REPO/code/$p"
    tar -C "$WORKSPACE/$p" --exclude=node_modules --exclude=.venv -cf - . | tar -C "$REPO/code/$p" -xf -
  fi
done
mkdir -p "$REPO/code/life-sync"
for f in run.sh daemon.sh token.py; do
  [ -f "$HERE/$f" ] && cp -a "$HERE/$f" "$REPO/code/life-sync/$f"
done

# profile 配置：package.json + 补丁层，用来重建 profile
rm -rf "$REPO/config"
for prof in desktop headless; do
  mkdir -p "$REPO/config/profiles/$prof"
  for f in package.json cordis.patch.yml cordis.yml pnpm-lock.yaml pnpm-workspace.yaml; do
    [ -f "$DSH_HOME/profiles/$prof/$f" ] && cp -a "$DSH_HOME/profiles/$prof/$f" "$REPO/config/profiles/$prof/$f"
  done
done

# 生理系统的状态（不含日志）
rm -rf "$REPO/life"
mkdir -p "$REPO/life"
for f in clock.json state.json mind.json changelog.md; do
  [ -f "$LIFE/$f" ] && cp -a "$LIFE/$f" "$REPO/life/$f"
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
  echo '{"ok":true,"changed":true,"sha":"'"$SHA"'","at":"'"$(date -Iseconds)"'"}' > "$HERE/last-run.json"
else
  say "推送失败"
  echo '{"ok":false,"at":"'"$(date -Iseconds)"'"}' > "$HERE/last-run.json"
  exit 1
fi
