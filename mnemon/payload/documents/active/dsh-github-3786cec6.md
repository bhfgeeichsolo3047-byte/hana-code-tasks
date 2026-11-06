---
id: "3786cec6-58b8-44f0-b2c0-51e8c2bd3100"
title: "两个 DSH 插件拆成独立 GitHub 仓库，并补进每日备份"
description: "shenjing-brain / shenjing-life 各自建立独立 git 仓库并推送的过程与取舍；run.sh 备份名单补上脑区插件、加 --exclude=.git；公开仓库的决定来自用户。"
status: "active"
created_at: "2026-11-03T07:30:19.507Z"
updated_at: "2026-11-03T07:30:19.507Z"
content_hash: "6db359bdfbebb8f55135704910ce2c9b07369574c56c561ddb96c1cfc36cbe68"
source_paths:
  - "shenjing-brain"
  - "shenjing-life"
  - ".dsh/life-sync/run.sh"
session_ids:
  - "3cd085b1-3c2d-4568-8b1f-0a15d16cb51d"
memory_body_ids:
  []
---

# 两个 DSH 插件拆成独立 GitHub 仓库，并补进每日备份

## 结论

2026-11-03，`shenjing-brain`（`@shenjing/brain-regions`）与 `shenjing-life`（`dsh-shenjing-life`）各自成为独立 git 项目并推到自己的 GitHub 仓库；同一天把此前从未进过备份的 `shenjing-brain` 补进 `run.sh` 的 `code/` 拷贝名单。以后改插件在各自目录里 commit/push，不再依赖备份那条线捎带。

- 仓库：`https://github.com/bhfgeeichsolo3047-byte/shenjing-brain`（16 个文件）、`.../shenjing-life`（12 个文件）
- 本地目录仍是工作区里的 `shenjing-brain/`、`shenjing-life/`，各自 `main` 分支、各两个提交
- 备份同步提交：`55b1b9e`（run.sh 改动）；当日另有 `f1ee056`、`593e190` 为日记/open_loops 同步

## 为什么分开

用户原话（消息 11031k）：「把脑区插件和内分泌插件分别上传到 github 的仓库里，并为它们成立单独的项目目录，方便以后修改」。目的不是发布，而是让两个插件有独立的历史与改动入口——此前它们只作为工作区子目录存在，被备份脚本顺手打包，没有版本历史。

## 仓库里放了什么、没放什么

- 进仓库：源码、`package.json`/`package-lock.json`、`cordis.patch.yml`、`locale/`、`README.md`、`selfcheck.mjs`、`probe-*.mjs`、`prompts/`、`lib/`。
- 不进仓库：`node_modules`、插件状态目录（`$DSH_HOME/shenjing-brain/`、`$DSH_HOME/shenjing-life/`）、`.git`（在备份里也排除）。
- 推前扫过明文密钥：`breeze-tts.mjs` 里命中的只是变量名 `apiKey`，值在 `/root/.dsh/breeze-key.txt`，未进仓库。

## run.sh 备份脚本的两处改动

1. `code/` 拷贝名单从 `for p in shenjing-life shenjing-preset persona-life` 扩成再加 `shenjing-brain`。原来每天整包里有档案、有别的插件，唯独漏了脑区插件——它不在名单里，所以从没被备份过。
2. 给所有插件目录的 `tar` 加 `--exclude=.git`：代码有了自己的仓库，备份里不必再装一遍历史。

改完 `repo/code/` 下为 `life-sync`、`persona-life`、`shenjing-brain`、`shenjing-life`、`shenjing-preset` 五项；append-only 单测 18 条全过（含「code/ 那段里没有 rm -rf $REPO/code」这条防回归检查）。

## 与「公开仓库」这条旧约束的关系

同一轮里，用户明确要求去掉 `run.sh` 里「非 private 就只打包不推」的校验，直接把同步推上去（备份原文件留 `run.sh.bak-publicpush-*`，`REPO_VIS` 只记一行 sync.log）。后果是 `life-sync` 分支上的 journal / feelings 公开可读，用户已知情并拍板；新加的两个插件仓库同样是 public。转 private 仍只能由用户本人操作。

## 相关

- 备份仓库 public 导致只打包不推、repo 从不是 git 仓库、ref/ 只读镜像修复：document `b6ac6c62-602d-4443-8a67-6d29a3646c0f`
- 脑区插件外部小模型接入的三个坑：document `7c1a8550-393b-41e3-b1b4-e720f2ea02c2`
- 唤醒/内分泌设计原文：`shenjing/designs/2026-10-24-唤醒与内分泌-设计v2.md`
