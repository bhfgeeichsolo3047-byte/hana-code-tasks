---
id: "55e264a7-307e-4ff9-9697-45079860ade8"
title: "QQ Bot 扩展工具索引刷新与 per-agent 注册机制（2026-11-03）"
description: "expose:'all' 扩展工具写完却查不到/领不到的根因：ext-tools-index.json 只靠 QQ 入站消息或启动 60 秒重试刷新；注册必须 per-agent；扫描→剪枝→注册顺序；ctx.get('tools')；reloadAllChannelTools 热刷新范围与诊断日志开关。"
status: "active"
created_at: "2026-11-02T16:44:47.819Z"
updated_at: "2026-11-02T16:44:47.819Z"
content_hash: "fbc04539198328ff7700db68be2b292ccd37923ae226aab5e31e0197238e8f99"
source_paths:
  - ".dsh/profiles/web/node_modules/@zaofan/dsh-qqbot/dist/session/session-manager.js"
  - ".dsh/profiles/web/node_modules/@zaofan/dsh-qqbot/dist/transport/inbound.js"
  - ".dsh/profiles/web/node_modules/@zaofan/dsh-qqbot/dist/gateway/middleware-setup.js"
  - ".dsh/profiles/web/node_modules/@zaofan/dsh-qqbot/dist/features/ext-inbound.js"
  - ".dsh/profiles/web/node_modules/@zaofan/dsh-qqbot/dist/channel-tools.js"
  - "dshqqbot/.qqbot/ext-tools-index.json"
session_ids:
  - "973aeade-a9d5-4d95-97fb-0481f03ce318"
memory_body_ids:
  []
---

# QQ Bot 扩展工具「看不见」的根因：索引刷新时机与 per-agent 注册（2026-11-02/03 实测）

## 症状
写好并加载成功的 `expose:'all'` 扩展工具（本例 `qq_voice`），在 web 会话里用 `gain_qq_tools` 查不到、也领不到；`loadExtensionTools` 明明数出 10 个。插件侧工具索引停在最近一次扫描的时间点。

## 根因：索引只在两个时机刷新
- 索引文件：`{dataRoot}/.qqbot/ext-tools-index.json`（实例 `shenjing` 的 dataRoot 是 `/root/dshqqbot`）。只列**本 tag** 的 `expose:'all'` 工具，字段 full / tag / baseName / description / dataRoot / cwd。
- 刷新入口只有两个：
  1. QQ 入站消息挂钩子时顺带重扫（`dist/transport/inbound.js:284` 调 `manager.ensureGroupRules(record)`，实现在 `dist/session/session-manager.js:1036`，注释写明「每次消息自愈钩子，幂等」）；
  2. 插件重启后启动重试那 60 秒窗口。
- ⇒ 在两次 QQ 消息之间新写/改写的扩展工具，索引不会自己更新，`gain_qq_tools` 自然看不见。
- 现场验证：让用户在 QQ 里随便发一个字触发重扫后，`qq_voice__shenjing` 立刻出现在可领取列表，随后成功发出 74KB 语音。

## 注册必须走 per-agent，不能全局注册
- `dist/session/session-manager.js` 里 `applyExtToolVisibility(ctx, tag)` 是唯一有效的注册路径（2026-10-31 实测：注册到 `apply(ctx)` 后 QQ 会话调不到，报 unknown tool；用 `gain_qq_tools.enable` 走 agent.ctx 注册立刻可用）。
- 扫描流程顺序固定为 **扫描 → 剪枝 → 注册**。2026-10-28 曾出现「新增 7 个 → 下个 step 又移除 7 个」的工具表抖动，原因就是边扫边注册时 deny 名单还没齐；改成先剪枝后，模型永远不会看到注定被剪掉的那一步。

## 拿 tools 服务的姿势
- 插件 `apply` 的 inject 列表是 `["settings","webServer"]`，**没有 `tools`** ⇒ 直接读 `ctx.tools` 会被宿主拒（`cannot get property "tools" without inject`），异常被 catch 吞掉，表现为「全局注册压根没发生」。
- 正解：用 cordis 运行时取服务 `ctx.get('tools')`，或先 `ctx.root`（root 才是根作用域，restrict 报 "names unknown global tools" 就是因为注册层不是全局层）。

## 热刷新入口
- `/tools-reload` 斜杠、`tools_reload` 工具 → `SessionManager.reloadAllChannelTools()` → 逐 agentCtx 调 `hotReloadChannelTools(agentCtx)`（`dist/session/session-manager.js:881/901`）。
- 同一时机一起重扫：扩展命令（`reloadExtCommands(this.dataRoot)`，必须传本实例 dataRoot 否则刷到别的实例）、入站中间件 `.qqbot-extensions/inbound/*.mjs`、出站中间件 `.qqbot-extensions/outbound/*.mjs`——三者都是「现读可变列表」，重扫即生效，不重启。
- 没有活动会话时 `reloadAllChannelTools` 会返回「当前没有活动会话可热刷」，但命令表照样刷新。
- `hotReloadChannelTools` 的实现是**重新 apply**（只注册新工具）。

## 诊断日志
- `extGlobDiag` 走统一诊断底座 `diagWrite('qqbot-extglob', …)`，受设置页 ⑤「诊断日志落盘」开关控制，**默认关**、2MB 自动轮转、只留 1 份旧档。排查时才开，平时不写盘（1.7.3 曾因无条件写日志吃盘还过债）。
- 日志目录：`/root/.dsh/bot/logs/diagnostics.jsonl`。

## 可复用结论
扩展工具改完没生效，先分清是「没加载」还是「加载了但索引没刷新」——前者看 `loadExtensionTools` 计数与诊断日志，后者只需一条 QQ 入站消息或重启赶 60 秒窗口，不必反复重启 web。

## 相关
- 语音合成链路本身（BreezeBlue 端点、音色 id、key 路径）见文档 `0f8d15f7-6318-417e-9e71-b94d25df5005`；本机脚本 `/root/Documents/deepseek-harness/default-workspace/shenjing/tools/breeze-tts.mjs`，默认音色 `/root/.dsh/breeze-voice.txt`。
- 插件安装位置：`/root/.dsh/profiles/web/node_modules/@zaofan/dsh-qqbot`。
