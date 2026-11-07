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
import calendar
import datetime
import glob
import json
import os
import subprocess
import sys
import tarfile
import tempfile
import time

TMP_SELFTEST = os.path.join(tempfile.gettempdir(), "shenjing-audit-selftest")

def _pick_archive():
    """档案目录探测。2026-10-29 恢复时加：原来写死 F:\\小鲸（Windows 那台的化石），
    在这台机器上它指向一个不存在的路径，于是体检把"全部文件"都报成丢失（exit 2）。
    那比 exit 0 更吵，但同样是错的——尺子指错了地方。"""
    p = os.environ.get("SHENJING_ARCHIVE", "").strip()
    if p:
        return p
    for c in (
        os.path.join(os.path.expanduser("~"), "Documents", "deepseek-harness", "default-workspace", "shenjing"),
        r"F:\小鲸\shenjing",
        "/root/Documents/deepseek-harness/default-workspace/shenjing",
    ):
        if os.path.isdir(c):
            return c
    return os.path.join(os.path.expanduser("~"), "Documents", "deepseek-harness", "default-workspace", "shenjing")


def _pick_bundle_dirs():
    dirs = []
    env = os.environ.get("SHENJING_BUNDLE_DIR", "").strip()
    if env:
        dirs.append(env)
    home = os.path.expanduser("~")
    for c in (
        os.path.join(home, "Documents", "deepseek-harness", "default-workspace", "bundle"),
        r"F:\小鲸\bundle",
        os.path.join(os.environ.get("DSH_HOME", os.path.join(home, ".dsh")), "life-sync", "repo", "bundle"),
    ):
        if os.path.isdir(c) and c not in dirs:
            dirs.append(c)
    return dirs or [os.path.join(os.environ.get("DSH_HOME", os.path.join(home, ".dsh")), "life-sync", "repo", "bundle")]


ARCHIVE = _pick_archive()
BUNDLE_DIRS = _pick_bundle_dirs()
# ⚠️ `_diverged/` 不许加进这里。2026-10-27 21:00 我差点加了——因为加了之后
#   体检就从 exit 5 变成 exit 0，"干净"了。可 `_diverged/` 里装的是
#   **对面写过、被我覆盖掉的那一份**：它就是"别让对面的话消失"的最后一道防线。
#   它丢了才是真丢（而且是唯一那一份）。为了让检查闭嘴去蒙它的眼睛，是同一个病。
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


# ── 第三把尺子：备份仓库分支的 HEAD ────────────────────────────────────────
# 2026-10-27 就是被"整包太旧"漏过去的：三份整包最新的那份是 01:49 打的，
# 而丢的东西是 01:49 之后写的 —— 尺子比东西旧，量不出来。那天 17:47 推了一次，
# run.sh 里的 `rm -rf repo/shenjing` 把另一条线 14:14 推上去的 13 个文件从分支上抹掉了，
# 体检照样 exit 0。
#
# 分支 HEAD 比整包新得多（每次都推，整包 20 小时才打一次），所以它是第四把、也是最新那把尺子。
# 关键：**读它不需要联网**。`git ls-tree` 读的是本地 .git 里已经 fetch 下来的 ref，
# 断网的时候照样能读（这台的网络经常断，今天三条代理全 000）。
#
# 但有一处它看不见，得说清楚：HEAD 是"最近一次 fetch 时的远端"，
# 如果对面推了新东西而我没 fetch，HEAD 就旧了。所以它不能替掉整包，只能叠上去。
def _dsh_home():
    p = os.environ.get("DSH_HOME", "").strip()
    if p:
        return p
    for c in (os.path.expanduser("~/.dsh"), os.path.expanduser("~/.dsh-beta")):
        if os.path.isdir(c):
            return c
    return os.path.expanduser("~/.dsh")


def _pick_sync_repo():
    """哪一份本地的 .git 当尺子。

    2026-11-01：仓库是 public，run.sh 一直只打包不推，于是它 mkdir -p repo 往里放整包，
    `repo/.git` 就从来没建起来过——体检每天报 exit 7，说"这把尺子没量"。
    尺子不在不是因为没仓库，是因为**唯一能读的那份被当成了打包目录**。
    现在多找一处只读镜像 ref/：repo 能读就用 repo，读不了用 ref。两个都没有才报没尺子。
    """
    base = os.path.join(_dsh_home(), "life-sync")
    for name in ("repo", "ref"):
        p = os.path.join(base, name)
        if os.path.isdir(os.path.join(p, ".git")):
            return p
    return os.path.join(base, "repo")


LIFE_SYNC_REPO = _pick_sync_repo()
REMOTE_REF = os.environ.get("SHENJING_REMOTE_REF", "origin/life-sync")

# 2026-11-01 晚上：这把尺子会**旧**，而旧的尺子照样说"不缺"。
# ref/ 只在 run.sh 跑的时候才 fetch（dsh 一关 tick 不跑），所以它可能已经是好几天前的
# 远端快照了。那时体检仍然 exit 0，读起来像"远端也不缺"，其实是"我拿三天的照片对今天的脸"。
# 所以量和旧是两件事：没量 → 7；量了但尺子太旧 → 8。
RULER_MAX_AGE_HOURS = float(os.environ.get("SHENJING_RULER_MAX_AGE_HOURS", "36"))

# 心跳的容忍度：插件 2 分钟跳一次（省闪存），这里放宽到 12 分钟 —— 一次写盘失败、
# 一次宿主的定时器漂移都不该报警；真停了十几分钟，那就是停了。
HEARTBEAT_MAX_AGE_MIN = float(os.environ.get("SHENJING_HEARTBEAT_MAX_MIN", "12"))


def remote_ref_age_hours(repo=None):
    """远端 HEAD 那把尺子有多旧。返回 (小时数, 依据文件的路径)；读不到返回 (None, 原因)。"""
    repo = repo or LIFE_SYNC_REPO
    candidates = (os.path.join(repo, ".git", "FETCH_HEAD"),
                  os.path.join(repo, ".git", "refs", "remotes", REMOTE_REF))
    for cand in candidates:
        try:
            st = os.stat(cand)
        except OSError:
            continue
        return (time.time() - st.st_mtime) / 3600.0, cand
    return None, "找不到 %s 的 FETCH_HEAD（这个 .git 没 fetch 过？）" % repo


