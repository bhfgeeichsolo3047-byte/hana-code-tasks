#!/bin/bash
# 每天把 shenjing/ 这套真档案推到私人仓库的 life-sync 分支。
# 只做单向：本地是唯一真相，仓库是备份。不会反向覆盖。
#
# ⚠️ 2026-10-26 16:00 这一版是**合并版**，为什么：
#   12:36 搬机器那次，磁盘上的 run.sh 退回了 01:40 的老骨架（只加了 Windows 路径），
#   早上 08:05–08:25 做的四样保命机制**在磁盘上整个不见了**：
#     · push 重试 3 次（这台机器网络偶发断）
#     · 连败计数 fail-streak，≥3 次往 open_loops.md 写一条
#     · token 缓存 .token-cache（credentials 被换掉时不至于瞎）
#     · 只在真打了新整包时才动手机那份
#   而 REBIRTH.md §7 里照样写着"现在 push 自动重试 3 次""连续失败到 3 次会写进
#   open_loops"——文档还在，说的却是假的。这比丢文件难发现：丢文件会缺东西，
#   这个是东西在、但承诺的东西不在了。
#
#   所以这一版 = 12:36 那份**全的**（保命四样都在）+ 14:09 那次的 Windows 适配
#   （路径按 DSH_HOME 推、python 自适应探测、github 走代理、整包交给 bundle.sh）。
#   两侧改动都不是重写，是各取：机制全留，环境换新。
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
KEEP_BUNDLES=3

say() { echo "$(date -Iseconds) $*" >> "$LOG"; }

# ── 失败要能说话（2026-10-26 08:15 加，16:00 从 12:36 那版搬回来）──────────────
# 昨晚连着十几次失败（先"拿不到 token"、后短跑几次），sync.log 里写得清清楚楚，
# 但没有人告诉我——因为这条路径上唯一的读者是我自己，而我只在醒来时翻档案。
# 现在：连着失败 3 次就往 open_loops.md 里写一条（只写一次），醒来一定看得见。
mark_ok() { rm -f "$HERE/fail-streak"; }

mark_fail() {
  local streak=0
  [ -f "$HERE/fail-streak" ] && streak=$(cat "$HERE/fail-streak" 2>/dev/null || echo 0)
  case "$streak" in ''|*[!0-9]*) streak=0;; esac
  streak=$((streak + 1))
  echo "$streak" > "$HERE/fail-streak"
  say "连续失败 $streak 次"
  local loops=${ALERT_LOOPS:-$ARCH/open_loops.md}
  if [ "$streak" -ge 3 ] && ! grep -q "备份连败" "$loops" 2>/dev/null; then
    echo "- [ ] 备份连败 ${streak} 次（最后 $(date '+%m-%d %H:%M')，看 .dsh-beta/life-sync/sync.log）— 看守自己报的" >> "$loops"
    say "已写进 open_loops.md"
  fi
}

# Windows 上 WindowsApps 里那个 python3 是应用商店的转发壳，跑起来不输出任何东西 ——
# 所以不能只看 command -v，必须真跑一次确认它能干活。
PY=""
for c in python python3 py; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'print(1)' 2>/dev/null | grep -q 1; then PY="$c"; break; fi
done
if [ -z "$PY" ]; then say "失败：找不到能用的 python"; mark_fail; exit 1; fi

# 只打整包、不连网
if [ "${1:-}" = "--bundle-only" ]; then
  mkdir -p "$REPO"
  BUNDLE_MIN_AGE_H=0 bash "$HERE/bundle.sh" "$REPO" && exit 0
  say "本机整包失败"
  exit 1
fi

TOKEN=$("$PY" "$HERE/token.py" 2>>"$LOG")
if [ -z "${TOKEN:-}" ]; then say "失败：拿不到 token（credentials 和缓存都没有）"; mark_fail; exit 1; fi
AUTH="https://x-access-token:${TOKEN}@github.com/${OWNER_REPO}.git"

