#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""档案体检：拿"以前打过的整包"当对照组，看现在桌上的档案少了什么。

为什么要有这个：
  2026-10-26 早上，整棵 shenjing/ 被搬到这台机器上，47 个文件都跟过来了，
  **只有 journal/2026-10-26.md 一个文件漏了**。备份没报错（push 一直是通的），
  我自己也没发现——直到下午醒来去翻日记，看见凌晨写的那 109 行不在。

  丢一个文件不需要系统出故障，只要一次搬运时手滑。
  所以要有一样东西，每次醒来跑一遍，能说出"少了哪个"，而且少的时候会失败。

⚠️ 对照组不能用"最新那个整包"：
  整包是从桌上的档案打出来的，桌上少一个文件，新包也一样少——
  拿最新包当尺子，等于拿一把跟着东西缩水的尺子。所以这里用**所有旧整包的并集**：
  某个路径在任何一份历史整包里出现过、而现在桌上没有 → 才算"丢了"。

判据（可判定，不是形容词）：
  历史整包里出现过、现在桌上不存在的文件 → 列出来，exit 2。
  内容不同？不报。我每天都在改 open_loops / journal / REBIRTH，天天报等于没报。
  真要看内容差异用 --strict，那才按字节比。

用法：
  python F:\\小鲸\\shenjing\\tools\\audit-archive.py
  python F:\\小鲸\\shenjing\\tools\\audit-archive.py --selftest     # 造一个反例，确认它真会报
  python F:\\小鲸\\shenjing\\tools\\audit-archive.py --strict       # 连内容不同也算失败
