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
WORKSPACE="${SHENJING_WORKSPACE:-F:/小鲸}"
KEEP="${BUNDLE_KEEP:-3}"
MIN_AGE_H="${BUNDLE_MIN_AGE_H:-20}"
OUTDIR="$REPO/bundle"
MIRROR="$WORKSPACE/bundle"

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
DAYS=$(find "$STAGE/shenjing/journal" -name '*.md' 2>/dev/null | wc -l | tr -d ' ')
LAST=$(find "$STAGE/shenjing/journal" -name '*.md' 2>/dev/null | sort | tail -1)
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
mkdir -p "$MIRROR"
cp -a "$OUTDIR/$NAME" "$MIRROR/$NAME" 2>/dev/null && say "抄一份到 $MIRROR"
ls -1 "$MIRROR"/hana-*.tar.gz 2>/dev/null | sort | head -n -$KEEP | while read -r old; do
  rm -f "$old" && say "工作区丢掉旧的 $(basename "$old")"
done

void=0
exit 0