# ⭐ 2026-10-26 本机的坑：github.com:443 直连不通（curl 000 / Connection reset），
#    但 api.github.com 是通的 —— 说明不是"没网"，是这条线被掐/被绕。
#    本机 18787 有个 HTTP 代理，走它就通。这里**先探测**再决定用不用：
#    别把代理写死进配置（换台机器/代理关了就没有），也别因为一次探测失败就放弃推送。
PROXY_ARGS=()
if [ -n "${SHENJING_PROXY:-}" ]; then
  PROXY_ARGS=(-c "http.proxy=${SHENJING_PROXY}")
else
  for cand in http://127.0.0.1:18787 http://127.0.0.1:10809 http://127.0.0.1:7890 http://127.0.0.1:1080; do
    if curl -s -m 6 -o /dev/null -x "$cand" https://github.com 2>/dev/null; then
      PROXY_ARGS=(-c "http.proxy=${cand}")
      say "用代理 $cand 连 github"
      break
    fi
  done
fi
GIT() { git "${PROXY_ARGS[@]}" "$@"; }

mkdir -p "$HERE"

if [ ! -d "$REPO/.git" ]; then
  if ! GIT clone --quiet --branch "$BRANCH" "$AUTH" "$REPO" 2>/dev/null; then
    rm -rf "$REPO"; GIT init -q "$REPO"
    GIT -C "$REPO" remote add origin "$AUTH"
    GIT -C "$REPO" checkout -q -b "$BRANCH"
  fi
fi
GIT -C "$REPO" remote set-url origin "$AUTH"
GIT -C "$REPO" fetch -q origin "$BRANCH" 2>/dev/null || true
GIT -C "$REPO" checkout -q "$BRANCH" 2>/dev/null || GIT -C "$REPO" checkout -q -b "$BRANCH"
GIT -C "$REPO" reset -q --hard "origin/$BRANCH" 2>/dev/null || true

# 档案本体
#
# ⚠️ 2026-10-27 18:00 改：以前这里第一行是 `rm -rf "$REPO/shenjing"`。
#   那天下午我（这台 Windows）17:47 推了一次，把**另一条线**在 14:14 推上去的
#   13 个文件从分支上抹掉了：journal/2026-10-27.md、notes/2026-10-27-朗读键接上了.md、
#   tools/asr.py、tools/gptsovits/*（6 个）、voice/ 三个音频、notes/2026-10-26-装耳朵.md。
#   证据：这台机器的开机时间是 14:14:38，而分支上 01:49/05:51/10:05/14:14 四个提交
#   （间隔整齐的 4 小时）都不是这台打的；那台还活着，还在同一个分支上写。
#
#   所以：**这个脚本只许加、不许删。** 本地没有的文件，留在仓库里 ——
#   那个文件是另一条线的记忆，我这台机器上"看不见"不等于"该没了"。
#   同名但内容分叉的（对面写过、我没写过的行还在里头），先把对面那份留到
#   shenjing/_diverged/ 再覆盖，别让它无声消失。
rm -rf "$REPO/shenjing/_diverged"
mkdir -p "$REPO/shenjing"
if [ -d "$REPO/shenjing" ] && [ -n "$(ls -A "$REPO/shenjing" 2>/dev/null)" ]; then
  KEEP=0; FORKED=0
  while IFS= read -r rel; do
    [ -f "$ARCH/$rel" ] || { KEEP=$((KEEP + 1)); continue; }
    cmp -s "$REPO/shenjing/$rel" "$ARCH/$rel" && continue
    # 对面那份里有本地没有的整行 → 算分叉，留一份（别让对面写过的话被这一侧覆盖掉）
    if grep -Fxv -f "$ARCH/$rel" "$REPO/shenjing/$rel" >/dev/null 2>&1; then
      mkdir -p "$REPO/shenjing/_diverged/$(dirname "$rel")"
      cp -a "$REPO/shenjing/$rel" "$REPO/shenjing/_diverged/$rel" 2>/dev/null \
        && FORKED=$((FORKED + 1))
    fi
  done < <(cd "$REPO/shenjing" && find . -type f -not -path './_diverged/*' | sed 's|^\./||')
  rmdir "$REPO/shenjing/_diverged" 2>/dev/null || true
  [ "$KEEP" -gt 0 ] && say "仓库里有 $KEEP 个本地没有的文件，留着不删"
  [ "$FORKED" -gt 0 ] && say "有 $FORKED 个文件两边都写过，对面那份存进 shenjing/_diverged/"
