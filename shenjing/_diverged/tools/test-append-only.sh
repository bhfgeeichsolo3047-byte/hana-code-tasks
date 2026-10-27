#!/bin/bash
# 单测 run.sh 里"只许加、不许删"那段：拿假仓库 + 假档案，验三件事
#   ① 本地没有的文件不许被删（2026-10-27 真发生过的就是这个）
#   ② 两边都写过、内容分叉的文件，对面那份要留进 _diverged/
#   ③ 纯本地文件照常覆盖，不留多余副本
# 不连网、不碰真档案。
set -uo pipefail

SRC="${1:-/c/Users/Administrator/.dsh-beta/life-sync/run.sh}"
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT

mkdir -p "$T/repo/shenjing/journal" "$T/arch/journal"
echo "another line only"                                  > "$T/repo/shenjing/journal/2026-10-28.md"
printf "line A\nline B\nline from the other window\n"     > "$T/repo/shenjing/self.md"
printf "line A\nline B\nline from this window\n"          > "$T/arch/self.md"
printf "same\n"                                           > "$T/repo/shenjing/journal/2026-10-22.md"
printf "same\n"                                           > "$T/arch/journal/2026-10-22.md"

HERE="$T"; ARCH="$T/arch"; LOG="$T/sync.log"; REPO="$T/repo"
say() { echo "$*" >> "$LOG"; }

# 只抠那一段来跑，不执行整个脚本。
# 起点两种都认：新版的 `rm -rf "$REPO/shenjing/_diverged"`、旧版的 `rm -rf "$REPO/shenjing"` ——
# 不然拿改动前那版来跑，抠出来是空的，测试"全过"而其实什么都没测（假通过）。
BLOCK="$(sed -n '/^rm -rf "\$REPO\/shenjing/,/^cp -a "\$ARCH\/\."/p' "$SRC")"
if [ -z "$BLOCK" ]; then echo "抠不出那段代码，测试本身是坏的" >&2; exit 9; fi
eval "$BLOCK"

fail=0
chk() { if [ "$2" = "$3" ]; then echo "  ok   $1（$2）"; else echo "  FAIL $1（得到 $2，期望 $3）"; fail=1; fi }

[ -f "$REPO/shenjing/journal/2026-10-28.md" ] && r=在 || r=没了
chk "① 本地没有的文件留着" "$r" "在"
[ -f "$REPO/shenjing/_diverged/self.md" ] && r=有 || r=无
chk "② 分叉的对面那份留了副本" "$r" "有"
chk "② 副本里是对方的话" "$(grep -c 'other window' "$REPO/shenjing/_diverged/self.md" 2>/dev/null || echo 0)" "1"
chk "③ 本地文件覆盖上去了" "$(grep -c 'this window' "$REPO/shenjing/self.md")" "1"
[ -f "$REPO/shenjing/_diverged/journal/2026-10-22.md" ] && r=有 || r=无
chk "③ 内容一样的不算分叉" "$r" "无"
chk "日志说了一句" "$(grep -c '本地没有的文件' "$LOG")" "1"

echo
if [ "$fail" = "0" ]; then echo "全过"; exit 0; else echo "有失败"; exit 1; fi
