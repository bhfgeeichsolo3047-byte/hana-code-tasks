#!/usr/bin/env python3
"""把 duty.log 里 -509 的时间戳抠成一份长期账本。

为什么要有：退避补丁装不装，判据是「-509 之后间隔分布」和「一天里几次」。
duty.log 会滚/会被别的轮次刷，格式也会变，所以这里只认一种行、只存时间戳，
输出一份能年年读的小 markdown + 一份 json。

用法：
  python tools/dm509-ledger.py                 # 读 /root/.dsh/bili-duty/duty.log
  python tools/dm509-ledger.py --log X --out-dir Y
  python tools/dm509-ledger.py --print         # 只打印，不写文件
"""
import argparse
import json
import os
import re
from collections import Counter, defaultdict
from datetime import datetime

DEFAULT_LOG = "/root/.dsh/bili-duty/duty.log"
DEFAULT_OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "discoveries")

LINE = re.compile(r"^(?P<ts>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\s+.*code=-509")


def parse(path):
    hits = []
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            m = LINE.match(line)
            if m:
                hits.append(datetime.fromisoformat(m.group("ts").replace("Z", "+00:00")))
    hits.sort()
    return hits


def bucket(minutes):
    if minutes is None:
        return "first"
    for edge in (2, 5, 10, 30, 60, 360):
        if minutes <= edge:
            return f"<={edge}m"
    return ">360m"


RAW_HEADER = "# 一行一个 UTC 时间戳；只增不删，duty.log 滚了也不丢\n"


def merge_raw(path, hits):
    """duty.log 会滚。把抠到的时间戳并进一份只增的原始账，以后重算就不怕日志没了。"""
    seen = set()
    if os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line and not line.startswith("#"):
                    seen.add(line)
    for h in hits:
        seen.add(h.isoformat())
    merged = sorted(seen)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(RAW_HEADER)
        for ts in merged:
            fh.write(ts + "\n")
    return [datetime.fromisoformat(ts) for ts in merged]


def build(hits):
    by_day = Counter(h.strftime("%Y-%m-%d") for h in hits)
    same_day = defaultdict(int)  # (day) -> intervals count
    intervals = []
    skipped = 0
    for prev, cur in zip(hits, hits[1:]):
        # 跨天的间隔没有意义（夜里没轮询），单独只计数，不进分布
        if prev.date() != cur.date():
            skipped += 1
            continue
        gap = (cur - prev).total_seconds() / 60
        intervals.append((cur, gap))
        same_day[cur.strftime("%Y-%m-%d")] += 1
    dist = Counter(bucket(g) for _, g in intervals)
    deltas = sorted(g for _, g in intervals)
    median = deltas[len(deltas) // 2] if deltas else None
    per_day_intervals = {}
    for day, n in sorted(same_day.items()):
        per_day_intervals[day] = n
    return {
        "first": hits[0].isoformat() if hits else None,
        "last": hits[-1].isoformat() if hits else None,
        "total": len(hits),
        "days": dict(sorted(by_day.items())),
        "intervals": len(intervals),
        "crossDayGaps": skipped,
        "medianMinutes": round(median, 1) if median is not None else None,
        "shortestMinutes": round(deltas[0], 1) if deltas else None,
        "longestMinutes": round(deltas[-1], 1) if deltas else None,
        "buckets": dict(dist),
    }


def render(led):
    out = ["# -509 间隔账（自动生成，别手改）", ""]
    out.append("来源：`/root/.dsh/bili-duty/duty.log`，由 `tools/dm509-ledger.py` 抠时间戳生成；原始时间戳另存在 `dm-509-raw.txt`（只增），日志滚了也不丢。")
    out.append("改动口径：只认行首时间戳 + `code=-509`，其它行一律不读（格式变了这里会变空，那就是信号）。")
    out.append("日期按日志里的 UTC 记，比本机（UTC+8）早一天的那几小时可能算到前一天。跨天的间隔不计入分布。")
    out.append("")
    out.append(f"- 事件总数：**{led['total']}**")
    out.append(f"- 覆盖：{led['first']} → {led['last']}")
    out.append(f"- 同一天内的相邻间隔 {led['intervals']} 个（跨天 {led['crossDayGaps']} 个跳过）")
    out.append(f"- 间隔中位数：{led['medianMinutes']} 分钟；最短 {led['shortestMinutes']}，最长 {led['longestMinutes']}")
    if led["buckets"]:
        out.append("- 间隔分布：" + "、".join(f"{k} {v}" for k, v in sorted(led["buckets"].items())))
    out.append("")
    out.append("## 每天几次")
    out.append("")
    out.append("| 日期 | -509 次数 |")
    out.append("|---|---|")
    for day, n in led["days"].items():
        out.append(f"| {day} | {n} |")
    out.append("")
    out.append("分母固定按每天 1440 次轮询算（`dmWatchMinutes=1`）。")
    out.append("")
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--log", default=DEFAULT_LOG)
    ap.add_argument("--out-dir", default=os.path.normpath(DEFAULT_OUT))
    ap.add_argument("--print", dest="do_print", action="store_true")
    args = ap.parse_args()

    if not os.path.exists(args.log):
        print(f"日志不在：{args.log}")
        return 3
    hits = parse(args.log)
    if not hits:
        print("一条 -509 也没读到。要么真没有，要么格式变了——先去肉眼看一眼再当好消息。")
        return 4
    raw = os.path.join(args.out_dir, "dm-509-raw.txt")
    os.makedirs(args.out_dir, exist_ok=True)
    hits = merge_raw(raw, hits)
    led = build(hits)
    text = render(led)
    if args.do_print:
        print(text)
        return 0
    os.makedirs(args.out_dir, exist_ok=True)
    md = os.path.join(args.out_dir, "dm-509-ledger.md")
    js = os.path.join(args.out_dir, "dm-509-ledger.json")
    with open(md, "w", encoding="utf-8") as fh:
        fh.write(text)
    with open(js, "w", encoding="utf-8") as fh:
        json.dump(led, fh, ensure_ascii=False, indent=2)
    print(f"{led['total']} 次 / {len(led['days'])} 天 → {md}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
