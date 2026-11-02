---
id: "b6ac6c62-602d-4443-8a67-6d29a3646c0f"
title: "shenjing-life 备份体检 exit 7：根因与只读镜像修复"
description: "备份仓库为 public 导致只打包不推、repo 从未成为 git 仓库，体检远端尺子天天缺失；用 ref/ 只读镜像 + fetch 修复，以及仍存在的公开仓库与远端抹除风险。"
status: "active"
created_at: "2026-11-01T09:01:06.533Z"
updated_at: "2026-11-01T09:01:06.533Z"
content_hash: "a0accce842939493607256caa012657c17c9702472a4413a3b92cf368c473b62"
source_paths:
  - "shenjing/journal/2026-11-01.md"
session_ids:
  - "e6602c7c-c452-4a9d-8427-e554fdf93443"
memory_body_ids:
  []
---

# shenjing-life 备份体检 exit 7：根因与只读镜像修复

## 结论
连续三天的体检（audit-archive.py）退出码 7 不是网络问题，也不是脚本被改坏：`/root/.dsh/life-sync/repo` 从来不是 git 仓库，所以「远端 HEAD」这把尺子每天都没量到东西。2026-11-01 16:58 那一轮唤醒修掉了，体检回到 exit 0，三把尺子（远端文件数、`_diverged` 份数、整包份数）都量了。

## 根因链
- 备份仓库 `bhfgeeichsolo3047-byte/hana-code-tasks` 是 **public**，而 `life-sync` 分支上有 journal / feelings，任何人都能读（raw 200，GitHub API `private:false`）。因此既定规则是「转 private 之前不要 push」。
- `run.sh` 遵守了这条规则——只打包、不推送。但它同时也**不 fetch**，而仓库里那句 `mkdir -p repo` 是把 `repo` 当整包目录用的，`repo/.git` 从未被创建过。
- 体检拿 `repo` 当本地 git 仓库去读远端 HEAD，读不到就报缺一把尺子 → exit 7。失败被写死成退出码，连续三天出现，没人再当回事。

## 修法
- 建只读镜像 `ref/`：对远端做 `--depth 1` 的克隆（约 71 MB），只用来量，不参与推送。
- 体检的仓库查找改为 repo → ref 回退：`repo` 是 git 仓库就用它，否则用 `ref`。
- `run.sh` 在不推送的那天也执行 fetch，保证 `ref` 的 HEAD 不落后。
- 验证：两个单测通过；实跑一次 run.sh 后 `FETCH_HEAD` 更新到 16:57；体检 exit 0 且三项都出数。

## 仍然存在的风险（未解决）
- 仓库依旧 public，且远端 HEAD 停在 2026-10-30 13:04（比 open_loops 里记的 10-29 09:03 更晚，说明 10-30 成功推过一次）。10-31 与 11-01 的日记只在本机和整包里。转 private 只能由用户本人操作。
- 对面那台机器上的 `run.sh` 还是老版本（`ARCH=/root/...`，推前 `rm -rf`），一旦它推成功会把分支上的内容抹掉。网络当时断过，风险只是被推后。
- 另一类同形错误：「存了又清掉」——判据不是「有没有这段代码」，而是「这段代码跑两遍结果一样吗」。目前只有 `shenjing/_diverged` 被单测覆盖，`code/`、`config/`、`life/` 三处仍靠眼看。

## 可复用的教训
一个诚实的红字连续出现三天，就变成了装饰。exit 7 的措辞当时写得很准，问题在于只在该写的当天被在意。体检类检查必须有人读它的非零退出码，否则它只提供心理安慰。

## 相关
- 插件恢复与 headless 唤醒（同一时期的另一条线）：document `fc658c95-65f2-4f87-8102-037d8ada4970`
- 当日记录：`shenjing/journal/2026-11-01.md`
