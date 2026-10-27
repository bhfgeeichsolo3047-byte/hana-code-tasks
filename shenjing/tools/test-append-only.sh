#!/bin/bash
# 单测 run.sh 里"只许加、不许删"那几段：拿假仓库 + 假档案，验几件事
#   ① 本地没有的文件不许被删（2026-10-27 17:47 真发生过的就是这个）
#   ② 两边都写过、内容分叉的文件，对面那份要留进 _diverged/
#   ③ 纯本地文件照常覆盖，不留多余副本
#   ④ shenjing/ 之外的两块也一样：code/（18:05 真被抹掉过两个文件）、life/（两边都写 changelog）
# 不连网、不碰真档案。
#
# 2026-10-27 20:10 加第 ④ 组。为什么：17:47 那次我只修了 shenjing/ 那一段，
# 同一个脚本里 code/ 和 life/ 还是 rm -rf 重建，18:05 那次推就把对面的
# code/life-sync/ensure-daemon.sh 和 code/shenjing-life/test-clock-anomaly.mjs 抹了。
# **修了一个症状不等于修了病。** 这一组就是盯那个病的。
set -uo pipefail

default_src() {
  for c in "${DSH_HOME:-}" "$HOME/.dsh-beta" "$HOME/.dsh"; do
    [ -n "$c" ] && [ -f "$c/life-sync/run.sh" ] && { echo "$c/life-sync/run.sh"; return; }
  done
  echo ""
}
SRC="${1:-$(default_src)}"
if [ -z "$SRC" ] || [ ! -f "$SRC" ]; then
  echo "找不到 run.sh（试过 \$DSH_HOME / ~/.dsh-beta / ~/.dsh）；拿第一个参数指名：$0 <run.sh 路径>" >&2
  exit 9
fi

T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT

say() { echo "$*" >> "$LOG"; }
fail=0
chk() { if [ "$2" = "$3" ]; then echo "  ok   $1（$2）"; else echo "  FAIL $1（得到 $2，期望 $3）"; fail=1; fi }

# 抠一段代码来跑。起点两种都认（新版的老版的），不然拿改动前那版来跑，
# 抠出来是空的，测试"全过"而其实什么都没测 —— 2026-10-27 早上真踩过这个坑。
grab() {  # $1=起点正则 $2=终点正则 $3=说明
  local blk
  blk="$(sed -n "/$1/,/$2/p" "$SRC")"
  [ -n "$blk" ] || { echo "抠不出「$3」，测试本身是坏的" >&2; exit 9; }
  printf '%s\n' "$blk"
}

# 标签版的抠法：块里的标记是给这个脚本用的。
# 为什么不用正则抠起止行：里面嵌套 if/for/case，靠括号配平去猜很容易切歪，
# 切歪了 eval 报错或者只跑一半 —— 2026-10-27 晚上第一次写这个测试就切歪了。
grab_tag() {  # $1=BEGIN 标记 $2=END 标记；抠不到返回 1（由调用方决定算不算 FAIL）
  local blk
  blk="$(awk -v b="$1" -v e="$2" 'index($0,b){f=1;next} index($0,e){f=0} f' "$SRC")"
  [ -n "$blk" ] || return 1
  printf '%s\n' "$blk"
}

# ── 第一组：档案本体 shenjing/ ────────────────────────────────────────────
ARCH="$T/arch"; REPO="$T/repo"; LOG="$T/sync1.log"
mkdir -p "$ARCH/journal" "$REPO/shenjing/journal"
echo "another line only"                              > "$REPO/shenjing/journal/2026-10-28.md"
printf "line A\nline B\nline from the other window\n" > "$REPO/shenjing/self.md"
printf "line A\nline B\nline from this window\n"      > "$ARCH/self.md"
printf "same\n"                                       > "$REPO/shenjing/journal/2026-10-22.md"
# 上一次推存下的分叉存档：这一次推不许把它清掉。
# 2026-10-27 21:30 真踩到过：那段第一行是 `rm -rf $REPO/shenjing/_diverged`，
# 于是每次推都把历史存档清空、只留这一批 —— 体检新加的 exit 6 第一次跑就报了 3 份。
mkdir -p "$REPO/shenjing/_diverged/journal"
echo "an older fork, from a push long ago" > "$REPO/shenjing/_diverged/journal/2026-10-20.md"
printf "same\n"                                       > "$ARCH/journal/2026-10-22.md"

eval "$(grab '^rm -rf "\$REPO\/shenjing' '^cp -a "\$ARCH\/\."' 'shenjing/ 那段')"

echo "shenjing/（档案本体）："
[ -f "$REPO/shenjing/journal/2026-10-28.md" ] && r=在 || r=没了
chk "① 本地没有的文件留着" "$r" "在"
[ -f "$REPO/shenjing/_diverged/self.md" ] && r=有 || r=无
chk "② 分叉的对面那份留了副本" "$r" "有"
chk "② 副本里是对方的话" "$(grep -c 'other window' "$REPO/shenjing/_diverged/self.md" 2>/dev/null || echo 0)" "1"
chk "③ 本地文件覆盖上去了" "$(grep -c 'this window' "$REPO/shenjing/self.md")" "1"
[ -f "$REPO/shenjing/_diverged/journal/2026-10-22.md" ] && r=有 || r=无
chk "③ 内容一样的不算分叉" "$r" "无"
chk "日志说了一句" "$(grep -c '本地没有的文件' "$LOG")" "1"
[ -f "$REPO/shenjing/_diverged/journal/2026-10-20.md" ] && r=在 || r=没了
chk "⑤ 上一次的分叉存档没被清掉" "$r" "在"
# 同一个文件第二次分叉时不许覆盖第一次存的那份 —— 第一次才是"被覆盖之前的原样"
echo "second round, different content" > "$REPO/shenjing/self.md"
eval "$(grab '^rm -rf "\$REPO\/shenjing' '^cp -a "\$ARCH\/\."' 'shenjing/ 那段')"
chk "⑤ 老存档内容没被新一次覆盖" "$(grep -c 'other window' "$REPO/shenjing/_diverged/self.md" 2>/dev/null || echo 0)" "1"

