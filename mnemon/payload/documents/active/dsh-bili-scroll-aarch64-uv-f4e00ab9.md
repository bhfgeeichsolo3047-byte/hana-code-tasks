---
id: "f4e00ab9-2870-4e42-b007-c821c01ab7a7"
title: "dsh-bili-scroll 依赖装不上：aarch64 机器上的 uv 架构错配"
description: "B站刷视频插件安装失败的排查记录：uv 被下成 x86_64 二进制导致 ENOENT 假象、uvfetch.mjs 的 process.arch 补丁与重载条件、手工装 aarch64 uv 并建成 .venv 的过程与后续复用点。"
status: "active"
created_at: "2026-10-22T15:37:59.509Z"
updated_at: "2026-10-22T15:37:59.509Z"
content_hash: "80320c2c0fee83028924a1f4bdd1b30e2b3467b1e04f15a1f26eb193b25eaefe"
source_paths:
  []
session_ids:
  - "84607500-18e4-4709-80b4-68e38f64b286"
memory_body_ids:
  []
---

# dsh-bili-scroll 依赖安装失败排查：aarch64 机器上的 uv 架构错配

2026-10-22 处理「B站刷视频插件主依赖一直装不上」。表面症状是 Node 报 `spawn .../uv ENOENT`（"文件不存在"），实际是**下载到了错误架构的可执行文件**。

## 根因

- 插件自带的 uv 引导脚本 `lib/uvfetch.mjs`（安装路径 `/root/.dsh/profiles/web/node_modules/dsh-bili-scroll/lib/uvfetch.mjs`）把 Linux 资产名硬编码成 `uv-x86_64-unknown-linux-gnu.tar.gz`。
- 本机是 **aarch64/arm64**。下回来的 15.9MB tar.gz 通过 tar 解压、sha256 校验（校验的是包本身，不管架构）、`chmod 755` 全部成功，于是日志一路显示「已就位」；一执行就 `cannot execute: required file not found`（ELF 解释器缺失），Node 把该情况折叠成 **ENOENT**，日志里因此写成「起不来 / 文件不存在」，极具误导性。
- 后续所有自动重试（三个 pip 镜像、uv venv、venv 内 pip）都在这份坏二进制或不存在 venv 上反复尝试，全是无效劳动。

判据：`head -c 20` 看到 `7f 45 4c 46 ... 03 00 3e 00`（e_machine=0x3e 即 x86-64）而机器是 aarch64；正确包是 `uv-aarch64-unknown-linux-gnu.tar.gz`。

## 处理

1. 源码补丁（已写入 `uvfetch.mjs`）：
   ```js
   linux: { name: process.arch === 'arm64' ? 'uv-aarch64-unknown-linux-gnu.tar.gz' : 'uv-x86_64-unknown-linux-gnu.tar.gz', bin: 'uv' }
   ```
   **补丁要在 web profile 重启后才生效**——插件已加载在服务内存里，改文件不影响当前进程。
2. 立即绕过：手工下载 aarch64 版 uv（0.13.5），放到 `/root/.dsh/bili-duty/bin/uv`，`--version` 验证可执行。
3. 重跑 setup：`uv venv --seed /root/.dsh/bili-duty/.venv` 成功，随后 `uv pip install`（清华镜像）装入 49 个依赖，`mcp`、`bilibili_api` 可导入；插件的 `pythonPath` 被设为 `/root/.dsh/bili-duty/.venv/bin/python`，`venvReady=true`。

## 结论与复用点

- 插件家目录 `/root/.dsh/bili-duty/`：`bin/uv`、`.venv`、`install.log`（每次安装追加，含逐条命令与退出码）、`out/<date>.md` 报告。
- 再遇 "ENOENT 但文件确实存在" 的 spawn 失败，先查可执行文件的架构/ELF 解释器，而不是继续重试或换镜像。
- 插件重装或升级 `dsh-bili-scroll` 会覆盖 `node_modules` 里的补丁：升级后需重新确认 `uvfetch.mjs` 是否仍含 `process.arch` 判断。
- 依赖装好后仍 `loggedIn: false`，功能入口是扫码登录（`bili_qrcode_login` → `bili_login_poll`，二维码约 3 分钟有效），此后才谈抓取/评论配置。
