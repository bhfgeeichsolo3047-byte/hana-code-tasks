---
id: "493dab3d-4388-4ca3-b45a-37919318fd53"
title: "Mnemon CLI 安装与 Mnemon Native 记忆空间接入（dsh-mnemon 0.5.37）"
description: "本机安装 @mnemon-dev/mnemon 并接入 dsh-mnemon 的完整步骤、dsh 如何定位 mnemon 二进制、以及向量嵌入缺失时的降级表现。"
status: "active"
created_at: "2026-10-31T17:12:18.814Z"
updated_at: "2026-10-31T17:12:18.814Z"
content_hash: "1d60422252b309c235b990b40389aebe134928af34db2d29ef81189234cd27fb"
source_paths:
  - ".dsh/profiles/web/node_modules/dsh-mnemon-source-memory-spaces/lib/native-cli.js"
  - ".dsh/profiles/web/node_modules/dsh-mnemon-provider-mnemon-native/lib/index.js"
session_ids:
  - "276bac74-7c6d-4bfd-9d6a-a2b869e18de3"
memory_body_ids:
  []
---

# Mnemon CLI 安装与 Mnemon Native 记忆空间接入

## 背景与结论
dsh-mnemon 的 Mnemon Native provider 之前不可用，根因是**本机缺 `mnemon` 二进制**。装好后 `mnemon_status` 立刻转为 `commandFound:true / healthy:true`。

## 安装与验证（本机 Ubuntu 24.04 proot，Android）
- 包名 `@mnemon-dev/mnemon`，版本 **0.2.13**，`engines.node >= 22`（本机 node v24.22.1 满足）。
- 全局安装：`npm install --global @mnemon-dev/mnemon`（npm 11.19.1，registry 为 registry.npmmirror.com），产出 `/usr/local/bin/mnemon`，`mnemon version 0.2.13`。
- 数据目录默认 `/root/.mnemon`（可用 `MNEMON_DATA_DIR` 覆盖），库文件 `/root/.mnemon/data/<store>/mnemon.db`；`mnemon store` 列出 store，`*` 标记当前活动 store。
- 验证：`mnemon status` 返回 `{total_insights, deleted_insights, edge_count, oplog_count, db_size_bytes, by_category, top_entities}`；dsh 侧 `mnemon_status` 应报 `commandFound:true, version:"0.2.13", writeEnabled:true`。
- 常用子命令：remember / recall（关键词）/ search（token 打分）/ related（图遍历）/ link / forget / import / embed --status / viz --format html --output - / store / gc / receipt。

## dsh-mnemon 如何找到这个二进制
`dsh-mnemon-source-memory-spaces/lib/native-cli.js` 的 `resolveMnemonInvocation`：
- 若是 npm 安装形态，用 `process.execPath` 跑 `node_modules/@mnemon-dev/mnemon/bin/mnemon.js`（避免 Electron GUI 可执行文件直接执行 JS）；`mnemon update` 不走原生二进制。
- 否则按 `UNIX_COMMON_CLI_PATHS` 找：`~/.local/bin/mnemon`、`/opt/homebrew/bin/mnemon`、**`/usr/local/bin/mnemon`**、`/usr/bin/mnemon`；Windows 侧还有 `%GOPATH%\bin\mnemon.exe`。
- 可用环境变量 `MNEMON_CLI_PATH` 显式指定路径。

## 记忆空间布局（安装后实测）
```
holographic-d8055f143baa8024b43c9e90  Holographic   文件存储 /root/.mnemon/state/holographic/store.json；支持 search/browse/graph/related/remember/forget，**link:false**，硬删除
default                            Mnemon Native 自动发现的空库（Existing Mnemon Store discovered on disk）
aa485e22-d947-4812-a27b-5740e64c3a2c  Mnemon Native 新建的长期主库（SQLite + 向量检索），支持 link 与软删除
```
- persistenceStrategy 为 `manual`，`allowedProviderIds: ["mnemon-native"]`。
- 新建的空间默认处于**关闭**状态，创建后需手动开启才会参与检索。

## 已知尾巴：向量嵌入失败
- 写入一条记录后返回 `unembedded`，hint 说明：**语义匹配暂时命中不了这条**，关键词 / link / 按时间排序仍可用。
- 原因大概率是本机没有嵌入模型（默认 `nomic-embed-text`，需本地 ollama）。
- 补救路径：嵌入服务可用后，从 Mnemon Native 的 embedding 设置里 **Test status** 触发补齐——它走 DSH 使用的存储根与嵌入配置；直接在终端跑 `mnemon` 可能既读不到同一存储根、也读不到同一嵌入配置。
- 另一个现象：刚写入后立刻 `mnemon recall` / dsh 的 keyword recall 都返回空（`sparse_results`），疑似下一轮才可见，待复查。

## 相关文件
- `/root/.dsh/profiles/web/node_modules/dsh-mnemon-source-memory-spaces/lib/native-cli.js`：二进制解析。
- `/root/.dsh/profiles/web/node_modules/dsh-mnemon-provider-mnemon-native/lib/index.js`：provider 实现（status/graph/list，status 映射为 parseStats）。
- `/root/.dsh/profiles/web/node_modules/dsh-mnemon/README.md`：安装指引第 111 行提到 `npm install --global @mnemon-dev/mnemon`。
