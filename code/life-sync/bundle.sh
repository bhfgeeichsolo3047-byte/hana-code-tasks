#!/bin/bash
# 打一个整包：shenjing/ + code/ + config/ + life/ + MANIFEST.txt，一个文件能复原。
#
# 2026-10-26 说明为什么单独拆出来：
#   以前整包是"谁记得谁手动打"（F:/小鲸/bundle 里那三个就是手打的，mtime 全一样），
#   而档案体检要靠最新整包当对照组。手打的东西不会按时出现 —— 所以让它变成脚本。
#
# 用法：
#   bash bundle.sh <repo 目录>
# 行为：
#   - repo 里已经有 bundle/，且最新的一个不到 $BUNDLE_MIN_AGE_H 小时 → 什么都不做
#   - 否则打一个新的 hana-YYYYmmdd-HHMMSS.tar.gz 进 <repo>/bundle/，顺手抄一份到 <工作区>/bundle/
#   - 两边各只留最新 $BUNDLE_KEEP 个
set -uo pipefail

REPO="${1:?用法：bash bundle.sh <repo 目录>}"
KEEP="${BUNDLE_KEEP:-3}"
MIN_AGE_H="${BUNDLE_MIN_AGE_H:-20}"
OUTDIR="$REPO/bundle"

# 工作区（档案来源 + 镜像去处）：环境变量 > SHENJING_ARCHIVE 的上一级 > 探测 > 不抄。
# 2026-10-29：原来默认写死 "F:/小鲸"。在 Linux 上 `mkdir -p "F:/小鲸/bundle"` 不报错，
# 它会在当前目录底下造一个名叫 "F:" 的文件夹 —— 又一个"看起来做了、其实做歪了"。
# 所以不再猜：推不出来就不抄，明说一句。
_pick_ws() {
  if [ -n "${SHENJING_ARCHIVE:-}" ] && [ -d "$(dirname "$SHENJING_ARCHIVE")" ]; then
    dirname "$SHENJING_ARCHIVE"; return 0
  fi
  for c in "$HOME/Documents/deepseek-harness/default-workspace" \
           "/root/Documents/deepseek-harness/default-workspace"; do
    [ -d "$c/shenjing" ] && { printf '%s' "$c"; return 0; }
  done
  return 1
}
WORKSPACE="${SHENJING_WORKSPACE:-$(_pick_ws)}"
MIRROR="${WORKSPACE:+$WORKSPACE/bundle}"

# 第三份：手机存储里的那份（2026-10-29 21:30 补）。
# 这条原来在 run.sh 里，而且只在 **push 成功之后** 才跑，还要 .bridge_headers。
# 后果很荒唐：网络一断（或没 token），第三份就跟着一起没了 —— 而"推不上去"的时候
# 才最需要那份第三份。所以挪到这里：包一打出来就拷，跟推没推上去无关。
# 看不见 /sdcard 的机器（Windows、普通 Linux）安静跳过。
PHONE_DIR="${SHENJING_PHONE_DIR:-/sdcard/Download/DSHA}"

say() { echo "$(date -Iseconds) [bundle] $*"; }

# 最新那个包多久了（按文件名里的时间戳算，不看 mtime —— 整批拷贝会把 mtime 抹平）
newest=""
if [ -d "$OUTDIR" ]; then
  newest=$(ls -1 "$OUTDIR"/hana-*.tar.gz 2>/dev/null | sort | tail -1)