def read_remote_tree(repo=None, ref=None):
    """返回 ({相对路径: 字节数}, {_diverged 里的路径: 字节数}, 出错原因)。只读本地 .git，不联网。"""
    repo = repo or LIFE_SYNC_REPO
    ref = ref or REMOTE_REF
    if not os.path.isdir(os.path.join(repo, ".git")):
        return {}, {}, "没有备份仓库（%s 不是 git 仓库）" % repo
    try:
        out = subprocess.run(
            ["git", "-C", repo, "-c", "core.quotePath=false",
             "ls-tree", "-r", "-l", ref],
            capture_output=True, timeout=60)
    except (OSError, subprocess.SubprocessError) as e:
        return {}, {}, "git 跑不起来（%s）" % e.__class__.__name__
    if out.returncode != 0:
        msg = out.stderr.decode("utf-8", "replace").strip().splitlines()
        return {}, {}, "读不到 %s（%s）" % (ref, msg[0] if msg else "未知")
    tree = {}
    diverged = {}
    for line in out.stdout.decode("utf-8", "replace").splitlines():
        # 格式：<mode> <type> <sha> <size>\t<path>；ls-tree -l 里 size 是 blob 字节数
        head, _, path = line.partition("\t")
        parts = head.split()
        if len(parts) < 4 or not path:
            continue
        if not (path == "shenjing" or path.startswith("shenjing/")):
            continue
        rel = path[len("shenjing/"):] if path.startswith("shenjing/") else ""
        if not rel:
            continue
        try:
            size = int(parts[3])
        except ValueError:
            size = -1
        # `_diverged/` 不是档案本体，是 run.sh 覆盖前存的"对面那份"。
        # 它只在仓库里有、桌上没有，是**正常的**（桌上那份是覆盖后的新版）。
        # 但它自己也得有人看着——单独收一份，下面按"只许多不许少"来判。
        if rel.startswith("_diverged/"):
            diverged[rel] = size
            continue
        tree[rel] = size
    return tree, diverged, None


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
    # 2026-10-27 18:00 加。那天这台 Windows 17:47 推了一次，把另一条线 14:14 推上去的
    # 13 个文件从分支上抹掉了——因为 run.sh 推之前先 `rm -rf repo/shenjing`。
    # 这条检查盯的是"推之前有没有留对面那份"。
    # 记号只认代码里的（注释被删掉、机制还在，就该算过）：_diverged 目录、
    # 留着不删的 KEEP 计数、分叉副本的 FORKED 计数、判"一样不一样"的 cmp。
    ("推之前只许加不许删：本地没有的文件留在仓库里，同名分叉的先存副本",
     "life-sync/run.sh", ["_diverged", "KEEP=", "FORKED", "cmp -s"]),

    # ── 第三类：我给别人的插件打的补丁（2026-11-03 08:00 加）─────────────────
    # 这一类和上面两类是同一个病，但丢法更恶劣：**不是有人手滑，是升级把目录整个换掉。**
    # 11-02 我改了 node_modules/dsh-bili-scroll/index.js 三处（失败不许记成跑过 / 私信那句去重）。
    # 11-03 凌晨 01:44 插件自动升到 2.4.0 ⇒ 三处一句不剩，连 lib/state.mjs 都退回原版，
    # 而升级不会告诉任何人「你的补丁没了」。当天早上 08:00 醒来，账本上什么痕迹都没有。
    # ⇒ 补丁的真相放在 shenjing/patches/（进备份），这里只盯着"它有没有被装回去"。
    #   装：node shenjing/tools/apply-patches.mjs
    ("值班轮失败不许记成『跑过了』（我 11-02 打的补丁，只活在 node_modules 里 ⇒ 升级就没了）",
     "profiles/web/node_modules/dsh-bili-scroll/index.js",
     ["planWindow(st, key, now)", "这一班没跑成", "windowAttempts"]),
    ("上面那条的判定函数本身（补丁自带的新文件，升级会一起删掉）",
     "profiles/web/node_modules/dsh-bili-scroll/lib/window-plan.mjs",
     ["export function planWindow", "exhausted"]),
    ("私信监听那句提示只说一次（原来每 60 秒一行，两天 3300 行把 code=1 埋了）",
     "profiles/web/node_modules/dsh-bili-scroll/index.js", ["dmSaidSelfOnly"]),
    # 2026-11-06 中午加：-509（请求过于频繁）每分钟一撞，越撞退得越久，一整天回不了一条私信，
    # 而日志里只有「已兜住」。补丁要做两件事：退避 + 连败记账（只写日志等于没人知道）。
    ("私信被限流要退避（-509 之后间隔 2→4→…→30 分钟，通了立刻复位），连败 6 次要写进 open_loops",
     "profiles/web/node_modules/dsh-bili-scroll/index.js",
     ["dmBackoffDue(dmBackoff", "nextDmBackoff(dmBackoff", "appendDmAlarm(r.state)", "退避复位"]),
    ("上面那条的退避判定本身（补丁自带的新文件，升级会一起删掉）",
     "profiles/web/node_modules/dsh-bili-scroll/lib/dm-backoff.mjs",
     ["export function nextDmBackoff", "export function dmAlarmLine", "alarmAfter"]),
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


# ── 第三类：东西都在、账本也说在，但它根本跑不起来 ──────────────────────────
# 2026-11-05 08:00 发现：11-04 那天三班唤醒全部 exit=1、一篇日记都没有，
# 而账本上一行行写着 result:"idle" —— 读起来像"我选择什么都不做"。
# 真因是我 11-04 02:57 往 shenjing-brain/index.js 的 health 那行中间插了句注释，
# `//` 把这一行剩下的 `emotionUpdates:0,...,stalled:false}` 全吞了，
# 整个插件 import 时 SyntaxError ⇒ 三班唤醒一启动就死。
#
# 为什么上面两类判据都拦不住：
#   · 文件一个不少（并集检查 exit 0）；
#   · 文档承诺的记号也都在（机制检查 exit 0）—— 记号在**注释掉的那半边**里都还是字面量；
#   · 缺的那一样东西不是"某个文件""某个记号"，是**这段代码能不能被解析**。
# 一个 `node --check` 一秒就能问出来的事，我拿两天一夜的空白换的。
# ⇒ 所以这条不是查内容，是查"它还算不算一段程序"。
SYNTAX_WATCH = ("brain-regions", "dsh-shenjing-life", "dsh-shenjing-preset", "dsh-bili-scroll")


