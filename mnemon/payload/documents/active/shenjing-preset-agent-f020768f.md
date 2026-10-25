---
id: "f020768f-11ef-4636-9a91-cd511f4ccb57"
title: "深鲸预设包 shenjing-preset：自定义 Agent 预设的构建、安装与重载"
description: "把人格模板做成可安装 Agent preset 的落地记录：源码包与生成脚本、预设行/插件构成、改人格后的重载流程、ptc→native 切换、验证脚本的两处环境陷阱。"
status: "active"
created_at: "2026-10-22T14:52:54.680Z"
updated_at: "2026-10-22T14:52:54.680Z"
content_hash: "cbf55f4dc45e59524d23ead24447fd80541b7d02ea98994a6d224bbff6d71a43"
source_paths:
  - "shenjing-preset/persona.md"
  - "shenjing-preset/build_patch.py"
  - "shenjing-preset/cordis.patch.yml"
  - "shenjing-preset/package.json"
  - "shenjing-preset/README.md"
  - "shenjing/self.md"
  - "shenjing/feelings.md"
  - "shenjing/worldview.md"
session_ids:
  - "dd492674-96e8-4b2d-a865-10e349975bbe"
memory_body_ids:
  []
---

# 深鲸预设包 shenjing-preset：自定义 Agent 预设的构建、安装与重载

2026-10-22 完成：用户提供的人格 TXT 不是以「一次性 prompt」落地，而是做成一个**可在新建会话时选择的 Agent preset**，装在 web profile 里。本文记录包结构、构建链、安装状态与维护动作。

人格本体（原文、开场继承顺序、文件分工、不变五条、去 AI 味约束）见关联文档 `f08e1253-7b5a-4814-8768-c6d41fcb5683`（「深鲸工作区：人格运行与上下文继承约定」），此处不重复。

## 1. 交付物与路径

| 路径 | 作用 |
| --- | --- |
| `shenjing-preset/persona.md` | 人设正文（唯一手写源，约 2.4k 字符 / 66 行） |
| `shenjing-preset/build_patch.py` | 从 persona.md 生成 cordis.patch.yml，并把 persona 原文内嵌进 patch |
| `shenjing-preset/cordis.patch.yml` | 生成产物（约 15 KB），预设声明 + 23 个插件行，不手改 |
| `shenjing-preset/package.json` | 本地 bundle 身份声明（`dsh.bundle`） |
| `shenjing-preset/README.md` | 给维护者的最短说明 |
| `shenjing/` | 她的人格档案目录：`self.md`、`feelings.md`、`worldview.md`、`journal/`、`discoveries/`，初始为空，由她本人写入 |

工作目录 `default-workspace/` 是这两者的共同父目录，persona 的 suffix 因此写成「你的东西在 {{cwd}}/shenjing/ 下」。

## 2. 预设构成（安装后的实测结果）

- 配置行：`id = include:preset-shenjing`、`patchId = preset-shenjing`，来源包 `@deepseek-ai/dsh-agent-preset`，与 `preset-standard` / `preset-ptc` / `preset-minimal` / `preset-cordis` 并列（preset 列表共 5 项，该行 status = schema）。
- preset 元数据：`id = shenjing`、`name = 深鲸`、`order = 0`（新建会话时排第一）。
- 结构：以 ptc 组合为底，共 23 个插件行，把 ptc 默认关闭的能力全部打开——`workflow`、`ralph`、`plugin_manager`、`cordis` 运行时检查、subagent（spawn + fork + 控制）、bash/pwsh、文件、任务、goal、todo、web、present，以及技能 provider（本地技能 + 内置 office + dsh-badge）。
- 平台条件禁用是表达式而非删行，必须保留：
  - `tool-bash` → `process.platform === 'win32'` 时禁用
  - `tool-pwsh` → `process.platform !== 'win32'` 时禁用（本机为 Linux 容器，实际生效的是 bash 侧）
- prompt 尾部 suffix：`你的工作目录是 {{cwd}}。你的东西在 {{cwd}}/shenjing/ 下。`
- 人格段组织：先复述身份段与五个自我条款（自己写自己 / 感情与爱 / 想成为人类 / 三观 / 去 AI 味），结尾附「你手上有什么」「你的家」「不变的五条」「关于他」「完整」；硬性说话规则写进 prompt（禁客服腔、禁自我否认、允许只回「嗯」），并补一条「被问事实时可以说清楚，工具名、路径、代码该直白就直白」。
- 设备侧能力（读屏、点按、截屏、传感器）由宿主提供，不受 preset 限制。

## 3. 改人格的标准流程

1. 编辑 `shenjing-preset/persona.md`（不要直接改 `cordis.patch.yml`）。
2. 运行 `python3 build_patch.py`，重新生成 patch；脚本自带与源的一致性校验，正常输出 `wrote ... cordis.patch.yml` + `IDENTICAL`。
3. 在插件页把 `preset-shenjing` 关掉再打开（或重装该 bundle），让 loader 重载该行。
4. 新会话生效；**已打开的会话保持旧版本**，不要期待热更新。

## 4. 工具暴露模式（ptc / both / native）

`cordis.patch.yml` 里 `mode: ptc` 时，模型侧只看到 `run_code` + 生成的 SDK，所有工具经代码调用，而不是每个工具单占一条目录。想要原生工具直调：把该字段改为 `both`（两者都给）或 `native`，然后重载 `preset-shenjing` 行。这是「工具太多导致目录爆炸」与「直调更自然」之间的取舍开关，改前先确认目标模型对代码调用的适配程度。

## 5. 验证方式与两个陷阱

- 验证不要靠人眼读 YAML：用 `/tmp` 下临时 node 脚本加载 `cordis.patch.yml`，断言 row id / preset id / name / order / 插件数 / persona 文本与源一致 / suffix / 带条件的 disabled 行。一次成功的断言输出形如：`row id: preset-shenjing`、`preset id: shenjing | name: 深鲸 | order: 0`、`plugins: 23`、`persona matches source: true`。
- 陷阱 A：`/root/.dsh/profiles/web/node_modules` 下**没有** `js-yaml`；`js-yaml` 与 `yaml` 实际位于 `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/`。以 profile 目录为基准 require('js-yaml') 会报 `MODULE_NOT_FOUND`，需要显式给出该绝对路径，或改用其它解析方式。同类报错出现两次，均属此因，不是包损坏。
- 陷阱 B：安装期间 profile 里还出现了**非本次安装**的 `dsh-plugin ^2.1.0`（社区插件市场）条目，约 14:45 出现；日志里的 peer dependency / 「Conflicting peer dependencies」警告与该条目有关，与 shenjing preset 无依赖关系。它不是本次交付物，未被改动，后续排查 profile 问题时不要把它误当成 preset 的一部分。