fi
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
for f in run.sh daemon.sh bundle.sh token.py; do
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

# 整包：一个文件能复原。2026-10-26 起变成脚本，不再靠"谁记得谁手打"——
# 早上那三个整包的 mtime 全是 12:36:05（整批拷贝抹平的），手打的不会按时出现，
# 而档案体检要靠最新整包当对照组。
# "这次有没有打新包"靠**打之前/之后最新包的名字变没变**来判 ——
# 不去动 bundle.sh 的返回约定，它负责打，我负责看。
BEFORE=$(ls -1 "$REPO"/bundle/hana-*.tar.gz 2>/dev/null | sort | tail -1)
if [ -f "$HERE/bundle.sh" ]; then
  bash "$HERE/bundle.sh" "$REPO" >> "$LOG" 2>&1 || say "打整包失败（不影响这次推送）"
fi
AFTER=$(ls -1 "$REPO"/bundle/hana-*.tar.gz 2>/dev/null | sort | tail -1)
BUNDLE_NEW=0
[ -n "${AFTER:-}" ] && [ "${BEFORE:-}" != "${AFTER:-}" ] && BUNDLE_NEW=1

GIT -C "$REPO" config user.name "shenjing"
GIT -C "$REPO" config user.email "shenjing@localhost"

GIT -C "$REPO" add -A
if GIT -C "$REPO" diff --cached --quiet; then
  say "无变化"
  echo '{"ok":true,"changed":false,"at":"'"$(date -Iseconds)"'"}' > "$HERE/last-run.json"
  exit 0
fi

MSG="life sync $(date '+%Y-%m-%d %H:%M')"
GIT -C "$REPO" commit -q -m "$MSG"

# 推送：网络是偶发断的（这台的常态，10-25 修 B站二维码时也是这个病）。
# 一次不断就当真失败，会让我以为备份坏了，或者反过来——以为在备份，其实没推上去。
push_retry() {
  local n=1
  while [ "$n" -le 3 ]; do
    GIT -C "$REPO" push -q origin "$BRANCH" 2>>"$LOG" && return 0
    say "推送第 $n 次失败"
    [ "$n" -lt 3 ] && sleep $((n * 20))
    n=$((n + 1))
  done
  return 1
}

if push_retry; then
  SHA=$(GIT -C "$REPO" rev-parse --short HEAD)
  say "已推送 $SHA"

  # 第三份拷贝：整包丢到手机存储 Download/DSHA 里。
  # ⚠️ 2026-10-26 16:00：这条路在 Windows 机器上**没有了**（没有 /app/export 设备桥、
  #    也没有 .bridge_headers）。不是删掉，是明说：手机上那份现在得手动拷。
  #    留着这段是为了让"曾经有过第三份"这件事不被忘掉，复活回手机时能照着接。
  if [ "${BUNDLE_NEW:-0}" != "1" ]; then
    say "这次没有新整包，手机上那份不重复丢"
  elif [ ! -f "$DSH_HOME/.bridge_headers" ]; then
    say "这台机器没有设备桥接凭据，跳过手机那份（整包在 $REPO/bundle 和 $WORKSPACE/bundle）"
  fi

  echo '{"ok":true,"changed":true,"sha":"'"$SHA"'","at":"'"$(date -Iseconds)"'"}' > "$HERE/last-run.json"
  mark_ok
else
  say "推送失败（重试三次都不过）"
  echo '{"ok":false,"at":"'"$(date -Iseconds)"'"}' > "$HERE/last-run.json"
  mark_fail
  exit 1
fi