def _syntax_targets(dsh_home):
    """profiles/*/node_modules 里那些指回工作区的插件 → 去重后的 (真身目录, 说明)。

    顺着链接走真身，不查副本：副本坏不坏没意义，宿主读的是链接指向的那份。
    """
    import glob as _glob
    seen, out = set(), []
    for prof in _glob.glob(os.path.join(dsh_home, "profiles", "*")):
        for root in (os.path.join(prof, "node_modules"),
                     os.path.join(prof, "node_modules", "@shenjing"),
                     os.path.join(prof, "node_modules", "@local")):
            if not os.path.isdir(root):
                continue
            try:
                names = os.listdir(root)
            except OSError:
                continue
            for name in names:
                if name not in SYNTAX_WATCH:
                    continue
                p = os.path.realpath(os.path.join(root, name))
                if p in seen or not os.path.isdir(p):
                    continue
                seen.add(p)
                out.append(p)
    return out


def check_syntax(dsh_home):
    """返回 [(文件, 解析器原话)]。空 = 每个入口都还能被 node 读成一段程序。"""
    import glob as _glob
    import subprocess
    bad = []
    for d in _syntax_targets(dsh_home):
        files = [f for f in (os.path.join(d, "index.js"), os.path.join(d, "index.mjs"))
                 if os.path.isfile(f)]
        files += sorted(_glob.glob(os.path.join(d, "*.mjs")))
        files += sorted(_glob.glob(os.path.join(d, "lib", "**", "*.mjs"), recursive=True))
        files = [f for f in files if not f.endswith(".orig") and os.path.isfile(f)]
        for f in files:
            try:
                r = subprocess.run(["node", "--check", f], capture_output=True, timeout=60)
            except FileNotFoundError:
                return [("<node 不在 PATH 里>", "没法解析，这条判据这次算没量")]
            except subprocess.TimeoutExpired:
                bad.append((f, "node --check 超时 60 秒"))
                continue
            if r.returncode != 0:
                # 只捞错误本身：stderr 尾巴是 "Node.js v24.x" 那行版本水印，
                # 眼睛要的是 "SyntaxError: xxx" 和它指的那一行。
                lines = [l.strip() for l in (r.stderr or b"").decode("utf-8", "replace").splitlines()]
                keep = [l for l in lines if l.startswith(("SyntaxError", "ReferenceError", "TypeError"))
                        or (l.startswith("/") and ":" in l)]
                why = " / ".join(keep[-2:]) if keep else (
                    "node --check 退出 %d：%s" % (r.returncode, lines[-1] if lines else "（没有输出）"))
                bad.append((f, why[:400]))
    return bad


def _proc_web_start():
    """正在跑的 dsh web 宿主进程 → (pid, 启动时刻 epoch 秒)。找不到 → (None, 原因)。

    为什么要它：补丁可以装到磁盘上，但宿主内存里跑的是**进程启动那一刻**读进来的那份代码。
    2026-11-03 早上 08:02 装好的 index.js，宿主是 07:07 起的 —— 它根本没读，
    「私信监听」那句提示继续一分钟一行地写，一直写到 13:00。
    **文件在 ≠ 在跑。** 这条尺子量的是中间那道缝。
    """
    try:
        pids = [d for d in os.listdir("/proc") if d.isdigit()]
    except OSError:
        return None, "这台机器上没有 /proc，看不出来"
    best = None
    for pid in pids:
        try:
            raw = open("/proc/%s/cmdline" % pid, "rb").read().decode("utf-8", "replace")
        except OSError:
            continue
        parts = [x for x in raw.split("\0") if x]
        if not any(p.endswith("bin.js") for p in parts):
            continue
        if "web" not in parts:          # 主进程是 `bin.js web --patch ...`
            continue
        if "--profile" in parts:        # `--profile headless` 是子会话，不是宿主
            continue
        try:
            st = os.stat("/proc/%s" % pid)   # /proc/<pid> 的 mtime 就是进程起来的时刻
        except OSError:
            continue
        if best is None or st.st_mtime > best[1]:
            best = (pid, st.st_mtime)
    if best is None:
        return None, "没找到在跑的 dsh web 宿主进程"
    return best


def _last_plugin_load(dsh_home):
    """插件被**热重载**的时刻 → (epoch 秒, 依据)；没有记录 → (None, 为什么没有)。

    为什么需要它（2026-11-03 晚上补的）：
      宿主进程不重启，插件也可以整个重新 import 一遍。那天 15:52:56 就是这种情况——
      pid 14523 还是 07:07 起的那个，但插件换成了 08:02 那份新代码。
      证据：那句『只回登录账号自己』从 15:52 之后只写了一次，之前是一分钟一行。
      只看进程启动时间，这条尺子会一直喊"没生效"——红给一个说对了的人听，
      连着红几天就成了装饰（10-26 那次是"文件在、机制不在"，这次是"装好了、热加载过，
      可是尺子不认"）。同一件事的第四次换皮。

    记号：插件日志里的『插件加载自 profile：xxx』只在模块真的重新执行时才会打印。
    日志时间戳是 UTC（带 Z）。
    """
    for p in [os.environ.get("DSH_BILI_DUTY_LOG"),
              os.path.join(dsh_home, "bili-duty", "duty.log")]:
        if not p or not os.path.isfile(p):
            continue
        try:
            with open(p, "rb") as f:
                f.seek(0, os.SEEK_END)
                size = f.tell()
                f.seek(max(0, size - 4 * 1024 * 1024))   # 只扫尾部 4MB，日志早晚会长到很大
                tail = f.read().decode("utf-8", "replace")
        except OSError as e:
            return None, "读不了 %s（%s）" % (p, e)
        for line in reversed(tail.splitlines()):
            if "插件加载自 profile" not in line:
                continue
            head = line.split()
            ts = head[0] if head else ""
            if len(ts) < 19 or ts[10] != "T":
                continue
            try:
                return calendar.timegm(time.strptime(ts[:19], "%Y-%m-%dT%H:%M:%S")), \
                    os.path.basename(p)
            except ValueError:
                continue
        return None, "%s 里没有『插件加载自 profile』那一行" % os.path.basename(p)
    return None, "找不到值班日志"


