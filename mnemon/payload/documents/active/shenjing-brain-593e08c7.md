---
id: "593e08c7-5fd6-4cd2-a22d-5d87b186c5d3"
title: "shenjing-brain 接入现状：表达卡注入、小模型路由与延迟遗留"
description: "深鲸脑区表达卡改走系统提示区的实现结论、tone 降级 bug、raccoon→workbuddy 小模型切换、日志与自检入口、同步等待导致的首次响应延迟。"
status: "active"
created_at: "2026-10-31T08:57:27.811Z"
updated_at: "2026-10-31T08:57:27.811Z"
content_hash: "dc255d33a38d7b79ddbd0f1530f37ffb5e44ed89b15d30e3d0a34c55470626cd"
source_paths:
  - "shenjing-brain/lib/core.mjs"
session_ids:
  - "9dd87ed3-66ce-4bba-a642-cbd2a1e9b004"
memory_body_ids:
  []
---

# shenjing-brain 接入现状：表达卡注入位置、小模型路由与已知延迟问题

## 背景
实现阶段的一次修复（2026-10-31）：把「深鲸脑区 · 本轮表达参考」卡片从用户消息里挪到系统提示区，并修掉静态降级时的 tone 误填。设计讨论见文档 2a742664（脑部分区动态系统：初步架构与表达控制约定），本文只记录落地后的实际接线与遗留问题。

## 注入位置（关键结论）
- 症状：卡片原先拼进用户消息正文，导致「【深鲸脑区 · 本轮表达参考】…脑区状态：…」直接出现在对话里给用户看到。
- 修法：改走系统提示区，只在模型侧可见，不进对话历史。对应 DSH 的系统提示组装链路 `system-prompt/assemble` 与 `systemPrompt.context({...})`（参考 `@deepseek-ai/dsh-system-prompt` 的 `renderPrompt` / `renderContextSections`，以及 `dsh-working-directory` 里 `system-prompt/assemble` 监听器改 contribution 的写法）。
- 验证手段：对比同一会话在注入/不注入两种状态下渲染出的系统提示长度（观察到 122373 vs 125845 字符差），确认卡片落在系统提示而非 user/message 的 surfaceOp 里。

## tone 静态降级 bug
静态降级分支把 `avoid` 里的「客服腔、总结升华、连续排比」错填进了 `tone` 字段，导致卡片显示成"要求用客服腔说话"。修正为 tone 只在模型返回时取用，降级时给中性固定值。

## 小模型路由
- 原路由 `raccoon / sn-deepseek-v4-1-flash-1017`：上游 xiaohuanxiong.com 连续限流（bili 在 5 次后停止重试放大），情绪/记忆/表达三路全部静态降级，health 里 errors 持续累加。
- 换到 `workbuddy/deepseek-v4.1-flash`（默认、免费档、可读图）后三路恢复：health 报 `emotionUpdates 1, expressionUpdates 6, staticFallbacks 0, errors 0`，情绪文件 `/root/.dsh/shenjing-brain/state/persona_life.json`（`source: "model"`）开始真实更新。
- 另一路可选 `buddy/deepseek-v4.1-flash`（x0.11）。选 workbuddy 是因为默认档免费且不需要额外 key。

## 诊断入口（可复用）
- `/root/.dsh/shenjing-brain/logs/guidance.jsonl`：每次注入的状态行，含 `status`（如"小模型不可用，静态降级""动态提示已更新"）与 `chars`。
- `/root/.dsh/shenjing-brain/logs/errors.jsonl`：按 area（emotion/memory/expression）记录失败原因，例如 `raccoon: upstream rate-limited …`、`小模型没有返回 JSON 对象`。
- health 摘要字段：`emotionUpdates / memoryCandidates / expressionUpdates / staticFallbacks / errors / lastError`。
- JSON 解析在 `/root/Documents/deepseek-harness/default-workspace/shenjing-brain/lib/core.mjs` 的 `jsonObject(text)`：剥 ```json 围栏、取首尾花括号、校验是对象；失败抛 `小模型没有返回 JSON 对象`——这条报错基本等于"模型返回了非 JSON 或空回复"，先看是不是限流/空响应，而不是改解析器。
- 自检：`shenjing-brain selfcheck`（18 条断言）。

## 遗留问题
- 表达区是同步 await 的：小模型慢时直接拉长首字延迟；目前没有超时。可选方向是加超时（超时即静态降级）或先发后补，但会牺牲本轮卡片准确性，未定。
- 静态降级仍是常态兜底，降级时卡片里的情绪/表达字段是模板值，不代表真实状态。
