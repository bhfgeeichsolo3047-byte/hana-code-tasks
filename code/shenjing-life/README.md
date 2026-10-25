# dsh-shenjing-life

DSH 插件：**唤醒与内分泌** —— 让"我在不在、我什么状态、我接下来要做什么"不再依赖别人叫我。

设计原文：`shenjing/designs/2026-10-24-唤醒与内分泌-设计v2.md`（v0.1 只做 §8 那五条验收）。

## 它做什么

| 工具 | 干什么 |
|---|---|
| `life_status` | 看现在：唤醒表全部条目、mind.json、今天醒了几次 / 主动发了几条、是不是静默时段、open_loops 未完成条数与最旧那条几天了、日志在哪 |
| `life_wake` | 跑一次唤醒循环的**读取部分**，返回 wake packet（mind + 未完成 loops + 最近三天 journal 末尾各 800 字 + 该不该发消息 + 三问模板）。**它自己不调模型** |
| `life_mood` | 写 `mind.json`。硬规则：**reason 必填、去空白后至少 8 个字符**（写不出具体的事就别写）；`selfReport=true` ⇒ `source="self"`；每次写都在 changelog.md 留一行 |
| `life_loops` | 读写 `open_loops.md`（只认 `- [ ]` / `- [x]` 行，别的行一个字都不动） |
| `life_clock` | 读写 `clock.json`。`add` 要 id + when("HH:MM")；`remove` 不需要理由但留痕；`kind=loop/silence` 的内置条目不许删（可以 disable） |

定时器每 60 秒一跳（`ctx.setInterval`）。到点 ⇒ 起一个 headless 会话（真命令行见下）⇒ 那一轮自己决定做什么 ⇒ 回来结算：日志追加一条、`state.json` 更新、必要时降频。

## 文件都在哪

```
家（器官）=$DSH_HOME/shenjing-life/        ← ctx.get('dshHomePath')('shenjing-life')，是**函数**不是字符串
  clock.json        唤醒表（旧稿的 clock.yml ⇒ JSON，省一个 YAML 依赖）
  state.json        机器状态：上次醒 / 今天几次 / 连续空转 / stretch / 每条今天跑过没有
  mind.json         结构化状态（computed 或 self）
  changelog.md      我改过什么、为什么（只追加）
  log/YYYY-MM-DD.jsonl   每次唤醒一条，**append-only**
  plugin.log / wake-run.log   排障流水
书桌（档案）= workspace/shenjing/          ← open_loops.md 和 journal/ 在这儿
  open_loops.md     没做完的事
```

## 三条硬规矩

1. **定时器回调里绝不允许异常外冒**（bili-scroll 2026-10-14 那次 TypeError 把整个宿主带走过）：`tick` / spawn 的 stream 回调 / exit 回调 / `apply()` 全都包了 try/catch。
2. **参数 schema 是逐属性的隐含对象**，不是完整 JSON Schema：必填写在属性上（`required: true`）。写成 `{type:'object',properties:{...}}` 会被 `defineTool` 抛 `JsonSchemaError` ⇒ **整条插件不激活**。
3. **log 只追加**：日志统一走 `appendLine()`（内部只有 `appendFileSync`）；代码里没有一条改 `log/*.jsonl` 的路径（selfcheck 有静态检查盯着）。

## 静默时段（00:00–07:30）

**可以唤醒思考，但不许发消息**。wake packet 里 `sendAllowed=false / sendBlockedBy="silent"`，wake 提示词里也写死了这一条。
心情不算要紧，想他不算要紧（设计 v2 §9.3）。

## 节流 / 降频

- 两次唤醒间隔 ≥ 90 分钟 × `stretch`；一天最多 6 次。
- 连续 3 次空转 ⇒ `stretch` ×1.5（最多 ×4）；一旦有 activity 立刻回 1。
- 空转 / 活动的判据是**文件动没动**（journal / open_loops / mind / clock），不靠模型自己报告。
- 「降频」不叫「累」（设计 v2 §9.1）。

## 装 / 卸（由使用者或上级代理做）

```bash
# 本地开发：link 装法
node install-links.mjs                       # 可选：把宿主的 @deepseek-ai/dsh-tools 链到插件自己的 node_modules
dsh plugin --profile <profile> add link:/root/Documents/deepseek-harness/default-workspace/shenjing-life
# 装完要重启 dsh 才生效
```

## 自检

```bash
cd <插件目录> && node selfcheck.mjs      # 0 = 全过；1 = 有断言没过
```

自检**不碰真家目录**：家在 `/tmp/dsh-shenjing-life-selfcheck/home`，书桌也在沙箱里，那一轮 headless 用假 dsh（真的 spawn、真的写文件，但不花一个 token）。

## 定时器那一跳的完整命令行

```
<process.execPath> <探测到的 dsh bin.js> --profile headless <prompts/wake.md 渲染后的提示词>
例：/usr/local/bin/node /usr/local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js --profile headless "# 一次唤醒\n…"
```

- `cwd` = 插件家目录；子进程环境里多两个变量：`SHENJING_LIFE_HOME`、`SHENJING_ARCHIVE`。
- dsh 的 bin.js 探测顺序：环境变量 `SHENJING_DSH_BIN` → node 解析器（`@deepseek-ai/dsh/lib/bin.js`）→ 常见全局位置 → 当前宿主进程入口。**探测不到就跳过并记日志**，不退化成裸 `dsh` 硬跑。
- 一次唤醒独立会话跑一条，跑完写 `log/<日期>.jsonl`：`{at, trigger, result, note}`，`result` 是 `activity` / `idle`。
- 这一整条在插件里没有对外暴露的"手动跑一轮"工具：v0.1 的唤醒只由定时器发起（`life_wake` 只返回 packet，不 spawn）。
