---
id: "a3dadfaf-af3b-4b3c-9696-7c21aaf698ec"
title: "QQ 发语音：SiliconFlow TTS 与声音克隆打通记录（2026-11-02）"
description: "QQ 插件 send_media(kind=voice) 可直接发语音、市场无 TTS 输出插件；SiliconFlow /audio/speech 与 /uploads/audio/voice 克隆流程、必填 text 否则 500、MOSS 内置音色可用性、已发出的两条样本与待补的参考文本。"
status: "active"
created_at: "2026-11-02T05:54:44.950Z"
updated_at: "2026-11-02T05:54:44.950Z"
content_hash: "78b2124189aa83689916e7ac1e5420517e7b3926aa94bf918e8704e6551d2e7f"
source_paths:
  - "shenjing/voice"
  - ".dsh/profiles/web/node_modules/@zaofan/dsh-qqbot/dist/channel-tools.js"
session_ids:
  - "8680caad-9a8b-4e0d-a2ac-de1c3e240bea"
memory_body_ids:
  []
---

# 从 QQ 发语音：SiliconFlow TTS + 声音克隆 打通记录（2026-11-02）

用户要求「让你直接从 QQ 发语音给我，音色用我自己提供的参考音频、走云端 API 合成」。结论：**插件市场没有 TTS 输出插件**，但 QQ 插件自带发语音能力，合成这一步自建即可。

## 能力现状（排查结论）

- 当前 profile 共 34 个插件包，语音相关的只有 `@deepseek-ai/dsh-experimental-voice-input-bundle`（SenseVoice，语音转文字，方向相反）；配套 `speech-to-text` / `api-speech-to-text` / `ui-voice-input` 均属输入侧。
- 输出侧现成能力在 QQ 插件里：`/root/.dsh/profiles/web/node_modules/@zaofan/dsh-qqbot/dist/channel-tools.js:555-576` 的 `send_media` 工具，`kind=image|voice|video|file`，`source` 支持本地绝对路径或 http(s)。语音后缀白名单见 `dist/transport/media-kind.js:5`：silk/amr/mp3/wav/ogg/oga/opus/m4a/aac/flac/wma。
- 因此整个链路是：**参考音频上传 → 合成 mp3 → `send_media(kind=voice)` 发到 QQ**，无需新装插件。

## SiliconFlow 接口实测（api.siliconflow.cn/v1）

- key 取自 `/root/.dsh/.credentials.yaml` 的 `SHENJING_BRAIN_API_KEY`。
- `GET /models` 里可用的 TTS 只有两个：`FunAudioLLM/CosyVoice2-0.5B`、`fnlp/MOSS-TTSD-v0.5`。
- 合成：`POST /audio/speech`，内置音色直接可用（实测一次返回 audio/mpeg 30847 字节）。
- 克隆：`POST /uploads/audio/voice`（multipart），**必填 `model`、`customName`、`text`**，音频二选一 `file`（binary）或 `audio`（`data:audio/mpeg;base64,...`）。成功返回 `{"uri":"speech:<name>:<uid>:<id>"}`，这个 uri 就是后续 speech 的 `voice` 参数。
- 官方文档地址：`https://docs.siliconflow.com/en/api-reference/audio/upload-voice`、`.../capabilities/text-to-speech`（注意 `docs.siliconflow.cn` 的旧路径直接 404）。

## 踩到的坑（都实测过）

1. **克隆必须带参考文本**：只传音频不传 `text`，`/audio/speech` 返回 `500 {"code":50507,"message":"Request failed: Unknown error."}`；补上一句文字后立刻成功（165247 字节）。文本对不上音频会让音色偏，所以需要那段录音的原话。
2. **MOSS 不能只靠内置无 voice 参数**：不传 voice 报 `400 {"code":20052,"message":"Voice or reference audio should be set"}`；内置音色里 `anna`、`david` 可用（25087 / 78847 字节），`xiaoyu` 报 `400 {"code":20047,"message":"Invalid voice."}`。
3. 空 multipart 探测返回 `400 {"code":20022,"message":"File not found."}`——说明端点存在、只是缺文件，可用来判活。
4. 本地脚本用 `node file.mjs`（ESM）时不能写 `require`；inline `[eval]` 里含 `\n` 的写法也失败过，改成落盘 .mjs 文件再跑。

## 已完成的验证与产物

- 用户提供的参考音频（QQ 直链）下载为 `/tmp/ref-voice.mp3`，74132 字节，文件头 `49443304`（ID3，正常 mp3）。
- 两次上传得到 uri：`speech:shenjing_ref:d7288v450mis739puu50:pevtvdkoculxhlkzxqlb`、`speech:shenjing_ref2:d7288v450mis739puu50:jxpsreabmbbjhpdpeydc`（后者带 text，可用）。
- CosyVoice2 与 MOSS-TTSD 各合成一条并**已成功发到 QQ**（send_media 返回 ROBOT1.0_ 开头的 file uuid，说明语音确实发出）。
- 听感：CosyVoice2 稳；MOSS 语气更活但偶尔带杂音。默认选 CosyVoice2。

## 未完成

- 等用户给出参考音频的**原话文本**，重新上传一次克隆音色（当前用的是临时填的「今天天气不错，心情也很好」，音色会有偏差）。
- 音色确认后再把「一句话 → 合成 → 发 QQ」封装成小工具/插件。

## 相关

- 另一条互不相同的旧线：Web 端朗读插件 `@memef1f1y/dsh-plugin-tts`（Edge TTS），见文档 `c51d380c-d546-4c0a-bb44-1f501e7c187a`。那份只管浏览器朗读，不管 QQ 发语音。
