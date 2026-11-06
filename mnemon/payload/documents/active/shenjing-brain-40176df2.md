---
id: "40176df2-0cfc-41ec-a0de-5c813e1e8c32"
title: "shenjing-brain 参数旋钮与内分泌慢变量：实现交接"
description: "三区参数（情绪敏感度/丰富度/记忆密度/向量检索）、独立 endocrine.json 慢变量、embedding 只能走外部端点、关键词二元切分修复与备份/仓库归属。"
status: "active"
created_at: "2026-11-03T07:57:02.884Z"
updated_at: "2026-11-03T07:57:02.884Z"
content_hash: "16a34c761db763983da765ec7cffb8201acda6aeb3759a6012a2b3872533b682"
source_paths:
  - "shenjing-brain/index.js"
  - "shenjing-brain/lib/core.mjs"
  - "shenjing-brain/selfcheck.mjs"
  - "shenjing-brain/probe-rpc.mjs"
session_ids:
  - "1a03861e-c700-4101-b918-2e82158bd52b"
memory_body_ids:
  []
---

# shenjing-brain 参数旋钮与内分泌慢变量（实现交接）

## 状态

2026-11-03 已实现并推送，commit `7ad5c9e`（仓库 bhfgeeichsolo3047-byte/shenjing-brain，本地路径 `shenjing-brain/`）。设置页需刷新后可见新滑块。selfcheck 从 18 条断言扩到 27 条并全部通过；`probe-rpc.mjs` 跑通（state 返回 40 个配置键）。

## 本次改动

### 三区各加一个参数

- 表达区「情绪丰富度」：决定语气词与 avoid 项各取几条，也决定提示里输出几维情绪（低档只给 mood/energy/tension，高档给全六维）。
- 情绪区「情绪敏感度」：本轮新判断能拉动旧状态多少，1 = 完全采纳，0 = 几乎不动。
- 记忆区「读取密度」（每轮取 1–8 条）与「向量检索」开关。

### 内分泌独立成卡（本次真正的结构改动）

此前提示词里的「情绪与内分泌分析器」只是名字，插件里并没有内分泌状态。现在 `$DSH_HOME/shenjing-brain/endocrine.json` 是独立慢变量，含 valence、energy、tension 三值：被情绪逐步带动；关掉联动后只向基线回落。它与 shenjing-life 的 `mind.json` 是两份文件，互不写入（两个插件各自持有状态，不做跨插件状态同步）。

### 向量检索的实现边界

- 只能走外部端点：宿主 `@deepseek-ai/dsh-llm` 没有 embedding 能力，只有 stream 和模型列表。因此单独开卡，Base URL 留空则复用外部 API 地址，密钥可单独配一把。
- 流程：关键词先筛出候选记忆，再用 `/embeddings` 算余弦相似度重排；端点不可用时自动退回关键词打分，不打断本轮回复。
- 向量检索未配置 Base URL 时 test 报「向量检索未配置 Base URL」，probe-rpc 以此作为负向用例。

### 顺手修的旧 bug

关键词打分原来拿整串「喜欢说话」做 `includes`，中文匹配不到「先把话说完」里的「说话」；改成二元切分后命中正确。selfcheck 里对应断言 `assert.ok(keywordScore(m,'说话')>keywordScore(m,'完全无关的词'))` 曾红，修复后转绿。

## 备份与仓库

- 备份脚本 run.sh 原先的 `for p in shenjing-life shenjing-preset persona-life` 漏了 shenjing-brain，已补入，并给所有插件加 `--exclude=.git`（代码有自己的仓库，备份不再带历史）。同步提交 55b1b9e，`repo/code/` 下已有 shenjing-brain。
- 推送前扫过明文密钥：brain 的 config 在 `$DSH_HOME/shenjing-brain/`，life 的状态在 `$DSH_HOME/shenjing-life/`，都不在源码目录，不会随仓库上传。remote 里不存 token，推完换回普通 https。

## 相关文档

- `2a742664-e768-49a5-a28c-6cb00e1abbd0`：脑部分区动态系统初步架构与表达控制约定（设计稿）。
- `7c1a8550-393b-41e3-b1b4-e720f2ea02c2`：shenjing-brain 外部小模型接入的三个坑与设置页 RPC/负缓存修法。
