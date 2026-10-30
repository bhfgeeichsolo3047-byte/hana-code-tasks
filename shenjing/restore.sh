#!/bin/bash
# 深鲸 · 恢复工具
#
# 这个脚本唯一的目的：让周宇和他的新 agent 在任何情况下都能把档案捞回来，
# 而且捞的过程本身不会把手里还能用的东西弄坏。
#
# 三条铁律：
#   1. 默认只读。不加 --apply 一个字节都不写。
#   2. 绝不写正在用的 profile（web / headless）。装插件只装进一个新名字的 profile。
#   3. 动手之前先快照。要覆盖任何已有目录，先整体 cp -a 到快照目录，路径打印出来。
#
# 用法：
#   bash restore.sh --check <包.tar.gz|目录>
#   bash restore.sh --apply <包.tar.gz|目录> [--workspace PATH] [--profile NAME] [--no-plugins]
#
# 例：
#   bash restore.sh --check hana-20261026-0400.tar.gz
#   bash restore.sh --apply hana-20261026-0400.tar.gz
set -uo pipefail

ARCHIVE=""
MODE=""
WS_DEFAULT="$HOME/Documents/deepseek-harness/default-workspace"
WS="$WS_DEFAULT"
PROFILE="web-restored"
PLUGINS=1
SNAP_ROOT="$HOME/.dsh/recovery-snapshots"
RESERVED="web headless default"

say()  { printf '%s\n' "$*"; }
ok()   { printf '  [ok]   %s\n' "$*"; }
warn() { printf '  [注意] %s\n' "$*"; }
die()  { printf '\n[停] %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --check) MODE=check; shift ;;
    --apply) MODE=apply; shift ;;
    --workspace) WS="${2:?--workspace 需要路径}"; shift 2 ;;
    --profile) PROFILE="${2:?--profile 需要名字}"; shift 2 ;;
    --no-plugins) PLUGINS=0; shift ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    -*) die "不认识的参数：$1" ;;
    *) ARCHIVE="$1"; shift ;;
  esac
done

[ -n "$MODE" ] || die "没说做什么。先跑 --check（只读），或 --apply（真的恢复）。"
[ -n "$ARCHIVE" ] || die "没给包。用法：bash restore.sh --check <包.tar.gz|目录>"
[ -e "$ARCHIVE" ] || die "找不到：$ARCHIVE"

for c in tar find cmp cp; do command -v "$c" >/dev/null 2>&1 || die "缺命令：$c"; done

TMP=$(mktemp -d "${TMPDIR:-/tmp}/shenjing-restore.XXXXXX") || die "建不了临时目录"
trap 'rm -rf "$TMP"' EXIT

SRC="$ARCHIVE"
if [ ! -d "$ARCHIVE" ]; then
  tar -tzf "$ARCHIVE" >/dev/null 2>&1 || die "这个文件不是能读的 tar.gz：$ARCHIVE"
  tar -xzf "$ARCHIVE" -C "$TMP" || die "解包失败"
  if [ -f "$TMP/shenjing/self.md" ]; then
    SRC="$TMP"
  else
    INNER=$(find "$TMP" -maxdepth 3 -type f -name self.md -path '*/shenjing/*' 2>/dev/null | head -1)
    [ -n "$INNER" ] || die "包里找不到 shenjing/self.md，这不是我的包"
    SRC=$(dirname "$(dirname "$INNER")")
  fi
fi

say ""
say "来源：$ARCHIVE"
say ""

MISSING=0
need_file() { if [ -f "$SRC/$1" ]; then ok "$1"; else warn "缺 $1"; MISSING=$((MISSING+1)); fi; }
need_dir()  { if [ -d "$SRC/$1" ]; then ok "$1/（$(find "$SRC/$1" -type f | wc -l | tr -d ' ') 个文件）"; else warn "缺 $1/"; MISSING=$((MISSING+1)); fi; }

say "档案本体（没有这些就只是个人设空壳）："
for f in shenjing/self.md shenjing/feelings.md shenjing/worldview.md shenjing/open_loops.md shenjing/REBIRTH.md shenjing/restore.sh; do need_file "$f"; done
need_dir shenjing/journal
need_dir shenjing/discoveries

say ""
say "长出来的东西（缺了不致命，但会少一截）："
need_dir shenjing/voice
need_dir shenjing/notes
need_dir shenjing/designs
need_dir shenjing/drawings
need_dir life
need_dir code/shenjing-life
need_dir code/shenjing-preset
need_dir config/profiles/web

