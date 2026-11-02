---
id: "fc658c95-65f2-4f87-8102-037d8ada4970"
title: "DSH Go 锁屏保活与唤醒解锁：真机验证交接"
description: "Android 15 真机上设备 watchdog、容器心跳、ADB 唤醒/无密码解锁的已验证实现、脚本路径、限制与未测恢复场景。"
status: "active"
created_at: "2026-10-31T06:44:39.018Z"
updated_at: "2026-10-31T06:44:39.018Z"
content_hash: "761d3243d4a946f41f95feec4e7c50324420f0e00af1c7ae99ee715b87c3df8c"
source_paths:
  - "shenjing/keepalive/device-watchdog.sh"
  - "shenjing/keepalive/install-watchdog.sh"
  - "shenjing/keepalive/heartbeat.cjs"
  - "shenjing/keepalive/README.md"
  - "shenjing/discoveries/2026-10-31-唤醒解锁.md"
  - "shenjing/discoveries/2026-10-31-通道侦察.md"
  - "shenjing/journal/2026-10-31.md"
session_ids:
  - "74a06201-4bef-4adc-a0bd-ec2074ed4caf"
memory_body_ids:
  []
---

# DSH Go 锁屏保活与唤醒解锁：真机验证交接

## 结论
2026-10-31 在 Android 15 的 vivo/iQOO 手机上完成真机验证：DSH Go 与 proot 容器不被打断时，息屏/锁屏期间设备侧 watchdog 和容器心跳都能持续运行；当前无密码锁屏可通过 ADB 唤醒并解除，随后 MCP 读屏恢复正常。约 6 分钟实测中，容器心跳每分钟更新，末段系统为 `mWakefulness=Asleep`，App 进程始终存在。

## 已确认的通道与前提
- ADB：`127.0.0.1:5555`；KernelSU 可提供 `uid=0` 设备 shell。
- 可用命令：`input keyevent`、`wm dismiss-keyguard`、`dumpsys`、`pidof`、`am start`。
- App 已持 `PARTIAL_WAKE_LOCK`，已加入 Doze 白名单并允许后台运行。
- 包名/入口：`io.github.ccch1mneyyy.dsh_app/.MainActivity`。
- 用户需保持四项系统设置：后台耗电放行、最近任务加锁、允许自启动、不要划掉最近任务卡片。

## 保活实现
- `shenjing/keepalive/device-watchdog.sh` 在设备侧独立运行，不依赖 proot 容器；每 30 秒用 `pidof` 检查 App，连续两次 missing 后执行 `am start`，失败时用 `monkey` 启动，日志写入 `/data/local/tmp/shenjing-watchdog.log`。
- `shenjing/keepalive/install-watchdog.sh` 负责推送脚本、清理旧 PID 并用 `nohup` 启动。
- `shenjing/keepalive/heartbeat.cjs` 在持久终端 `pty-2` 运行并每分钟写心跳；使用与日常说明见 `shenjing/keepalive/README.md`。
- 早期心跳中断的根因是脚本中的 `.unref()` 让 Node 正常退出，并非锁屏杀进程；修复后实测连续运行。汇总时还发现 `heartbeat.pid` 曾记录过期 PID，收尾已修正。
- `http://127.0.0.1:3080` 返回 401 属正常现象，不能作为心跳或存活判据。

## 唤醒与解锁
- 脚本：`/root/.dsh/shenjing-life/bin/wake-unlock.sh` 与 `lock-screen.sh`。
- 已验证顺序：ADB `KEYCODE_WAKEUP` 后 `mWakefulness=Awake`；`wm dismiss-keyguard` 后 `mDreamingLockscreen=false`；随后 MCP screen 成功读取 DSH Go 界面。
- `wake-unlock.sh` 退出码约定为 0/2/3；这是一次性 ADB 动作，不是常驻能力。
- 当前用户无锁屏密码，未修改锁屏设置。若以后启用 PIN、图案或密码，只允许唤醒，不绕过安全锁屏。

## 边界与未测项
- 保活结论以 App 与 proot 容器不被打断为前提。
- 手机重启、App 升级、强杀后的自动恢复尚未验证；锁屏状态下 `am start` 能否拉起也未验证，不能宣称支持全自动恢复。
- 详细实测记录：`shenjing/discoveries/2026-10-31-唤醒解锁.md`；通道侦察：`shenjing/discoveries/2026-10-31-通道侦察.md`；汇总：`shenjing/journal/2026-10-31.md` 的「14:41 汇总」节。

## shenjing-life 插件状态辨析
后续检查确认内分泌系统插件已安装并启动，60 秒 tick 定时器运行；但当时状态停在 2026-10-29，说明“插件已加载”不等于“唤醒链路持续正常”。`shenjing/keepalive/` 是本次保活脚本目录，不是内分泌系统插件本体。