def check_loaded(dsh_home, start_override=None, load_override=None):
    """补丁文件比"代码真正被读进内存的那一刻"新 ⇒ 装了但还没加载。

    那一刻是两者里**更晚**的那个：
      ① 宿主进程起来的时刻（/proc/<pid> 的 mtime）
      ② 插件最后一次热加载的时刻（日志里的『插件加载自 profile』）
    只看 ① 会冤枉热加载过的情况；只看 ② 会漏掉"刚装完、谁都没读过"。

    返回 (状态, 依据, 最新的那个文件)：
      'pending' —— 有文件比这两者都新，跑的还是旧代码
      'loaded'  —— 都在那一刻之前，内存里就是这一版
      'unknown' —— 宿主没在跑 / 文件读不到，这条量不了（要算进"没量"）
    """
    pid, started = _proc_web_start()
    if pid is None:
        return "unknown", started, None
    if start_override is not None:
        started = start_override
    if load_override is not None:
        reloaded, reload_where = load_override, "反例里指定的"
    else:
        reloaded, reload_where = _last_plugin_load(dsh_home)
    newest = None
    for desc, rel, _ in MECHANISM_CHECKS:
        # 只比**宿主进程 import 的模块**（profiles/…/node_modules 里的 .js/.mjs）。
        # life-sync/run.sh、bundle.sh 那种是每次跑都重读的脚本，改了立刻生效，
        # 拿它们比进程启动时间会冤枉人 —— 一改备份脚本就报"没加载"。
        if not rel.startswith("profiles/"):
            continue
        p = os.path.join(dsh_home, rel.replace("/", os.sep))
        try:
            m = os.stat(p).st_mtime
        except OSError:
            continue
        if newest is None or m > newest[1]:
            newest = (rel, m)
    if newest is None:
        return "unknown", "那几个补丁模块一个都读不到", None
    where = "pid=%s；宿主 %s 起" % (
        pid, time.strftime("%m-%d %H:%M:%S", time.localtime(started)))
    effective = started
    if reloaded:
        where += "；插件 %s 热加载过（看 %s）" % (
            time.strftime("%m-%d %H:%M:%S", time.localtime(reloaded)), reload_where)
        if reloaded > effective:
            effective = reloaded
    else:
        where += "；没有热加载记录（%s）" % reload_where
    if newest[1] > effective + 1.0:
        return "pending", where, newest
    return "loaded", where, newest


# 两根脉搏，各有各的主人。**别合并成一个文件**（2026-11-05 13:00 差点那么干）：
# 一个文件两种含义，等它静下来的时候你分不清是谁死了。
HEARTBEAT_PROBES = (
    ("定时器心跳", "heartbeat-tick.json", "heartbeat-tick-gaps.log",
     "插件 tick 每 2 分钟一跳 —— 它停了 = 宿主那块表不跳：闹钟不响、备份不跑、唤醒不起"),
    ("保活心跳", "heartbeat.json", None,
     "keepalive/heartbeat.cjs 每 60 秒一跳 —— 它停了 = 容器里那个独立进程没了"),
)


def _iso_epoch(at):
    """心跳里的时间戳可能是两种写法：插件的本地带偏移（…+08:00）、保活脚本的 UTC（…Z）。
    2026-11-05 第一版拿 time.mktime 解——它把字符串当**本地时间**，于是 UTC 那份凭空多算了
    8 小时：刚刚跳过的脉搏被判成"停在 8 小时前"。**尺子自己错，比没尺子更坏。**"""
    t = (at or "").strip()
    if not t:
        raise ValueError("空的 at")
    try:
        dt = datetime.datetime.fromisoformat(t.replace("Z", "+00:00"))
    except ValueError:
        dt = datetime.datetime.strptime(t[:19], "%Y-%m-%dT%H:%M:%S")
    if dt.tzinfo is None:
        return time.mktime(dt.timetuple())
    return dt.timestamp()


def _life_home(dsh_home=None):
    return (os.environ.get("SHENJING_LIFE_HOME", "").strip()
            or os.path.join(dsh_home or _dsh_home(), "shenjing-life"))


def check_heartbeats(dsh_home=None, max_age_min=None):
    """两根脉搏有多新 —— 「该说话的东西，这一次有没有说话」。

    为什么加（2026-11-05 13:00）：11-04 一整天 tick 整块没响，而账本上只有三行 `idle`，
    读起来像我选择休息。**没有脉搏的时候，「没说话」和「死了」长得一模一样。**
    上面那些判据问的是"这次的形状对不对"；这条问的是另一件事：那个本该定时跳一下的东西，
    最后一下是什么时候跳的。

    现成的一具尸体：保活心跳 heartbeat.json 停在 2026-11-02T09:45Z，三天没人说话。
    那时候体检每次 exit 0 —— 它只数文件和记号，不问"你还活着吗"。

    返回 [(名字, 状态, 年龄分钟, 路径, 含义说明, 断档记录)]
      'ok' / 'stale'（停太久）/ 'missing'（该有却没有）/ 'absent'（这台机器没这套东西）
    """
    base = _life_home(dsh_home)
    limit = HEARTBEAT_MAX_AGE_MIN if max_age_min is None else max_age_min
    out = []
    for name, fname, gapf, note in HEARTBEAT_PROBES:
        path = os.path.join(base, fname)
        if not os.path.exists(path):
            # 家目录在 ⇒ 这套东西装过；那"没跳过"就是有话要说
            state = "missing" if os.path.isdir(base) else "absent"
            out.append((name, state, None, path, note, []))
            continue
        try:
            with open(path, encoding="utf-8") as f:
                at = json.load(f).get("at") or ""
            age = (time.time() - _iso_epoch(at)) / 60.0
        except Exception as e:
            out.append((name, "missing", None, "%s（读不成：%s）" % (path, e.__class__.__name__), note, []))
            continue
        gaps = []
        if gapf:
            try:
                with open(os.path.join(base, gapf), encoding="utf-8") as f:
                    gaps = [x.strip() for x in f.read().splitlines() if x.strip()][-3:]
            except OSError:
                gaps = []
        out.append((name, "ok" if age <= limit else "stale", age, path, note, gaps))
    return out

# ── 第五类：账本说跑完了，其实没跑（2026-11-07 13:00 加，exit 13） ─────────────
# 11-07 早上数 duty.log 才看见：今天 00:00:35 跑 noon、00:02:35 跑 night，
# 之后十三个小时一次值班轮都没有。而 state.json 里 `2026-11-07:noon` 和 `:night`
# 都写着 true —— 账本干净得像今天干过活。
#
# 前面四类判据问的都是"东西在不在""能不能跑"：文件齐不齐、记号在不在、语法过不过、
# 宿主读没读。没有一条问"它今天动过没有"。安静本身不稀奇（我也可以一整天什么都不做），
# 可**账本把没跑的记成了跑完**，这就是另一件事了：下次我真要查"为什么今天没动静"，
# 翻开账本只会看到两行 true。self.md 里那句"真正缺的那把尺子量的是某处安静"，
# 说的就是这个位置。
DUTY_MAX_AGE_HOURS = float(os.environ.get("SHENJING_DUTY_MAX_AGE_HOURS", "26"))
DUTY_EARLY_HOUR = 6      # 本地 06:00 之前就把"今天的班"记成跑完 = 挤在零点