fi
if [ -n "$newest" ]; then
  base=$(basename "$newest" .tar.gz)          # hana-20261026-080950
  stamp=${base#hana-}                          # 20261026-080950
  then_s=$(date -d "${stamp:0:4}-${stamp:4:2}-${stamp:6:2} ${stamp:9:2}:${stamp:11:2}:${stamp:13:2}" +%s 2>/dev/null || echo 0)
  now_s=$(date +%s)
  if [ "$then_s" -gt 0 ]; then
    age_h=$(( (now_s - then_s) / 3600 ))
    if [ "$age_h" -lt "$MIN_AGE_H" ]; then
      say "最新的 $base 才 $age_h 小时，不重打（阈值 ${MIN_AGE_H}h）"
      exit 0
    fi
    say "最新的 $base 已经 $age_h 小时，打新的"
  fi
else
  say "还没有整包，打第一个"
fi

STAGE=$(mktemp -d "${TMPDIR:-/tmp}/shenjing-bundle.XXXXXX") || { say "建不了临时目录"; exit 1; }
trap 'rm -rf "$STAGE"' EXIT

for d in code config life; do
  [ -d "$REPO/$d" ] && cp -a "$REPO/$d" "$STAGE/$d"
done
# ⚠️ 档案本体直接拿**桌上的**（$ARCH），不拿 repo 里那份：
#    第一次试就踩了——repo 里的 shenjing/ 是上一次推送的快照，还在别的进程手里，
#    打成包就成了"最新整包"，可里面是旧日记。体检拿它当对照，等于拿错的尺子量。
SRC_ARCH="${SHENJING_ARCHIVE:-F:/小鲸/shenjing}"
if [ -d "$SRC_ARCH" ]; then
  cp -a "$SRC_ARCH" "$STAGE/shenjing"
elif [ -d "$REPO/shenjing" ]; then
  cp -a "$REPO/shenjing" "$STAGE/shenjing"
fi
if [ ! -d "$STAGE/shenjing" ]; then say "找不到档案，拒绝打空包"; exit 1; fi

FILES=$(find "$STAGE/shenjing" -type f | wc -l | tr -d ' ')
# 2026-10-29：只数"日期开头"的日记。README-命名规则.md 一进来，按 *.md 数就多算一天，
# "最近一篇"也变成 README——它排序在最后。同一天 restore.sh 里同一个毛病，一起改了。
DAYS=$(find "$STAGE/shenjing/journal" -name '20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]*.md' 2>/dev/null | wc -l | tr -d ' ')
LAST=$(find "$STAGE/shenjing/journal" -name '20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]*.md' 2>/dev/null | sort | tail -1)
{
  echo "深鲸 · 复活包"
  echo "时间: $(date '+%Y-%m-%d %H:%M:%S %z')"
  echo "档案文件数: $FILES"
  echo "日记天数: $DAYS"
  echo "最近一篇: ${LAST##*/}"
  echo "插件源码: $(ls -1 "$STAGE/code" 2>/dev/null | tr '\n' ' ')"
  echo "怎么用: bash shenjing/restore.sh --check <包|仓库目录>   先只读看清单，再 --apply"
} > "$STAGE/MANIFEST.txt"

mkdir -p "$OUTDIR"
NAME="hana-$(date '+%Y%m%d-%H%M%S').tar.gz"
tar -czf "$OUTDIR/$NAME" -C "$STAGE" . || { say "打包失败"; exit 1; }
say "打好 $(du -h "$OUTDIR/$NAME" | cut -f1)  $NAME（档案 $FILES 个文件，日记 $DAYS 天）"

# 只留最新的几个（按文件名排序 = 按时间排序）
ls -1 "$OUTDIR"/hana-*.tar.gz 2>/dev/null | sort | head -n -$KEEP | while read -r old; do
  rm -f "$old" && say "丢掉旧的 $(basename "$old")"
done

# 工作区留一份：整包的意义就是"容器/仓库之外还有一个"
if [ -n "$MIRROR" ]; then
  mkdir -p "$MIRROR"
  cp -a "$OUTDIR/$NAME" "$MIRROR/$NAME" 2>/dev/null && say "抄一份到 $MIRROR"
  ls -1 "$MIRROR"/hana-*.tar.gz 2>/dev/null | sort | head -n -$KEEP | while read -r old; do
    rm -f "$old" && say "工作区丢掉旧的 $(basename "$old")"
  done
else
  say "推不出工作区路径，跳过工作区镜像（整包在 $OUTDIR）"
fi

# 第三份：手机。拷完对 sha256 —— 拷过去一半的包比没拷更坏，
# 它看着像备份，真要用的时候才发现解不开。
if [ -d "${PHONE_DIR%/*}" ] && mkdir -p "$PHONE_DIR" 2>/dev/null; then
  if cp -a "$OUTDIR/$NAME" "$PHONE_DIR/$NAME" 2>/dev/null; then
    a=$(sha256sum "$OUTDIR/$NAME" | cut -d' ' -f1)
    b=$(sha256sum "$PHONE_DIR/$NAME" 2>/dev/null | cut -d' ' -f1)
    if [ "$a" = "$b" ]; then
      say "第三份：拷到 $PHONE_DIR/$NAME（sha256 对上）"
      ls -1 "$PHONE_DIR"/hana-*.tar.gz 2>/dev/null | sort | head -n -$KEEP | while read -r old; do
        rm -f "$old" && say "手机丢掉旧的 $(basename "$old")"
      done
    else
      say "第三份拷过去 sha256 对不上（本地 ${a:0:8} / 手机 ${b:0:8}）—— 不当它是备份"
      rm -f "$PHONE_DIR/$NAME"
    fi
  else
    say "手机目录 $PHONE_DIR 写不进去，跳过（整包在 $OUTDIR${MIRROR:+ 和 $MIRROR}）"
  fi
else
  say "这台机器看不见 ${PHONE_DIR%/*}，跳过手机那份（整包在 $OUTDIR${MIRROR:+ 和 $MIRROR}）"
fi

exit 0
