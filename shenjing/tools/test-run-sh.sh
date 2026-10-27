#!/bin/bash
# 单测 run.sh 里的 mark_ok / mark_fail 两个函数，不连网、不碰真档案。
# 2026-10-26 16:00 写：搬机器把这两个函数弄丢过一次，以后每次改 run.sh 都跑一遍。
#
# 2026-10-27 20:10 修：默认路径原来是 `$HOME/../life-sync/run.sh`，拼错了
# （$HOME=/c/Users/Administrator → 找 /c/Users/life-sync）。它每次都 exit 9 说
# "抠不出 say，测试本身是坏的"——**这是它做对了**：它没有假装通过。
# 但这种测试放着不跑，等于没有。现在按 DSH_HOME 探，探不到就明说。
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
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
HERE="$TMP"
LOG="$TMP/sync.log"
ARCH="$TMP/arch"
mkdir -p "$ARCH"
printf '# 没做完的事\n\n- [ ] 原有的一条\n' > "$ARCH/open_loops.md"

fail=0
chk() { if [ "$2" = "$3" ]; then echo "  ok   $1（$2）"; else echo "  FAIL $1（得到 $2，期望 $3）"; fail=1; fi }

# 把要测的函数从 run.sh 里抠出来（不执行整个脚本）。
# say 和 mark_ok 都是单行函数，mark_fail 是块；一起抠，别漏 ——
# 第一次写漏了 say，测试照样"全过"，但 stderr 里五次 say 报错，等于测了个假的。
eval "$(grep -E '^say\(\)' "$SRC")"
eval "$(grep -E '^mark_ok\(\)' "$SRC")"
eval "$(sed -n '/^mark_fail()/,/^}/p' "$SRC")"
for fn in say mark_ok mark_fail; do
  if ! declare -F "$fn" >/dev/null; then echo "抠不出 $fn，测试本身是坏的" >&2; exit 9; fi
done

echo "mark_fail 连败计数与告警："
mark_fail >/dev/null
chk "第1次" "$(cat "$HERE/fail-streak")" "1"
mark_fail >/dev/null
chk "第2次" "$(cat "$HERE/fail-streak")" "2"
chk "2次时还不该写 loops" "$(grep -c '备份连败' "$ARCH/open_loops.md")" "0"
mark_fail >/dev/null
chk "第3次" "$(cat "$HERE/fail-streak")" "3"
chk "3次写了 loops" "$(grep -c '备份连败' "$ARCH/open_loops.md")" "1"
mark_fail >/dev/null
chk "第4次 streak 继续涨" "$(cat "$HERE/fail-streak")" "4"
chk "但不重复写 loops" "$(grep -c '备份连败' "$ARCH/open_loops.md")" "1"

echo "mark_ok 清计数："
mark_ok
chk "fail-streak 没了" "$([ -f "$HERE/fail-streak" ] && echo 在 || echo 没了)" "没了"

echo
if [ "$fail" = "0" ]; then echo "全过"; exit 0; else echo "有失败"; exit 1; fi