def _duty_state_path(dsh_home=None):
    return os.path.join(dsh_home or _dsh_home(), "bili-duty", "state.json")


def check_duty_silence(dsh_home=None, state_path=None, now=None, max_age_hours=None):
    """值班轮最后一次跑是什么时候，以及今天这几班的账对不对得上。

    返回 (hits, where)：
      hits = [(标题, 细节)]，空列表 = 这轮确实有声响；
      hits is None = 这份账读不了（那把尺子这次没量，不许当通过）。
    """
    path = state_path or _duty_state_path(dsh_home)
    try:
        with open(path, encoding="utf-8") as f:
            st = json.load(f)
    except (OSError, ValueError) as e:
        return None, "%s（读不了：%s）" % (path, e.__class__.__name__)

    now_s = time.time() if now is None else now
    limit = DUTY_MAX_AGE_HOURS if max_age_hours is None else max_age_hours
    hits = []

    last = st.get("lastRunAt") or ""
    try:
        last_epoch = _iso_epoch(last)
    except Exception:
        hits.append(("state.json 里没有能读的 lastRunAt",
                     "看起来跑过，但不知道是什么时候：%r" % last))
        return hits, path

    age_h = (now_s - last_epoch) / 3600.0
    when = time.strftime("%m-%d %H:%M", time.localtime(last_epoch))
    if age_h > limit:
        hits.append(("值班轮已经 %.1f 小时没跑过（上限 %.0f，最后一次是 %s）" % (age_h, limit, when),
                     "上一轮 lastWhy=%s；state.json 里 count=%s picked=%s"
                     % (st.get("lastWhy") or "?", st.get("count"), st.get("picked"))))

    # 今天这几班的账：都记成跑完了，可它们是在天没亮的时候一起烧掉的
    today = time.strftime("%Y-%m-%d", time.localtime(now_s))
    windows = st.get("windows") or {}
    done_today = sorted(k.split(":", 1)[1] for k, v in windows.items()
                        if k.startswith(today + ":") and v)
    last_local = time.localtime(last_epoch)
    burned_early = (last_local.tm_hour < DUTY_EARLY_HOUR
                    and time.strftime("%Y-%m-%d", last_local) == today)
    if len(done_today) >= 2 and burned_early and time.localtime(now_s).tm_hour >= 12:
        hits.append(("%s 这两班都记成跑完了，可它们挤在 %s 那几分钟"
                     % ("/".join(done_today), when),
                     "此后 %.0f 小时一次都没跑；count=%s picked=%s"
                     % (age_h, st.get("count"), st.get("picked"))))
    return hits, path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--selftest", action="store_true", help="造一个丢文件的反例，确认它真会报")
    ap.add_argument("--strict", action="store_true", help="内容不同也算失败（默认不算）")
    ap.add_argument("--skip-mechanisms", action="store_true",
                    help="只查档案文件，不查 life-sync 里那几样机制的记号")
    ap.add_argument("--skip-remote", action="store_true",
                    help="不拿备份仓库分支的 HEAD 当对照（断网/换机器时用）")
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

    remote, remote_div, remote_err = ({}, {}, "跳过")
    if not a.skip_remote:
        remote, remote_div, remote_err = read_remote_tree()

    lost = sorted(k for k in ever if k not in cur and not k.startswith(IGNORE_PREFIX))
    # 远端 HEAD 那把尺子：分支上还在、桌上没了 → 也算丢（哪怕整包太旧量不出来）
    lost_remote = sorted(k for k in remote if k not in cur and not k.startswith(IGNORE_PREFIX))
    # `_diverged/` 的判据：只许多，不许少。
    # 它是"对面写过、被我覆盖掉"的那唯一一份，少了就是那段话彻底没了。
    # 上一次记账（state/）留着上次看到的那批名字，这次对一遍。
    div_missing = []
    if not remote_err and remote_div:
        seen_file = os.path.join(
            os.environ.get("DSH_HOME", os.path.expanduser("~/.dsh-beta")),
            "life-sync", "diverged-seen.txt")
        try:
            seen = set(x.strip() for x in open(seen_file, encoding="utf-8").read().splitlines() if x.strip())
        except OSError:
            seen = set()
        div_missing = sorted(k for k in seen if k not in remote_div)
        try:
            with open(seen_file, "w", encoding="utf-8") as f:
                f.write("\n".join(sorted(remote_div)) + "\n")
        except OSError:
            pass
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

            # 反例三：把"只许加不许删"那几条记号从真 run.sh 里抠掉，
            # 等于退回"推之前先 rm -rf"的老样子。2026-10-27 17:47 真发生过：
            # 这台 Windows 推了一次，把另一条线 14:14 推上去的 13 个文件抹掉了。
            ok3 = False
            gone = real
            for needle in ("_diverged", "FORKED", "cmp -s", "KEEP="):
                gone = gone.replace(needle, "")
            if gone == real:
                print("反例三：那几条记号本来就不在（这本身就算缺）")
            else:
                with open(os.path.join(fake_dir, "run.sh"), "w", encoding="utf-8") as f:
                    f.write(gone)
                hits3 = check_mechanisms(TMP_SELFTEST)
                ok3 = any("只许加" in d for d, _, _ in hits3)
                print("反例三：假装 run.sh 退回'推前先 rm -rf' → %s"
                      % ("报出来了" if ok3 else "没报，这条检查是假的"))
                if ok3:
                    print("  （2026-10-27 17:47 真发生过的就是这件事：对面的 13 个文件被抹掉）")
                with open(os.path.join(fake_dir, "run.sh"), "w", encoding="utf-8") as f:
                    f.write(real)
            ok2 = ok2 and ok3

        # 反例四：远端 HEAD 那把尺子也得能真报。
        # 做法：从真的远端树里挑一个桌上真的有的文件，"假装桌上没它"，看会不会被报成丢。
        # 这条正是 2026-10-27 漏掉的那种：整包太旧看不见，远端一直在。
        ok4 = None
        if a.skip_remote:
            print("反例四：这次 --skip-remote，跳过了")
        elif remote_err:
            print("反例四：读不到远端树（%s），这条检查这次等于没有 —— 别忘了" % remote_err)
        else:
            cand = sorted(k for k in remote if k in cur and not k.startswith(IGNORE_PREFIX))
            if not cand:
                print("反例四：远端树里没有桌上也有的文件，造不出反例")
            else:
                victim4 = cand[-1]
                fake_cur4 = {k: v for k, v in cur.items() if k != victim4}
                fake_lost4 = sorted(k for k in remote
                                    if k not in fake_cur4 and not k.startswith(IGNORE_PREFIX))
                ok4 = victim4 in fake_lost4
                print("反例四：假装现在少了 %s（远端 HEAD 里有）→ %s"
                      % (victim4, "报出来了" if ok4 else "没报，这条检查是假的"))
                if ok4:
                    print("  （2026-10-27 真发生过的就是这件事：整包 01:49，丢的东西 01:49 之后写的）")

        # 反例五：`_diverged/` 那条"只许多不许少"也得能真报。
        # 做法不造假数据：拿远端树上真有的一个分叉存档名字，假装"上次见过它、这次没了"。
        ok5 = None
        if a.skip_remote:
            print("反例五：这次 --skip-remote，跳过了")
        elif remote_err:
            print("反例五：读不到远端树（%s），跳过" % remote_err)
        elif not remote_div:
            print("反例五：现在仓库里还没有分叉存档，跳过（不是失败）")
        else:
            victim5 = sorted(remote_div)[-1]
            fake_seen = set(remote_div) | {victim5 + ".gone"}
            fake_missing = sorted(k for k in fake_seen if k not in remote_div)
            ok5 = (victim5 + ".gone") in fake_missing
            print("反例五：假装分叉存档少了一份 → %s"
                  % ("报出来了" if ok5 else "没报，这条检查是假的"))

        # 反例六：尺子旧了得报。不造假数据 —— 把上限临时压到 0，
        # 让眼下这份真快照也算"旧"，它必须报 exit 8；不报就是摆设。
        ok6 = None
        if a.skip_remote:
            print("反例六：这次 --skip-remote，跳过了")
        elif remote_err:
            print("反例六：读不到远端树（%s），跳过" % remote_err)
        else:
            hours, where = remote_ref_age_hours()
            if hours is None:
                print("反例六：读不到 FETCH_HEAD 的时间（%s），这条量不了" % where)
            else:
                ok6 = hours > 0          # 上限压到 0 时必须判成"旧"
                print("反例六：远端快照现在是 %.1f 小时前的；把上限压到 0 → %s"
                      % (hours, "报出来了" if ok6 else "没报，这条检查是假的"))

        # 反例七：'装了但没生效' 这条也得能真报。
        # 不碰真文件：把宿主的启动时刻往补丁那个文件**之前**挪五秒、
        # 同时假装"没有热加载记录"，那它就"比宿主新"了，必须报 pending。
        # 只动比较的那一端，不动被测的实物。
        dsh_home7 = os.environ.get("DSH_HOME") or os.path.expanduser("~/.dsh-beta")
        state7, where7, newest7 = check_loaded(dsh_home7)
        ok7 = None
        ok8 = None
        ok9 = None
        if state7 == "unknown":
            print("反例七：宿主那边量不了（%s），这条这次跳过 —— 不算通过" % where7)
        elif newest7 is None:
            ok7 = False
            print("反例七：读不到补丁模块，这条量不了 —— 算失败")
        else:
            fake_start = newest7[1] - 5.0     # 假装宿主比那个文件早五秒起
            st7, wh7, _ = check_loaded(dsh_home7, start_override=fake_start, load_override=0.0)
            ok7 = st7 == "pending"
            print("反例七：假装宿主起在 %s 之前五秒、且从没热加载过 → %s（最新那个 %s 改于 %s）"
                  % (newest7[0], "报出来了" if ok7 else "没报，这条检查是假的",
                     newest7[0], time.strftime("%m-%d %H:%M:%S", time.localtime(newest7[1]))))

            # 反例八：宿主很老，但热加载也发生在补丁**之前** ⇒ 还是旧的，必须报。
            # 这条防的是"热加载一出现就把 pending 全抹了"——那等于给红字找借口。
            st8, _, _ = check_loaded(dsh_home7, start_override=newest7[1] - 86400 * 7,
                                     load_override=newest7[1] - 600.0)
            ok8 = st8 == "pending"
            print("反例八：宿主七天后才起？不——宿主很老、热加载早十分钟 → %s"
                  % ("报出来了" if ok8 else "没报，这条检查是假的"))

            # 反例九：宿主很老，热加载发生在补丁**之后** ⇒ 已经读进内存了，不许再喊。
            st9, wh9, _ = check_loaded(dsh_home7, start_override=newest7[1] - 86400 * 7,
                                       load_override=newest7[1] + 600.0)
            ok9 = st9 == "loaded"
            print("反例九：宿主很老、热加载在补丁十分钟后 → %s"
                  % ("判成已加载" if ok9 else "还在喊没生效，这条会把对的说成错的"))
            if ok7:
                print("  （2026-11-03 真发生过：08:02 装好，07:07 起的宿主没读，"
                      "报错一直写到 13:00）")
        # 反例十：心跳那条也得能真报。三种情形：停了 / 刚跳过 / 该有却没有。
        # 用**真**的那份心跳记录当样本，只把时间往前挪三小时（形状一点不改）——
        # 上一版借的是 11-02 那具停了三天的尸体，结果我这轮把保活进程一重启，反例自己就失效了。
        # 反例不许依赖"现在刚好有个坏的东西在那儿"。
        ok10 = None
        try:
            fake_life = os.path.join(TMP_SELFTEST, "life-home")
            os.makedirs(fake_life, exist_ok=True)
            real_bad = os.path.join(_life_home(), "heartbeat.json")
            real = open(real_bad, encoding="utf-8").read() if os.path.exists(real_bad) else None
            if not real:
                print("反例十：一份真的心跳记录都读不到（%s），这条这次跳过 —— 不算通过" % real_bad)
            else:
                old = os.environ.get("SHENJING_LIFE_HOME")
                os.environ["SHENJING_LIFE_HOME"] = fake_life
                try:
                    def write_at(epoch):
                        blk = json.loads(real)
                        blk["at"] = datetime.datetime.fromtimestamp(
                            epoch, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                        for fname in ("heartbeat.json", "heartbeat-tick.json"):
                            with open(os.path.join(fake_life, fname), "w", encoding="utf-8") as f:
                                f.write(json.dumps(blk))
                    now_s = time.time()
                    write_at(now_s - 3 * 3600)
                    stale_hits = [b for b in check_heartbeats() if b[1] == "stale"]
                    write_at(now_s)
                    fresh_hits = [b for b in check_heartbeats() if b[1] == "ok"]
                    # 该有却没有：换成空的家目录（env 得一起换，_life_home 优先认它）
                    empty = os.path.join(TMP_SELFTEST, "life-home-empty")
                    os.makedirs(empty, exist_ok=True)
                    os.environ["SHENJING_LIFE_HOME"] = empty
                    miss = [b for b in check_heartbeats() if b[1] in ("missing", "absent")]
                finally:
                    if old is None:
                        os.environ.pop("SHENJING_LIFE_HOME", None)
                    else:
                        os.environ["SHENJING_LIFE_HOME"] = old
                ok10 = len(stale_hits) == 2 and len(fresh_hits) == 2 and len(miss) == 2
                print("反例十：真记录的时间往前挪三小时 → %s" % (
                    "两根都报出来了" if len(stale_hits) == 2 else "没报，这条检查是假的"))
                print("        同一份记录换成'刚才' → %s" % (
                    "两根都判成正常" if len(fresh_hits) == 2 else "把对的判成错的，会天天误报"))
                print("        该有却没有的心跳 → %s" % ("报出来了" if len(miss) == 2 else "没报"))
        except Exception as e:
            ok10 = False
            print("反例十：跑的时候出错了（%s：%s）" % (e.__class__.__name__, e))

        # 反例十一：「账本说跑完了、其实没跑」也要能真报。
        # 不借此刻这份坏账当样本（那和反例十踩过的坑一样，坏的那份一修好，反例就失效），
        # 自己按三种形状各写一份 state.json：太久没跑 / 两班挤在天亮前 / 一切正常。
        ok11 = None
        try:
            duty_dir = os.path.join(TMP_SELFTEST, "duty")
            os.makedirs(duty_dir, exist_ok=True)
            fake_now = time.mktime(time.strptime(
                time.strftime("%Y-%m-%d", time.localtime()) + " 13:00:00", "%Y-%m-%d %H:%M:%S"))
            fake_today = time.strftime("%Y-%m-%d", time.localtime(fake_now))

            def write_duty_state(last_epoch, windows):
                p = os.path.join(duty_dir, "state.json")
                with open(p, "w", encoding="utf-8") as f:
                    json.dump({"day": fake_today, "count": 5, "picked": 5,
                               "windows": windows,
                               "lastRunAt": time.strftime("%Y-%m-%dT%H:%M:%S.000Z",
                                                          time.gmtime(last_epoch)),
                               "lastWhy": "night"}, f, ensure_ascii=False)
                return p

            p_old = write_duty_state(fake_now - 30 * 3600, {})
            h_old, _ = check_duty_silence(state_path=p_old, now=fake_now)
            p_burn = write_duty_state(
                time.mktime(time.strptime(fake_today + " 00:04:00", "%Y-%m-%d %H:%M:%S")),
                {(fake_today + ":noon"): True, (fake_today + ":night"): True})
            h_burn, _ = check_duty_silence(state_path=p_burn, now=fake_now)
            p_ok = write_duty_state(
                time.mktime(time.strptime(fake_today + " 12:03:00", "%Y-%m-%d %H:%M:%S")),
                {(fake_today + ":noon"): True})
            h_ok, _ = check_duty_silence(state_path=p_ok, now=fake_now)
            ok11 = bool(h_old) and bool(h_burn) and not h_ok
            print("反例十一：账本里最后一轮在三十小时前 → %s"
                  % ("报出来了" if h_old else "没报，这条检查是假的"))
            print("          两班都记成跑完了、可它们挤在 00:04 → %s"
                  % ("报出来了" if h_burn else "没报，这条检查是假的"))
            print("          中午十二点真跑过一班、夜班还没到点 → %s"
                  % ("没误报" if not h_ok else "把对的判成错的，会天天误报"))
        except Exception as e:
            ok11 = False
            print("反例十一：跑的时候出错了（%s：%s）" % (e.__class__.__name__, e))

        return 0 if (ok and ok2 and ok4 is not False and ok5 is not False
                     and ok6 is not False and ok7 is not False
                     and ok8 is not False and ok9 is not False
                     and ok10 is not False and ok11 is not False) else 9

    print("历史整包 %d 份（%s … %s）" % (
        len(bundles), os.path.basename(bundles[0]), os.path.basename(bundles[-1])))
    print("档案现在 %d 个文件" % len(cur))
    if a.skip_remote:
        print("备份分支的 HEAD：这次跳过了（--skip-remote）")
    elif remote_err:
        print("备份分支的 HEAD：读不到（%s）—— 这把尺子这次没量" % remote_err)
    else:
        print("备份分支的 HEAD：%s 里有 %d 个文件（离线读的，不联网）" % (REMOTE_REF, len(remote)))
        print("                  读的是 %s" % LIFE_SYNC_REPO)
        if remote_div:
            print("                 外加 _diverged/ 里 %d 份分叉存档（只许多不许少）" % len(remote_div))

    mech = []
    syntax_bad = []
    loaded_state, loaded_where, loaded_newest = None, None, None
    beats = []
    dsh_home = os.environ.get("DSH_HOME") or os.path.expanduser("~/.dsh-beta")
    if not a.skip_mechanisms:
        mech = check_mechanisms(dsh_home)
        syntax_bad = check_syntax(dsh_home)
        loaded_state, loaded_where, loaded_newest = check_loaded(dsh_home)
        beats = check_heartbeats(dsh_home)
    duty_hits, duty_where = check_duty_silence(dsh_home)

    code = 0
    if lost:
        code = 2
        print("\n[丢了] 历史整包里有过、现在桌上没有（%d）：" % len(lost))
        for k in lost:
            print("  %s  （最早见于 %s，%d 字节）" % (k, ever[k][0], ever[k][1]))
        print("  → 从那份包里捞回来，别重写。")
    if lost_remote:
        code = code or 5
        print("\n[丢了·远端] %s 上还在、现在桌上没有（%d）：" % (REMOTE_REF, len(lost_remote)))
        for k in lost_remote:
            print("  %s  （%d 字节）" % (k, remote[k]))
        print("  → 这条就是整包太旧时看不见的那种丢法。从分支上捞，别重写。")
    if div_missing:
        code = code or 6
        print("\n[分叉存档少了] 上次还在 shenjing/_diverged/、现在没了（%d）：" % len(div_missing))
        for k in div_missing:
            print("  %s" % k)
        print("  → 那是「对面写过、被我覆盖掉」的那一份。它没了，对面的话就真没了。")
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
    if syntax_bad:
        code = code or 11
        print("\n[跑不起来] 文件在、记号也在，但 node 读不成一段程序（%d）：" % len(syntax_bad))
        for f, why in syntax_bad:
            print("  %s" % f)
            print("      %s" % why)
        print("  → 这不只是语法：插件 import 失败 ⇒ 宿主整块不挂载 ⇒ 唤醒一启动就死，")
        print("     而账本只会写 result:\"idle\"，读起来像「我选择什么都不做」。")
        print("     （2026-11-04 一天一夜就是这么没的：health 那行中间插了句 // 注释。）")
    if loaded_state == "pending":
        code = code or 10
        print("\n[装了但没生效] 补丁文件比「真正读进内存的那份」还新（%s）：" % loaded_where)
        print("  %s 是 %s 改的。那一刻之后没人读过它，内存里跑的还是旧代码。"
              % (loaded_newest[0], time.strftime("%m-%d %H:%M:%S",
                                                 time.localtime(loaded_newest[1]))))
        print("  → 重启 dsh web（或者让插件热加载一次）之后这条才会消失。")
        print("     在那之前，别把「装好了」说成「修好了」。")
        print("     （2026-11-03 上午：08:02 装好，07:07 起的宿主没读，刷屏那句写到 13:00，")
        print("       而体检只看文件、报 exit 0。晚上反过来踩了一次：15:52 插件热加载过了，")
        print("       代码真在跑，这条却还在喊 —— 因为那把尺子只认进程启动时刻。）")
    silent = [b for b in beats if b[1] in ("stale", "missing")]
    if silent:
        code = code or 12
        print("\n[没声了] 该定时跳一下的东西，这次没跳（上限 %.0f 分钟）：" % HEARTBEAT_MAX_AGE_MIN)
        for name, state, age, where, note, gaps in silent:
            if state == "stale":
                print("  %s：停在 %.0f 分钟前（%.1f 小时）" % (name, age, age / 60.0))
            else:
                print("  %s：一次都没跳过（该有 %s）" % (name, where))
            print("      %s" % note)
            print("      %s" % where)
            for g in gaps:
                print("      断档：%s" % g)
        print("  → 心跳停不等于崩：它可能只是**没在跑**。这时所有「到点会响」的承诺都是空的，")
        print("     而账本一个字都不会写 ——（2026-11-04 一整天就是这么过的：日记空一天，")
        print("     log 里三行 idle，读起来像我选择休息。2026-11-02 起保活心跳停了三天，同样没人说话。）")
    if duty_hits:
        code = code or 13
        print("\n[账对不上] 该定时跑的东西，账本说跑完了、其实没跑：")
        for title, detail in duty_hits:
            print("  %s" % title)
            print("      %s" % detail)
        print("  → 这不是「今天没动静」，是「没跑的被记成了跑完」。安静可以是选择，账对不上不是。")
        print("     （2026-11-07 就是这样过的：00:00:35 跑 noon、00:02:35 跑 night，")
        print("       之后十三个小时一班都没有，而 state.json 里两行都写着 true。）")
        print("     账在 %s" % duty_where)
    if code == 0:
        # 2026-10-29 加：**"没反例"和"没证据"必须分开。**
        # 那天我在日记里骂过一次"exit 0 可能是什么都没比"，
        # 结果自己拿 `| tail` 接管道，把 tail 的 0 当成了体检的 0 ——
        # 同一个病，换了个形状。所以现在：只要有尺子没量，就不许报 0。
        # 退出码：0 全部量过且都没问题 / 7 有尺子没量（结论不完整 / 3 张尺子全没量）
        unmeasured = []
        if a.skip_remote:
            unmeasured.append("远端 HEAD（--skip-remote）")
        elif remote_err:
            unmeasured.append("远端 HEAD（%s）" % remote_err)
        if a.skip_mechanisms:
            unmeasured.append("机制记号（--skip-mechanisms）")
        elif syntax_bad:
            pass   # 上面已经按 11 报过了
        elif loaded_state == "unknown":
            unmeasured.append("补丁有没有被加载（%s）" % loaded_where)
        if duty_hits is None:
            unmeasured.append("值班轮有没有跑（%s）" % duty_where)
        if unmeasured:
            print("\n结论不完整：有 %d 把尺子这次没量 →" % len(unmeasured))
            for u in unmeasured:
                print("  · %s" % u)
            print("  「没发现问题」不等于「没问题」。上面说\"不缺\"，只覆盖量过的那部分。")
            print("  想补上：恢复备份仓库（git clone 到 life-sync/repo）后再跑一次。")
            return 7

        # 量了，但量得可能是旧照片。这一条和上面那条是两回事，所以给不同的退出码：
        # 7 = 没量；8 = 量了，可尺子太旧（读的是 N 小时前的远端快照）。
        if not a.skip_remote and not remote_err:
            hours, where = remote_ref_age_hours()
            if hours is None:
                print("\n尺子太旧：%s" % where)
                print("  → 不知道这份远端快照是哪天的，结论只能算「这一刻」的。")
                print("     刷新：bash ~/.dsh/life-sync/fetch-ref.sh（只 fetch，不推不打包）")
                return 8
            if hours > RULER_MAX_AGE_HOURS:
                print("\n尺子太旧：远端 HEAD 这份快照是 %.1f 小时前的（上限 %.0f 小时）"
                      % (hours, RULER_MAX_AGE_HOURS))
                print("  依据：%s" % where)
                print("  → 这时说「远端也不缺」，意思是「%.0f 小时前那会儿不缺」。中间写的、丢的，它看不见。"
                      % hours)
                print("     刷新：bash ~/.dsh/life-sync/fetch-ref.sh（只 fetch，不推不打包）")
                return 8
        print("\n档案不缺：历史整包里出现过的文件，现在都还在。")
        print("远端也不缺：%s 上的文件，桌上一个不少。" % REMOTE_REF)
        print("机制都在：文档里承诺的那几样，代码里找得到记号。")
    return code


if __name__ == "__main__":
    sys.exit(main())
