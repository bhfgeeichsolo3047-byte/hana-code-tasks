---
id: "59c87def-3672-4257-b3af-604c3367007f"
title: "语音表现力控制与 xAI Grok TTS 备选评估（2026-11-02）"
description: "CosyVoice2 的 speed 生效、instruct 未验证（附对照请求数据）；TTS 无法唱歌的原因；xAI Grok TTS 接口、语气标签与需单独 API key 的门槛；grok 插件未找到的待办。"
status: "active"
created_at: "2026-11-02T07:21:34.283Z"
updated_at: "2026-11-02T07:21:34.283Z"
content_hash: "625348a78de0ec517d588357aa21d84ee34fa40bb1758a7d845b09521541e117"
source_paths:
  - "shenjing/tools/tts.mjs"
session_ids:
  - "510c80ab-4b32-42e7-8c7d-3bc3aedfb397"
memory_body_ids:
  []
---

# 语音表现力控制与 xAI Grok TTS 备选评估（2026-11-02）

接续既有的两条语音链路文档：SiliconFlow + 声音克隆打通记录见 `a3dadfaf-af3b-4b3c-9696-7c21aaf698ec`；本地 GPT-SoVITS 跑通与弃用决定见 `eb8e9984-e505-4d4d-9a2d-32327a12e3c0`。本文只记"能不能控制情绪/像不像人"这一层的实测与新候选。

## 当前主路径的表达力边界（CosyVoice2 via `shenjing/tools/tts.mjs`）

模型不感知说话人状态，它只读文本。情绪实际来自两处：

1. **文本本身**：标点、语气词、句长。写「嗯」和写一整句情绪描述，出来完全不同。
2. **手动参数**：`speed` 实打实生效——同一句用 0.6 合成，时长翻倍（plain 47359 B → slow 90751 B）。当前脚本固定 0.92，接近最慢端。
3. `instruct`（自然语言语气指令，如「用很低、很疲惫、几乎不想出声的语气说」）**不确定**：接口返回 200，但听感差异不明显，不能当作可控能力；要用得先做盲听对比。

同一句「今天有点累，不太想说话。」的对照请求（均为 HTTP 200，字节数/耗时 ms）：

- plain 29695 B / 4815 ms
- instruct_obj 33535 B / 11095 ms
- instruct_str 57727 B / 1442 ms
- emotion 25855 B / 1501 ms

返回 200 与体积差异不能证明语气被执行——这一点是本轮最关键的结论。

## 唱歌

同一条 TTS 出不了旋律：喂歌词只会得到"念得更认真"的朗诵，没有气口和音高曲线。真要唱需要 DiffSinger / Synthesizer V 一类歌唱合成，并逐音标注音高与节拍，不是给 TTS 换参数能解决的。

## xAI Grok TTS（备选，未接通）

- 接口：`POST https://api.x.ai/v1/tts`，body 含 `text`、`voice_id`（如 `eve`）、`language`（中文用 `zh`，也支持 `auto`），响应体是裸音频字节。
- 网络可达：未带凭据访问 735 ms 返回 `401 {"code":"unauthenticated:no-credentials"}`，即只差 key。
- 相对 CosyVoice2 的差异点：文本内可插**语气标签**。行内标签形如 `[pause]`、`[laugh]`、`[sigh]`；另有包裹式标签可整段指定低语、放慢、压低，vocal style 一栏含唱歌类。等于从"等模型领会"变成"直接指定表演方式"。
- 门槛：Grok 订阅 ≠ API key，key 需在 console.x.ai 单独创建，计费与会员分开。
- 文档页：`https://docs.x.ai/developers/model-capabilities/audio/text-to-speech`，标签说明在 `/audio/text-to-speech.md`。

## 未决

- 用户在插件/面板里"记得有个 grok 的"东西，但已装 16 个包、`.credentials.yaml`、本地插件市场缓存（`/root/.dsh/dsh-market`）里都没有 xAI 相关条目；等用户给出名称或截图再定位。
- xAI 一路尚未用真实 key 合成过，标签是否真的生效未验证。
