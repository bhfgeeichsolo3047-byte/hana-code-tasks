---
id: "7c1a8550-393b-41e3-b1b4-e720f2ea02c2"
title: "shenjing-brain 外部小模型接入：siliconflow 超时、推理模型空 content、向量模型误选"
description: "换到外部 OpenAI 兼容端点后踩到的三个坑（12s 超时、推理模型 max_tokens 吃满导致 content 为空、向量模型误填进对话模型框）与设置页 RPC/负缓存修法。"
status: "active"
created_at: "2026-10-31T16:41:43.017Z"
updated_at: "2026-10-31T16:41:43.017Z"
content_hash: "afa12e3d091a398c89f67941803ea3fd0f090a23ca8c5ac0658ddc4bc42b19f3"
source_paths:
  - "shenjing-brain/lib/core.mjs"
session_ids:
  - "ceb271cc-d422-42ba-ac3b-890e6d5fc299"
memory_body_ids:
  []
---

# shenjing-brain 外部小模型接入：siliconflow 超时、推理模型空 content、向量模型误选

2026-10-31 一轮调试的结论。前置背景（表达卡注入位置、raccoon→workbuddy 路由、诊断入口）见文档 `593e08c7-5fd6-4cd2-a22d-5d87b186c5d3`；本文只记这次换成外部 OpenAI 兼容端点之后踩到的三个坑和设置页的接线。

## 设置页为什么进不去（client-modules 负缓存）

- 症状：插件已装、`dsh.client` 也声明了，但「深鲸脑区」设置页始终不出现。
- 根因：DSH 的 `client-modules` 会把「这个包不是 client 包」的**否定结论缓存进 `pkgMeta`，且永不失效**（代码里只写不清）。本插件的 `dsh.client` 声明是在宿主启动之后才加上的，那次扫描记了个 `null`，之后重载插件也不会重扫。
- 修法：插件启动时自检自己不在图里 → 清掉那条 `pkgMeta` 缓存 → 手动 `flush()` 一次；正常启动时是零开销空转。（重启宿主也能修，但会掐断当前会话。）
- 验证：设置页 occupants 里出现 `{registrant:"Gb", id:"shenjing-brain", order:40, active:true}`。order 40 与 `dsh-market/market` 撞号，影响不大。

## 设置页 RPC 走 connection.fetch 而不是 rpc.handle

`rpc.handle` 需要 webServer 注入，插件 ctx 拿不到；改用 `ctx.inject(['connection'], child => child.connection.fetch.register({path, methods:['POST'], requestBody:'buffered', fetch}))`。

- 路由：`/api/shenjing-brain.{state,models,efforts,save,test}`，全部 POST，统一返回 `{ok:true,value}` 或 `{ok:false,error:{code,message,details}}`。
- `save` 端点用 credentials 服务按 `externalApiKeyRef`（变量名形态，如 `SHENJING_BRAIN_API_KEY`）存 key，不落明文配置；`test` 端点会临时把 draft 覆盖进 current、跑一次最小 JSON 自检后还原快照。

## 坑一：超时太短（12s 掐掉了每次都答对的请求）

- 配置项 `timeoutMs` 原为 12000，health 里表现为成片的 `staticFallbacks` 与 `外部 API 连接失败：小模型超时`。
- 实测 siliconflow `XingChenAGI/Xing4.0-29B`：短自检 ~4.8s（4814ms）；带完整上下文的表达请求 **16.0s（effort=high）/ 20.3s（不传 effort）**。
- 结论：12s 必然超时；已改为 **45000**。

## 坑二：推理模型的 content 被思考过程吃空

- 症状：`外部 API 没有返回文本：{"id":...,"choices":[{"message":{"role":"assistant","content":"","reasoning_c...
- 机制：该模型返回 `reasoning_content` + `content` 两段；`max_tokens=700` 全被思考段吃满，`content` 是空串。
- 实测：`max_tokens=700` → content 34 字 / reasoning 1075 字 / 17.3s / finish=stop / completion_tokens 526；`max_tokens=3000` → content 122 字 / reasoning 1783 字 / 16.3s / completion 871。
- 修法（`shenjing-brain/lib/core.mjs` 的 `streamExternal`，约 91-111 行）：`max_tokens` 700 → **4000**；`content` 为空时从 `reasoning_content` 里提 JSON。

## 坑三：把向量模型填进了对话模型框

- 用户把 `externalModel` 换成 `Qwen/Qwen3-Embedding-8B`：`/embeddings` 200、273ms、4096 维 ✅；`/chat/completions` 400 `{"code":20012,"message":"Model does not exist..."}`。
- 三个处理流（情绪/记忆/表达）都要求模型返回 JSON，向量模型给不了 → 三路全废。
- 教训：设置页的模型下拉没过滤向量模型；换模型时要确认是 chat 模型。

## 相关代码位置

- `shenjing-brain/lib/core.mjs`：`streamDsh`（77-89 行，走 `ctx.llm.stream`，maxTokens 700）、`streamExternal`（91-111 行）、`callJson`（116-124 行，AbortController + `setTimeout(... '小模型超时')`）。
- 配置与状态：`/root/.dsh/shenjing-brain/{config.json,emotion.json,health.json,memories.json,logs,sessions}`；`archiveDir` 指向 `/root/Documents/deepseek-harness/default-workspace/shenjing`。
- 日志：`logs/guidance.jsonl`（status/chars）、`logs/errors.jsonl`（area + message）。
