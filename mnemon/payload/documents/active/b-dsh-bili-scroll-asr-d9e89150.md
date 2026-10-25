---
id: "d9e89150-1d9d-47a1-a98b-7e2cd35a0887"
title: "刷B站插件（dsh-bili-scroll）运行环境：登录、报告落盘、离线转写（ASR）"
description: "bili-duty 家目录的可用状态与验证方法：扫码登录后凭证落点与校验、手动一轮的产物（out/报告、seen.md 判重、digest 归档）、faster-whisper 离线转写环境（.venv-asr、hf-mirror、small 模型）以及「写 DSH 设置被拒」的已知 quirk。"
status: "active"
created_at: "2026-10-22T15:47:39.351Z"
updated_at: "2026-10-22T15:47:39.351Z"
content_hash: "6251c91d01369cd4ab36bd31d7c0c2a29e40c209e12fcca223047b379a450364"
source_paths:
  []
session_ids:
  - "3ab037c1-8431-4bcc-b84a-9083fcf64ad3"
memory_body_ids:
  []
---

# dsh-bili-scroll 运行环境与验证（2026-10-22 实测）

承接 `f4e00ab9-2870-4e42-b007-c821c01ab7a7`（aarch64 上 uv 架构错配导致依赖装不上）。该文之外的后续状态记录在这里：登录、首轮运行产物、离线转写环境、以及一个设置写入 quirk。

## 1. 家目录现状（/root/.dsh/bili-duty/）

| 路径 | 状态 |
| --- | --- |
| `bin/uv` | 0.13.5 aarch64 手工安装版（源码补丁重载前靠它） |
| `.venv` | MCP 依赖环境，49 个包；插件 `pythonPath` 指向 `/root/.dsh/bili-duty/.venv/bin/python` |
| `.venv-asr` | 转写专用环境（faster-whisper 等） |
| `.hf-cache` | 模型缓存，本轮下载了 Whisper `small` |
| `install.log` / `asr-install.log` | 安装全过程（逐条命令 + 退出码），排错先看这个 |
| `bili_credential.json` | 扫码成功后的凭证（权限 600，含 sessdata / bili_jct / buvid3 / dedeuserid 四字段，**不要复制内容**） |
| `out/2026-10-22.md` | 每轮报告，一条视频一个 `### BV号` 小节 |
| `seen.md` | 判重表，按 BV 号去重，评论记录也在这里 |
| `digest/2026-10.md` | 按月归档摘要（挑中的和跳过的都记） |
| `config.json` | 插件自己的设置（pythonPath、perDay、窗口、reportLevel、keywords 等） |

## 2. 登录：二维码 + 轮询，凭证由插件自己写盘

- 取码 `bili_qrcode_login` → 返回 key/url 与 PNG（`/root/.dsh/bili-duty/qrcode_login.png`，约 3 分钟有效，过期必须重新取码，旧码不可续）；用 present 把 PNG 推给本人扫。
- 扫码后 `bili_login_poll`：未扫时 `state=waiting, code=86101`；成功时**凭证在轮询响应的 Set-Cookie 里**，插件据此写 `bili_credential.json`。
- 校验：`bili_check_credential` 返回 `logged_in: true` 才算完；插件状态接口里的 `loggedIn` 字段在此之前一直是 false，别拿它当唯一判据。
- 第一次轮询报过 `fetch failed`（网络抖动），重试即通——不是登录失败。

## 3. 首轮手动运行

- 触发：`started: true, why: manual, profile: headless, cwd=/root/.dsh/bili-duty`，日志 `duty.log`。
- 结果：挑 5 条（perDay=5 当天用满），写 `out/<date>.md`；判重表追加记录；归档追加到 `digest/2026-10.md`；`autoComment=false` 且未填 @ 对象 ⇒ 一条评论都没发。
- 「回复评论」依赖 `seen.md` 里的评论记录；该表为空时直接跳过，属正常分支。

## 4. 离线转写（无字幕兜底）怎么装

章程里"没字幕就跳过"是默认路径；开了本地转写但环境没装好时，日志写的是"依赖没装好"，等于白跳。

- 独立环境：`<home>/.venv-asr`，用同一份 uv 建，装 faster-whisper 一系（含 yt-dlp、onnxruntime、tokenizers 等）。
- 国内网络必须设 HuggingFace 镜像：`HF_ENDPOINT=https://hf-mirror.com`；实测还要 `HF_HUB_DISABLE_XET=1` 才稳。
- 模型按名字缓存到 `<home>/.hf-cache`，本轮下 `small`（几百 MB，只下一次）；就绪判据是能构造 `WhisperModel(name, device="cpu", compute_type="int8")` 并打印「模型就绪」。
- 完成后设置项 `asrReady=true`。注意：环境装好前跑出的报告里"因无字幕跳过"的结论会过时，修好后应对那几条补看。

## 5. 已知 quirk：改设置写不进 DSH 设置页

运行日志里出现：

```
写 DSH 设置失败：DSH 这边没有可写的设置表单（值只落在插件自己的 config.json 里）
```

即从子代理/命令行改 `reportLevel`、`keywords`、`workspace` 之类，值只会落到插件自己的 `config.json`，DSH 设置界面不会同步；反过来，UI 上的改动以插件 config 为准。要改配置直接改/核对 `/root/.dsh/bili-duty/config.json`，不要以为命令成功就等于界面里也生效。

## 6. 复用要点

- 排错顺序：`asr-install.log` / `install.log` → 环境里 `python -c "import ..."` 验证 → 再看插件状态字段（`loggedIn`、`asrReady`、`venvReady`）。
- 重新装依赖或升级插件会覆盖 `node_modules` 里的 `uvfetch.mjs` 补丁（详见关联文档），升级后要复查架构判断。
- 凭证、二维码都不要贴进文档或对话；只记路径与状态。