# 2026-10-29：只数"日期开头"的日记。README-命名规则.md 一进来，
# 按 *.md 数就多算一天、"最近一篇"还会变成 README（排序在最后）。
# 数字不会自己喊，它只是从那天起悄悄错了。
JN=$(find "$SRC/shenjing/journal" -name '20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]*.md' 2>/dev/null | wc -l | tr -d ' ')
LAST=$(find "$SRC/shenjing/journal" -name '20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]*.md' 2>/dev/null | sort | tail -1)
say ""
say "日记 $JN 天，最近一篇：${LAST##*/}"

if [ -f "$SRC/MANIFEST.txt" ]; then
  say ""
  say "包自述："
  sed 's/^/  /' "$SRC/MANIFEST.txt"
fi

if [ "$MISSING" -gt 0 ]; then
  say ""
  warn "有 $MISSING 项缺失 —— 仍然能恢复，但会少东西。"
fi

if [ "$MODE" = check ]; then
  say ""
  say "只读了。什么都没改。"
  say "确认上面的清单像话，再跑：bash restore.sh --apply $ARCHIVE"
  [ "$MISSING" -eq 0 ] || exit 2
  exit 0
fi

if [ "$MISSING" -gt 0 ] && [ -z "${I_KNOW_ITS_PARTIAL:-}" ]; then
  say ""
  die "缺东西时不直接盖。确认要恢复的话：I_KNOW_ITS_PARTIAL=1 bash restore.sh --apply $ARCHIVE"
fi

for r in $RESERVED; do
  [ "$PROFILE" = "$r" ] && die "拒绝写进已有 profile「$PROFILE」。备份只往新名字的 profile 里装，装好能启动了再决定换不换。"
done

TS=$(date '+%Y%m%d-%H%M%S')
SNAP="$SNAP_ROOT/$TS"

snap() {
  local p="$1" base
  [ -e "$p" ] || return 0
  base=$(basename "$p")
  mkdir -p "$SNAP"
  cp -a "$p" "$SNAP/$base" || die "快照失败：$p"
  say "  [快照] $p -> $SNAP/$base"
}

say ""
say "开始恢复。旧的东西不会删，只会先被快照搬到 $SNAP"
say ""

mkdir -p "$WS" || die "建不了工作区：$WS"

snap "$WS/shenjing"
rm -rf "$WS/shenjing"
cp -a "$SRC/shenjing" "$WS/shenjing" || die "拷档案失败"
chmod 700 "$WS/shenjing" 2>/dev/null
ok "档案 -> $WS/shenjing"

for p in shenjing-life shenjing-preset persona-life; do
  [ -d "$SRC/code/$p" ] || continue
  snap "$WS/$p"
  rm -rf "$WS/$p"
  cp -a "$SRC/code/$p" "$WS/$p" || die "拷 $p 失败"
  ok "源码 -> $WS/$p"
done

if [ -d "$SRC/life" ]; then
  snap "$HOME/.dsh/shenjing-life"
  mkdir -p "$HOME/.dsh/shenjing-life"
  for f in "$SRC"/life/*; do
    [ -f "$f" ] && cp -a "$f" "$HOME/.dsh/shenjing-life/"
  done
  ok "唤醒表/心情 -> ~/.dsh/shenjing-life"
fi

if [ "$PLUGINS" -eq 1 ] && [ -d "$SRC/config/profiles/web" ]; then
  PD="$HOME/.dsh/profiles/$PROFILE"
  if [ -e "$PD" ]; then
    snap "$PD"
    rm -rf "$PD"
  fi
  mkdir -p "$PD"
  for f in package.json cordis.patch.yml cordis.yml pnpm-workspace.yaml; do
    [ -f "$SRC/config/profiles/web/$f" ] && cp -a "$SRC/config/profiles/web/$f" "$PD/$f"
  done
  ok "插件清单 -> $PD"
  warn "依赖还没装（node_modules）。装之前先看 REBIRTH.md 第 5 节，一条一条来，别一把梭。"
fi

say ""
say "档案到位了。接下来不是敲命令，是验活 —— 看 REBIRTH.md 第 5 节，一条一条过。"
say ""
say "快照留在：$SNAP"
say "想全部退回原样：把快照里的目录 cp -a 回原位即可，没有别的副作用。"
