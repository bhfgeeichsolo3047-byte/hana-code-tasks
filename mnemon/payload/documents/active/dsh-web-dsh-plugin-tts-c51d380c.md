---
id: "c51d380c-d546-4c0a-bb44-1f501e7c187a"
title: "DSH Web 语音朗读插件 dsh-plugin-tts 安装与启用交接"
description: "2026-10-22 夜为用户装好 @memef1f1y/dsh-plugin-tts 0.6.7（Edge TTS）：选型与商城检索故障、启用结果与 peer 告警、必须重启 web profile 才生效、3091 临时实例验证、3080 未监听的线索、voice/ 下两条 mp3 与 09:00 排程、次日动作清单。"
status: "active"
created_at: "2026-10-22T16:20:59.835Z"
updated_at: "2026-10-22T16:20:59.835Z"
content_hash: "40a953cf0cfd17ff684fe9f8efd44e50ca9f8fc75490aab9736d56dd083a4b2b"
source_paths:
  - "shenjing/voice"
session_ids:
  - "47378d85-06fc-422f-a0c9-ebb2afb2d7b2"
memory_body_ids:
  []
---

# DSH Web 语音朗读插件 dsh-plugin-tts 安装与启用交接（2026-10-22 夜）

用户希望「能听到小鲸的声音」。当晚在插件商城检索后选定并启用了 **@memef1f1y/dsh-plugin-tts 0.6.7**（Edge TTS，免 API key，服务端 + Web client 两段），但**插件要重启 DSH 才生效**，线上实例当夜未重启，留给次日早上。

## 选型与检索情况

- 候选：`dsh-voice-chat@0.4.1`（豆包式语音对话，依赖 ws）、`@memef1f1y/dsh-plugin-tts`（Edge TTS 朗读，含 RVC / Index-TTS2 / CosyVoice / Google Cloud 扩展）。
- 商城检索接口不稳定：一次 120s 超时，另几次对 `@memef1f1y/dsh-plugin-tts`、`dsh-voice-mode`、`dsh-voice-talk` 返回 `Cannot read properties of undefined (reading 'text')` 或 fail。**重试同样的检索没有意义**，改为直接看已安装包内容判断。

## 安装结果

- 通过插件管理 enable：返回 `stage=enable, changed=true, application=applied`，pnpm 退出码 0；只有 peer 依赖告警（缺 cordis / react / dsh-web 的 peer 声明），不影响加载。
- profile：`web`。包位于 `/root/.dsh/profiles/web/node_modules/@memef1f1y/dsh-plugin-tts`，profile 的 `package.json` 已写入 `"@memef1f1y/dsh-plugin-tts": "^0.6.7"`，`cordis.patch.yml` 中含对应注入项。
- 包内自带 `docs/USER-GUIDE.md`（安装、RVC、Index-TTS2、CosyVoice、Google Cloud、音色包下载、按症状排错），入口 `lib/index.mjs` / `lib/client.js`。
- 自测：`node tests/smoke.mjs` 等全套 **133/133 通过**，client-load 亦通过（含 Edge/Cosy 配置、分块播放、notify 路由）。

## 生效条件与当夜验证

- **必须重启 `dsh --profile web` 进程**：插件在服务内存里，改文件/改配置对当前进程无效。
- 当夜没重启线上实例（用户要睡觉，怕早上打不开）；另起临时实例 `--port 3091 --no-open` 验证：服务能正常启动、路由挂载、页面需 token（直接 `curl /` 返回 401，带 token 303），验证后已关闭。
- `/root/.dsh/log/dsh-web-3080.log` 只有一行 `restart aborted: no listener found on port 3080`——说明当晚的重启没有落到线上，**早上动手前先确认 3080 是否在监听**。

## 语音素材与排程

- 预先做好的 mp3：`shenjing/voice/2026-10-23-早安.mp3`、`2026-10-23-金唱片.mp3`。
- 已排 host 投递提醒（09:00）：`schedule-c90b18b7-595e-4187-ada0-bfcac2df6a96`，内容是提醒重启、试自动朗读、先听这两条 mp3。

## 后续动作清单

1. 重启 web profile，确认 3080 正常。
2. 设置 → 插件 → 语音：出现即安装成功；选中文音色、调语速。
3. 回复左下角 🔈 单条朗读；输入框左侧喇叭开关 = 自动朗读。
4. 想换自训音色 / 克隆音色再按包内 docs 配 RVC、Index-TTS2、CosyVoice（均本机运行）。
