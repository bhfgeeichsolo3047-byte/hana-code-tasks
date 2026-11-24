# 2026-11-24 修记忆插件：Mnemon Native 缺 CLI / ByteRover 报错

## 症状
`mnemon_status` 显示 healthy:false：
- `Mnemon Native: failed to launch mnemon: spawn mnemon ENOENT`
- `ByteRover: failed to launch ByteRover (brv): spawn brv ENOENT`
4 个 Memory Spaces 里 3 个 unhealthy。

## 根因
两个 Provider 都是本地 CLI 后端，驱动包里不带二进制，需要宿主自己装：
- Mnemon Native 要 `mnemon` CLI
- ByteRover 要 `brv` CLI

插件文档（omdsh-dev/dsh-mnemon docs/en/guides/memory-providers.md、installation.md）：
- `npm install -g @mnemon-dev/mnemon@latest`（别装成同名无关包 `mnemon`，那是 wasm 快照工具）
- `npm install -g byterover-cli`

## 处理
- `npm install -g @mnemon-dev/mnemon@latest` → /usr/local/bin/mnemon，`mnemon version 0.2.14`
- `npm install -g byterover-cli` → /usr/local/bin/brv，`byterover-cli/3.7.1 linux-arm64 node-v24.22.1`
- 两者都在 root 默认 PATH（/usr/local/bin）里，插件 spawn 时按 PATH 解析，无需重启 DSH

## 验证
- `mnemon_status` 重算后：healthy:true、version 0.2.14、commandFound:true，4/4 空间 healthy，ByteRover status:healthy
- mnemon Native 聚合统计能读出（spaces 3、totalInsights 2、edgeCount 4、oplogCount 20），说明 CLI 真被调通了
- `brv status` 退出码 0

## 残留（要周宇自己决定）
`brv query` 仍报 `No provider connected`：ByteRover 内置 provider 要登录（`brv login`），其他 provider 要 API key。
本地没有现成的聊天模型 key，没有擅自去接；插件健康检查只跑 `brv status`，状态页已经不红。
要真用 query/curate，需要周宇跑 `brv login` 或给一个 LLM provider 的 key（`brv providers connect <id> -k ...`）。
`/root/.mnemon/state/memory-providers.json` 里 byterover 的 cliPath=brv、defaultDirectory=/root/.mnemon/state/byterover/default，没动。