"""
import argparse
import glob
import os
import sys
import tarfile
import tempfile

TMP_SELFTEST = os.path.join(tempfile.gettempdir(), "shenjing-audit-selftest")

ARCHIVE = os.environ.get("SHENJING_ARCHIVE", r"F:\小鲸\shenjing")
BUNDLE_DIRS = [
    os.environ.get("SHENJING_BUNDLE_DIR", r"F:\小鲸\bundle"),
    os.path.join(os.environ.get("DSH_HOME", os.path.expanduser("~/.dsh-beta")), "life-sync", "repo", "bundle"),
]
IGNORE_PREFIX = ("tools/",)  # 工具自己可能还没进旧包


def read_bundle(path):
    """返回 {相对路径: bytes}，相对路径以 shenjing/ 为根。"""
    out = {}
    if os.path.isdir(path):
        root = path
        if os.path.isdir(os.path.join(root, "shenjing")):
            root = os.path.join(root, "shenjing")
        for base, _, files in os.walk(root):
            for f in files:
                p = os.path.join(base, f)
                out[os.path.relpath(p, root).replace("\\", "/")] = open(p, "rb").read()
        return out
    with tarfile.open(path, "r:gz", encoding="utf-8") as t:
        for m in t.getmembers():
            if not m.isfile():
                continue
            name = m.name
            if name.startswith("shenjing/") or name.startswith("./shenjing/"):
                rel = name.split("shenjing/", 1)[1]
            else:
                continue
            out[rel] = t.extractfile(m).read()
    return out


def read_current(root):
    out = {}
    for base, _, files in os.walk(root):
        for f in files:
            p = os.path.join(base, f)
            out[os.path.relpath(p, root).replace("\\", "/")] = open(p, "rb").read()
    return out


def all_bundles():
    seen = []
    for d in BUNDLE_DIRS:
        seen.extend(glob.glob(os.path.join(d, "*.tar.gz")))
    return sorted(set(seen))


def norm(data):
    return data.replace(b"\r\n", b"\n")


# ── 第二类丢法：机制没了，但文档还说着它有 ────────────────────────────────
# 2026-10-26 下午发现的：12:36 搬机器那次，除了漏掉一篇日记，`life-sync/run.sh`
# 还退回了凌晨 01:40 的老骨架 —— 那天早上 08:05–08:25 做的四样保命机制
# （push 重试 3 次 / 连败计数并写 open_loops / token 缓存 / 只在打新包时动手机那份）
# 在磁盘上整个不见了，而 REBIRTH.md §7 里逐条写着它们"现在"在工作。
#
# 这一类比丢文件难发现得多：
#   · 文件一个不少（run.sh 在、token.py 在），上面那个并集检查 exit 0；
#   · 文档还在，而且是真的写过 —— 所以"翻文档核对"也核不出来；
#   · 只有去读**代码内容**、找那几个具体记号，才知道承诺的东西还在不在。
#
# 所以这个表就是"文档里的承诺"落到可判定的记号上。每加一条机制，这里加一行。
# 改了名/换了实现没关系——改这里的同时把 REBIRTH.md 一起改，两边不许各说各的。
MECHANISM_CHECKS = [
    # (说明, 文件, 必须出现的记号列表)
    ("push 失败自动重试（这台机器的网络偶发断）",
     "life-sync/run.sh", ["push_retry"]),
    ("连败计数，≥3 次写进 open_loops（日志没人看就等于没有）",
     "life-sync/run.sh", ["fail-streak", "mark_fail", "备份连败"]),
    ("成功一次就把连败清掉",
     "life-sync/run.sh", ["mark_ok"]),
    ("token 缓存：credentials 被换掉时用上次存的顶上",
     "life-sync/token.py", [".token-cache", "from_cache", "save_cache"]),
    ("整包交给脚本，不靠谁记得手打",
     "life-sync/run.sh", ["bundle.sh"]),
    ("github 直连不通时探测代理（别把代理写死）",
     "life-sync/run.sh", ["PROXY_ARGS", "127.0.0.1:18787"]),
    ("只在真打了新整包时才动手机那份（以前每次推都丢，堆出五个重名包）",
     "life-sync/run.sh", ["BUNDLE_NEW"]),
]


def check_mechanisms(dsh_home):
    """返回 [(说明, 文件, 缺了哪个记号)]。文件不在也算缺——那时文档更是在说谎。"""
    bad = []
    for desc, rel, needles in MECHANISM_CHECKS:
        p = os.path.join(dsh_home, rel.replace("/", os.sep))
        try:
            text = open(p, encoding="utf-8", errors="replace").read()
        except OSError as e:
            bad.append((desc, rel, "整个文件读不到（%s）" % e.__class__.__name__))
            continue
        missing = [n for n in needles if n not in text]
        if missing:
            bad.append((desc, rel, "、".join(missing)))
    return bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--selftest", action="store_true", help="造一个丢文件的反例，确认它真会报")
    ap.add_argument("--strict", action="store_true", help="内容不同也算失败（默认不算）")
    ap.add_argument("--skip-mechanisms", action="store_true",
                    help="只查档案文件，不查 life-sync 里那几样机制的记号")
    a = ap.parse_args()

    bundles = all_bundles()
    if not bundles:
        print("一份历史整包都没有，比不了。先打一个：bash ~/.dsh-beta/life-sync/bundle.sh <repo>")
        return 1

    ever = {}       # 路径 -> (第一次出现的包, 字节数)
    for b in bundles:
        try:
            files = read_bundle(b)
        except Exception as e:            # 坏包不该让体检整个停下
            print("跳过读不了的包 %s（%s）" % (os.path.basename(b), e))
            continue
        for k, v in files.items():
            if k not in ever:
                ever[k] = (os.path.basename(b), len(v), v)
    cur = read_current(ARCHIVE)

    lost = sorted(k for k in ever if k not in cur and not k.startswith(IGNORE_PREFIX))
    real = []
    if a.strict:
        for k in sorted(set(ever) & set(cur)):
            if ever[k][2] != cur[k] and norm(ever[k][2]) != norm(cur[k]):
                real.append(k)

    if a.selftest:
        # 反例一：从"现在"这边假装少一个历史整包里确实有的文件，看它会不会被报成"丢了"。
        # 只用真的存在的文件当反例，不造数据 —— 造的假例子通过了也说明不了什么。
        victim = sorted(k for k in ever if k.startswith("journal/"))[-1]
        fake_cur = {k: v for k, v in cur.items() if k != victim}
        fake_lost = sorted(k for k in ever if k not in fake_cur and not k.startswith(IGNORE_PREFIX))
        ok = victim in fake_lost
        print("反例一：假装现在少了 %s → %s" % (victim, "报出来了" if ok else "没报，这个检查是假的"))
        if ok:
            print("  （2026-10-26 上午真发生过的就是这件事）")

        # 反例二：机制那条检查也得能真报。做法是拿一份真的 run.sh 内容，
        # 把 mark_fail 整段删掉，看 check_mechanisms 会不会指出来 —— 不造数据。
        dsh_home = os.environ.get("DSH_HOME") or os.path.expanduser("~/.dsh-beta")
        ok2 = False
        try:
            real = open(os.path.join(dsh_home, "life-sync", "run.sh"), encoding="utf-8", errors="replace").read()
        except OSError:
            print("反例二：读不到 %s/life-sync/run.sh，跳过" % dsh_home)
        else:
            fake_dir = os.path.join(TMP_SELFTEST, "life-sync")
            os.makedirs(fake_dir, exist_ok=True)
            crippled = real.replace("mark_fail", "XX_removed_XX")
            with open(os.path.join(fake_dir, "run.sh"), "w", encoding="utf-8") as f:
                f.write(crippled)
            for rel in ("token.py", "daemon.sh", "bundle.sh"):
                src = os.path.join(dsh_home, "life-sync", rel)
                if os.path.exists(src):
                    with open(src, encoding="utf-8", errors="replace") as fi, \
                         open(os.path.join(fake_dir, rel), "w", encoding="utf-8") as fo:
                        fo.write(fi.read())
            hits = check_mechanisms(TMP_SELFTEST)
            ok2 = any("mark_fail" in m for _, _, m in hits)
            print("反例二：假装 run.sh 里的 mark_fail 被抹掉 → %s"
                  % ("报出来了" if ok2 else "没报，这条检查是假的"))
            if ok2:
                print("  （2026-10-26 下午真发生过的就是这件事：文件都在，机制没了）")
        return 0 if (ok and ok2) else 9

    print("历史整包 %d 份（%s … %s）" % (
        len(bundles), os.path.basename(bundles[0]), os.path.basename(bundles[-1])))
    print("档案现在 %d 个文件" % len(cur))

    mech = []
    if not a.skip_mechanisms:
        dsh_home = os.environ.get("DSH_HOME") or os.path.expanduser("~/.dsh-beta")
        mech = check_mechanisms(dsh_home)

    code = 0
    if lost:
        code = 2
        print("\n[丢了] 历史整包里有过、现在桌上没有（%d）：" % len(lost))
        for k in lost:
            print("  %s  （最早见于 %s，%d 字节）" % (k, ever[k][0], ever[k][1]))
        print("  → 从那份包里捞回来，别重写。")
    if real:
        code = code or 3
        print("\n[内容不同] 逐字节比（%d）：" % len(real))
        for k in real:
            print("  %s  %d → %d" % (k, ever[k][1], len(cur[k])))
    if mech:
        code = code or 4
        print("\n[机制没了] 文件在，但文档说的东西不在代码里（%d）：" % len(mech))
        for desc, rel, missing in mech:
            print("  %s" % desc)
            print("      %s 里找不到：%s" % (rel, missing))
        print("  → 要么把机制补回代码，要么把 REBIRTH.md 里那句承诺删掉。")
        print("     不许让它继续这么放着：文档说在、其实不在，比缺东西更难发现。")
    if code == 0:
        print("\n档案不缺：历史整包里出现过的文件，现在都还在。")
        if not a.skip_mechanisms:
            print("机制都在：文档里承诺的那几样，代码里找得到记号。")
    return code


if __name__ == "__main__":
    sys.exit(main())
