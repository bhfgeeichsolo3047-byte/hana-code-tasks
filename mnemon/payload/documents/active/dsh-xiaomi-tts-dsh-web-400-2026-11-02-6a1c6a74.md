---
id: "6a1c6a74-3833-461c-94eb-6332c4878dec"
title: "dsh-xiaomi-tts 在 DSH Web 启用与 400 排错（2026-11-02）"
description: "dsh-xiaomi-tts 装进 web profile 的实际启用条件（默认 disabled+无 key 等于没加载、改配置需重启、loader schema 不等于激活）；400「messages must contain an assistant role」根因在 requestMessages 的 user/assistant 分工；上游模型映射与流式限制；小米不能克隆、只剩 CosyVoice2 与豆包 seed-icl-2.0 两条克隆路。"
status: "active"
created_at: "2026-11-02T12:52:30.024Z"
updated_at: "2026-11-02T12:52:30.024Z"
content_hash: "3749f172a94c91c7e0a632a5a296e8656f7367b9071e1e6e462ae17acc80cb9b"
source_paths:
  []
session_ids:
  - "a92c6174-3404-44f1-8843-2626c664f74f"
memory_body_ids:
  []
---

# dsh-xiaomi-tts 在 DSH Web 启用与 400 排错（2026-11-02）

承接《语音朗读插件选型与 Edge TTS 403 修复》文档（f3e6d7a9-4df1-4b98-aa66-73c2d95d7db4）的选型结论。本段完成了另一件事：把 dsh-xiaomi-tts 真正装进 web profile 并调通合成，同时厘清「能不能克隆用户自己的音色」。

## 启用路径与判定

- 配置写在 `/root/.dsh/profiles/web/cordis.patch.yml`，insert 条目 id `xiaomi-mimo-tts`、name `dsh-xiaomi-tts`，config 里给出 `enabled: true`、`baseURL: https://api.xiaomimimo.com/v1`、`model: mimo-v2.5-tts`、`voice: 冰糖`、`format: pcm`、`autoPlay/soundEnabled/taskSounds/clickSounds: false`、`maxTextLength: 12000` 等；apiKey 只填在本地配置，不记录值。
- 关键坑：**插件被加载出来 ≠ 生效**。该包默认 disabled、且 apiKey 为空，等于整个插件没加载。必须先写配置再重启 web 进程。
- 重启后的启动命令行（patch 链）：`/etc/dsh-app/dsh-web.patch.yml`、`/opt/dsh-app/speech.patch.yml`、`auth/auth.patch.yml`、`search.patch.yml`、`phone/phone.patch.yml`，`--host 127.0.0.1 --port 3080`。
- 状态判定用 loader 列表：`include:xiaomi-mimo-tts` 由 `absent` 变 `schema`，表示条目已被识别、等待原生校验，**不等于运行时已激活**；`include:preset-whale-girl`（鲸鱼娘预设）仍是 `inactive`，qqbot 语音投递条目 `include:speech-delivery-qqbot` 当时 absent。
- 包目录：`/root/.dsh/profiles/web/node_modules/dsh-xiaomi-tts`。

## 400 排错：messages must contain an assistant role for TTS model

- 首次合成直接失败：HTTP 400、494 ms，响应体 `{"error":{"code":"400","message":"Param Incorrect","param":"messages must contain an assistant role for TTS model"}}`。
- 根因在 `src/host/synthesis.ts` 的 `requestMessages(options, text)`：**待朗读的正文必须放在 `role: "assistant"` 的消息里**；`role: "user"` 只承载风格指令。voicedesign 模型会把 `voiceDesignPrompt` 与 `instruction` 用换行拼成 user 侧上下文，普通预设模型则用 `instruction`（为空时退回 `presetStylePrompt`）。
- 修好后同一条请求返回 200、1557 ms，base64 音频 32512 字符、解码 24384 字节 mp3，产物落在 `/root/.dsh/xiaomi-test.mp3`（用户当时听到的就是它）。
- 上游模型映射 `upstreamModel()`：只有 `mimo-v2.5-tts-voicedesign` 原样上报，其余一律发 `mimo-v2.5-tts`。
- 请求体差异：voicedesign 传 `audio: { format }`；预设模型传 `audio: { format, voice }`。
- 实时流式（PCM）只支持预设模型，否则抛 `streaming-model-unsupported`（409）。
- apiKey 以 `tp-` 开头时 baseURL 会被改写为 `https://token-plan-cn.xiaomimimo.com/v1`，自定义 baseURL 仅对其他 key 生效。

## 音色与克隆能力边界

- 内置 8 个音色：冰糖（活泼少女）、茉莉（知性女声）、苏打、白桦，以及 Mia / Chloe / Milo / Dean 四个英文向。
- **小米这一路不能克隆音频**：只有内置音色，或用 voicedesign 拿一段文字描述「造」一个声音（不看音频，所以跟用户给的参考录音无关）。
- 要复刻用户自己的音色，现实只有两条：
  1. SiliconFlow CosyVoice2，已用 refwav 克隆并在 `tts.mjs` 里使用，细节见 a3dadfaf-af3b-4b3c-9696-7c21aaf698ec；
  2. 豆包 `seed-icl-2.0`，插件字段为 `doubaoClonedVoice`，但需要先去火山引擎控制台上传音频拿到 speaker_id 再回填。
- 豆包相关入口：API Key 在 `https://console.volcengine.com/speech/new/setting/apikeys?projectName=default`；声音复刻流程见 `https://docs.volcengine.com/docs/DoubaoVoice/Soundreplicationorderingandusageguide`。复刻有免费额度，超出后按量计费，需提前告知用户。

## 当前状态与待办

- 小米 MiMo TTS 已在 Web 端打通（1.5 秒出音），设置页「语音合成」一栏应可自选音色与自动朗读，待用户实际打开确认。
- 阻塞在用户侧：等其建好豆包 key 并给出 speaker_id，之后验证能否直接吃已有的 refwav 参考音频；在此之前不要改动现有 CosyVoice2 链路。
- 本段未记录任何密钥值；配置里的 apiKey、qqbot appSecret 等一律留在本机文件，不复述。
