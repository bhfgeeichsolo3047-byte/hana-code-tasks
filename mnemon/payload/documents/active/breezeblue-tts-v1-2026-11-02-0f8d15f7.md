---
id: "0f8d15f7-6318-417e-9e71-b94d25df5005"
title: "大肥鱼语音接入：BreezeBlue TTS 接口与豆包 V1 协议实测（2026-11-02）"
description: "BreezeBlue 合成端点/参数/官方音色 ID 与开发者页路径、401/422 判活与鉴权陷阱；DSH 豆包 BidirectionalTTS 事件码、V1 帧编码（sessionId 长度必写否则 45000000）、PCM 奇数字节对齐、错误分类与音频头校验。"
status: "active"
created_at: "2026-11-02T14:02:00.828Z"
updated_at: "2026-11-02T14:02:00.828Z"
content_hash: "486593ddb2af89972168c56ca421545e7548eef5e7ff1082c6f764abf177cd80"
source_paths:
  - "shenjing/tools/breeze-tts.mjs"
session_ids:
  - "49eb0feb-db0b-468c-bc7e-508c06c16acb"
memory_body_ids:
  []
---

# 大肥鱼语音接入：BreezeBlue TTS + 豆包(Doubao) TTS 协议实测（2026-11-02）

目标：给 QQ 大肥鱼 Bot 换成「官方味道」的语音输出。两条路都验证过——云端 BreezeBlue（存量色）与本机 TTS 插件里的豆包协议实现。相关旧记录见 SiliconFlow 版：[a3dadfaf-af3b-4b3c-9696-7c21aaf698ec]（QQ 侧 `send_media(kind=voice)` 发语音、后缀白名单 silk/amr/mp3/wav/ogg/... 的结论仍然适用，那部分是通用前提）。

## BreezeBlue 合成接口（已摸清，缺 key 未出音频）

- 端点：`POST https://api.breeze.blue/v1/text-to-speech/{voiceId}?outputFormat=mp3`
- 请求头：`xi-api-key: brz_...`（SDK 另加 `x-breeze-sdk` 做可观测）
- 请求体：**只放** `{"text":"..."}`。带 `modelId` 会被拒：`422 VALIDATION_ERROR / Extra inputs are not permitted`，说明服务端固定模型，不接受该字段。
- 不带 key 调用返回 `401 {"code":"AUTH_REQUIRED"}`——可用作端点判活。
- 官方 SDK：`@breeze.blue/sdk` 0.23.0（ESM-first）。`client.textToSpeech.convert(voiceId, {text}, {outputFormat:"mp3"})` 内部就是打上面那个 URL；`@breeze.blue/sdk/node` 的 `save(audio, path)` 落盘。
- 可选参数（README）：`instructions`（演绎指令）、`voiceSettings.guidanceScale` 1–10、`useSpeakerBoost`、`removeBackgroundNoise`（克隆降噪）。`guidance>1` 或带 instructions 时 speakerBoost 失效。
- 大肥鱼旗舰音色（官方博客/音色库给出，可直接用）：
  - 机灵版 `voc_u3nxkd5578wc`
  - 迷糊版 `voc_8yud7hz7c9q2`
- key 存放：`/root/.dsh/breeze-key.txt`，脚本 `shenjing/tools/breeze-tts.mjs` 读取后合成。
- 开发者页真实路径是 `https://breezeblue.ai/zh/app/developer/api-keys`；`/developer`、`/console`、`/account`、`/zh/app/credits`、`/zh/app/redeem` 全部 404，别按猜测路径登录。

### 走过的弯路

1. 先以为豆包克隆接口报 `45000030` 是「资源未开通」，实际是 key 不对：旧 key 直接返回 `401 Invalid X-Api-Key`，用户在设置页自己填的新 key 才有效。**结论：TTS 类错误先分离鉴权问题，再谈资源/音色问题。**
2. 计费口径（2026-10-29 标准，纯汉字估算）：1 credit = 10 计费字符，汉字每字 2 字符；$3 / 10,000 credits；50 字一条 ≈ 10 credits ≈ $0.003。Free 套餐每天可手动领 400 credits。

## 豆包 BidirectionalTTS 协议要点（DSH 内置 TTS 插件）

事件码：Connection 1/2/50/51/52，Session 100/101/102/150/151/152/153，TaskRequest 200，TTS 350/351/352（音频）/364（字幕）。

帧格式为 V1（protocol version 1、header size 4 字节、big-endian）：
- 前 4 字节 `[17,20,16,0]`，即 version=1 / headerSize=4 字 / messageType=full client request(1) / flag=0(bits) / serialization=JSON / compression=none。
- body 顺序：event(int32BE) → 若事件不属于连接级事件集合则先写 sessionId 长度(uint32) + sessionId 字节 → payload 长度(uint32) + JSON。
- **踩坑：连接级事件（1/2/50/51/52）不写 sessionId，会话级事件必须写；漏写时报 `FAIL event 0 type 15 code 45000000 payload {"error":"decode ws request failed: unable to decode V1 protocol message: session ID length is zero"}`。** 也就是说即使 sessionId 为空串，也必须写出「长度=0」这个字段。
- 解码侧需校验：`bytes[0]>>4===1`、header 长度对齐、type ∈ {1,9,11,15}、compression ≤ 1、serialization ≤ 1、总长 ≤ 16MB、读完后 `offset === bytes.length`；compression=1 用 `gunzipSync(payload,{maxOutputLength:16MB})`。

会话时序：open → StartConnection → 收到 ConnectionStarted(50) 才发 StartSession(100，带 req_params) → SessionStarted(150) 转 ready → 每条 TaskRequest(200) 带 `{user:{uid}, event, namespace:"BidirectionalTTS", req_params:{...settings, text}}` → FinishSession(102) → SessionFinished(152) 后发 FinishConnection(2) → ConnectionFinished(52) 收尾。失败码分类：message 命中 `resource|未开通` → resource-unavailable(502)；`auth|token|api.?key|鉴权|密钥` → api-key-rejected(403)；`speaker|voice|音色` → voice-unavailable(502)；`limit|quota|concurr|限流|并发` → rate-limited(429)。

音频处理细节：
- 二进制帧 type=11 才是音频；**PCM 必须做奇数字节对齐**——留 1 字节 `pcmTail` 拼到下帧，结束时若仍残留则抛 `invalid-pcm-sample`；`audioBytes===0` 抛 `stream-audio-empty`。
- 非音频 JSON 帧做 `JSON.parse` 失败要静默容错（`catch {}`），不能因此断流。
- 响应帧 sessionId 与会话不一致（event≥100）抛 `doubao-session-mismatch`；允许忽略的事件仅 350/351/364/154。
- 完整响应音频校验（非流式路径）：先 `strictBase64DecodedLength` 估算长度挡掉超大包，再比对 `audio.byteLength === expectedLength`，最后验头——wav 要求 `>=12` 且 `RIFF`(0..4)+`WAVE`(8..12)；mp3 要求 `>=2` 且以 `ID3` 开头或 `0xFF` 且 `(b1 & 0xE0) === 0xE0`。

## 状态

- 豆包路线：插件已能发出语音（用户收到两条，音频头 `49443304`=ID3 mp3，22701 字节，产物 `/root/.dsh/doubao-clone-test.mp3`）。
- BreezeBlue 路线：脚本与接口就绪，等用户在手机登录开发者页取 `brz_` 开头的 key，再用机灵版/迷糊版各合成一条供挑选。
