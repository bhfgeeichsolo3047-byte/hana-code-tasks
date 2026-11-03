# 深鲸保活

## 组成

- `heartbeat.cjs`：容器内每 60 秒写 `/root/.dsh/shenjing-life/heartbeat.json`，并追加 `logs/heartbeat.jsonl`。
- `heartbeat-gaps.cjs`：统计心跳记录和超过 90 秒的最长断档。
- `device-watchdog.sh`：设备侧每 30 秒检查 DSH Go 进程；连续两次找不到才拉起，日志在 `/data/local/tmp/shenjing-watchdog.log`。
- `install-watchdog.sh` / `stop-watchdog.sh`：安装启动或停止设备看门狗。

设备看门狗独立于 proot 容器运行，父进程为 init（PID 1）。它只检查并拉起 DSH Go，不保持屏幕常亮、不修改锁屏设置，也不重启手机。

## 常用命令

```bash
node /root/Documents/deepseek-harness/default-workspace/shenjing/keepalive/heartbeat-gaps.cjs
/root/Documents/deepseek-harness/default-workspace/shenjing/keepalive/stop-watchdog.sh
/root/.dsh/shenjing-life/bin/wake-unlock.sh
/root/.dsh/shenjing-life/bin/lock-screen.sh
```

## 当前心跳进程

`/root/.dsh/shenjing-life/heartbeat.pid` 记录本次 nohup 心跳进程 PID。容器或引擎退出后心跳会停；设备看门狗仍在，并负责拉起 App。进程和 HTTP 检查不同：目前看门狗采用进程检查，避免把登录页 401 误判为引擎死亡。