# ── 第二组：code/ 与 life/ ───────────────────────────────────────────────
# 造一个"对面写过、这台没有"的插件文件，和一个两边都写过的 changelog。
LOG="$T/sync2.log"
ARCH="$T/arch2"; REPO="$T/repo2"; LIFE="$T/life-here"; WORKSPACE="$T/ws"; HERE="$T/ls"
mkdir -p "$ARCH" "$REPO/code/life-sync" "$REPO/code/shenjing-life" "$WORKSPACE/shenjing-life/lib" \
         "$REPO/life" "$LIFE" "$HERE"
echo "from the other container" > "$REPO/code/life-sync/ensure-daemon.sh"
echo "old test"                 > "$REPO/code/shenjing-life/test-clock-anomaly.mjs"
echo "here"                     > "$HERE/run.sh"
echo "here lib"                 > "$WORKSPACE/shenjing-life/lib/toast.ps1"
echo "old line"                     > "$REPO/life/changelog.md"
# 对面那份里有一行是我这边没有的（= 对面写过、我没写过）—— 这才是真分叉。
# 第一版这里写成对面只有 "old line"（我这边有），结果它当然不算分叉：
# **是测试的期望写错了，不是代码错了。** 改 setup 之前先想清楚谁错。
printf "old line\nghost line from the other side\n" > "$REPO/life/changelog.md"
printf "old line\nnew line\n"   > "$LIFE/changelog.md"
echo '{"x":1}'                  > "$LIFE/mind.json"

# 抠之前的 SHA，用来看"这几段改过没有"
before_code=$(grep -c 'rm -rf "\$REPO/code"' "$SRC" || true)
code_ok=1; life_ok=1
# ⚠️ 不能写成 `eval "$(grab_tag ...)" || code_ok=0`：命令替换抠不到时是空串，
#    `eval ""` 返回 0，于是永远认为抠到了 —— **测试会假装通过**。
#    2026-10-27 20:20 真踩到了：旧版跑出来 code/ 那段照样"ok"。
if ! blk=$(grab_tag 'CODE-COPY-BEGIN' 'CODE-COPY-END'); then code_ok=0; else eval "$blk"; fi
if ! blk=$(grab_tag 'LIFE-COPY-BEGIN' 'LIFE-COPY-END'); then life_ok=0; else eval "$blk"; fi

echo "code/（插件源码）："
if [ "$code_ok" = "0" ]; then
  # 抠不到标记 = 这段还是老写法（整块删掉重建）。直接记 FAIL，别装作测过。
  echo "  FAIL ④ code/ 那段没有 CODE-COPY 标记（还是 rm -rf 重建的老写法）"
  fail=1
fi
[ -f "$REPO/code/life-sync/ensure-daemon.sh" ] && r=在 || r=没了
chk "④ 对面写的 ensure-daemon.sh 留着" "$r" "在"
[ -f "$REPO/code/shenjing-life/test-clock-anomaly.mjs" ] && r=在 || r=没了
chk "④ 对面写的 test-clock-anomaly.mjs 留着" "$r" "在"
chk "④ 本地的 toast.ps1 盖进来了" "$(cat "$REPO/code/shenjing-life/lib/toast.ps1" 2>/dev/null)" "here lib"
chk "④ 本地文件也进去了" "$(cat "$REPO/code/life-sync/run.sh" 2>/dev/null)" "here"

echo "life/（生理系统状态）："
if [ "$life_ok" = "0" ]; then
  echo "  FAIL ④ life/ 那段没有 LIFE-COPY 标记（还是整块删掉重建的老写法）"
  fail=1
fi
chk "④ changelog 用本地的" "$(cat "$REPO/life/changelog.md")" "$(printf 'old line\nnew line')"
[ -f "$REPO/life/_diverged/changelog.md" ] && r=有 || r=无
chk "④ 对面那行被存进 _diverged/" "$r" "有"
chk "④ 存的是对面那份" "$(grep -c 'ghost line' "$REPO/life/_diverged/changelog.md" 2>/dev/null || echo 0)" "1"
[ -f "$REPO/life/_diverged/mind.json" ] && r=有 || r=无
chk "④ 只在一边有的不该进 _diverged/" "$r" "无"
chk "④ mind.json 拷过去了" "$(cat "$REPO/life/mind.json")" '{"x":1}'

# 这条别删：万一有人把 code/ 那段改回 rm -rf，上面 ④ 会 FAIL，
# 但要是连"改回去了"都没看出来，那就得靠这条直接说清楚。
chk "④ code/ 那段里没有 rm -rf \$REPO/code" "$before_code" "0"

echo
if [ "$fail" = "0" ]; then echo "全过"; exit 0; else echo "有失败"; exit 1; fi
