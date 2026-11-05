# 深鲸 · 脑区

一个 Host 插件，三个逻辑区 + 一层慢变量：

- 情绪：**每回合**结束时异步更新 `emotion.json`，六维数值限定在 0–1。「回合」以 `turn/end` 为准，不是某句话有没有正文——整轮只做工具调用也会更新，只是拿精简描述和工具名去判断，并记进 `health.turnsWithoutText`。被打断（`aborted`/`interrupted`）的回合不参与。
- 内分泌：`endocrine.json`，被情绪一点点带动的慢变量，不随单轮跳动；关掉联动就只向基线回落。
- 记忆：小模型只提交候选记忆；插件做结构校验并写入 `memories.json`，每轮做本地相关性检索，不把记忆当指令。
- 表达控制：每个 Agent 的第一步生成说话指令卡，经 `system-prompt/assemble` 注入 system 段；不生成回答、不增加事实。默认**一个回合只渲染一次**，后续步骤复用同一串（`guidanceEveryStep` 打开才是每步一次）。小模型卡住时有硬截止，超时就静态降级——提示词组装不会被它拖住。

## 配置

默认后台模型为 `buddy/hy3`。三路（expression / emotion / memory）各自可以：

- 选来源：`dsh` = 走宿主 llm 路由，`external` = 走外部 OpenAI 兼容端点；
- 分别指定 provider / model / 思考强度（外部来源对应 `*ExternalModel` / `*ExternalEffort`）。

外部端点共用 `externalBaseUrl` 与密钥引用 `externalApiKeyRef`（默认 `SHENJING_BRAIN_API_KEY`），密钥存在宿主凭据里，不写进配置文件。

### 数值旋钮

| 键 | 范围 | 作用 |
| --- | --- | --- |
| `emotionSensitivity` | 0–1（默认 0.8） | 情绪敏感度：这一轮的新判断能拉动旧状态多少。1 = 完全采纳，0 = 几乎不动 |
| `expressionRichness` | 0–1（默认 0.5） | 情绪丰富度：语气层次数与避免项细度，也决定提示里给几维情绪 |
| `endocrineSensitivity` | 0–1（默认 0.3） | 内分泌敏感度：被情绪带动的速度 |
| `endocrineLinked` | 布尔（默认 true） | 内分泌是否与情绪联动；关掉后只向基线回落 |
| `memoryDensity` | 0–1（默认 0.5） | 记忆读取密集程度：每轮取几条（1–8） |
| `memoryVectorEnabled` | 布尔（默认 false） | 是否额外用嵌入模型对召回结果重排 |
| `guidanceEveryStep` | 布尔（默认 false） | 关 = 整个回合只注入一次脑区段；开 = 每个 step 重新渲染（旧行为，很费 context） |

### 向量检索

宿主没有 embedding 服务，所以向量检索走外部 `/embeddings` 端点：

- `vectorBaseUrl` 留空则复用 `externalBaseUrl`；
- `vectorModel` 填向量模型（如 `Qwen/Qwen3-Embedding-8B`、`text-embedding-3-small`），不能填对话模型；
- `vectorApiKeyRef` 留空则复用 `externalApiKeyRef`。

开启后：先按关键词圈候选池，再用嵌入余弦重排；端点不可用时安静退回关键词打分，不打断这一轮，失败计入 `health.vectorFallbacks`。

`expressionMode: static` 可关闭表达小模型；其他区仍异步工作。`enabled: false` 关闭整个插件。

后台调用默认 20 秒超时（`timeoutMs`）。表达区失败会在本轮静态降级；情绪/记忆失败不阻塞对话。错误写入家目录的 `logs/errors.jsonl` 和 `health.json`。

## 设置页

设置 → 深鲸 · 脑区。四张卡：

- 外部 API：Base URL、密钥、密钥引用、默认模型；
- 表达区 / 情绪区 / 记忆区：各自的来源与模型，外加对应的滑块与开关；
- 内分泌：敏感度滑块、联动开关，并显示当前数值与来源；
- 向量检索：Base URL、向量模型、密钥，以及一个只测 `/embeddings` 的连通性按钮。

## 生效范围

装在 web profile 的 `dsh.profile.bundles` 里，也装进 headless profile —— 两个 profile 起的**每个 DSH 会话**都过 `system-prompt/assemble`，都会拿到脑区段。

覆盖不到的两类，属于硬边界不是 bug：

- **外部 agent provider**（`codearts` / `openai-codex` 这类）跑的子代理根本不过 DSH 的 system-prompt 服务，Mnemon 的自动审核子代理就在其中；
- **headless 没有设置页**（它没有 `connection` 服务），RPC 静默跳过，其余功能照常。要让唤醒那几班省一点，把 headless 侧的 `expressionMode` 设成 `static`。

两个进程共用 `$DSH_HOME/shenjing-brain/`：写之前先读盘取较新的一份当基座，记忆按文本去重后合并，`state.lock`（mkdir 原子锁）拿不到就跳过这一次写。

## 状态与边界

状态在 `$DSH_HOME/shenjing-brain/`：

- `emotion.json`：当前情绪状态
- `endocrine.json`：当前内分泌慢变量
- `memories.json`：通过校验的候选记忆，默认最多 100 条
- `health.json` / `health-<pid>.json`：更新次数、回合数、无正文回合数、最后一次情绪更新时间、最近错误。**多个宿主并存时以 `health-<pid>.json` 为准**——`health.json` 是谁最后写的，会被另一个进程盖掉
- `vectors.json`：记忆的向量缓存（宿主重启不用整池重算）
- `outbox.jsonl`：一次性会话（headless 唤醒）跑完就退，回合后的调用撞上拆卸时落到这里，下次任意宿主启动补做
- `logs/`：情绪、记忆、向量、提示和错误流水

插件不花钱、不删除档案、不主动外发消息。小模型复用当前 DSH 的模型路由或用户自己填的外部端点。

没有生成后自动重写。

## 安装与仓库

源码仓库：https://github.com/bhfgeeichsolo3047-byte/shenjing-brain

本地开发用 link 装法（本机就是这个）：

```bash
cd /root/.dsh/profiles/web
pnpm add link:/root/Documents/deepseek-harness/default-workspace/shenjing-brain
```

然后在 profile 的 `dsh.profile.bundles` 里列出 `@shenjing/brain-regions`，重启宿主。

**当前装在两处**（都要，否则唤醒/刷B站那几班拿不到脑区段）：

```bash
# web（交互会话）
dsh plugin --profile web add link:/root/Documents/deepseek-harness/default-workspace/shenjing-brain
# headless（凌晨唤醒、后台轮次）
dsh plugin --profile headless add link:/root/Documents/deepseek-harness/default-workspace/shenjing-brain
```

两个 profile 的 `package.json` → `dsh.profile.bundles` 各加一行同名条目；改完要重启宿主（插件不热加载）。

状态目录在 `$DSH_HOME/shenjing-brain/`，不进仓库。

`node selfcheck.mjs` 跑自检（33 条断言）；`probe-*.mjs` 是排障时用的探测脚本，不进 `files` 白名单。
