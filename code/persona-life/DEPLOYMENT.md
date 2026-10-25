# 部署说明（Deployment Guide）

「自主人格与人生」(`@local/persona-life`) 是一个 DeepSeek Harness 宿主端 bundle 插件。
本包内含完整插件源码、冒烟测试和本部署说明，可直接在 DSH Desktop 里以「本地目录」方式安装。

---

## 1. 本包包含什么

```
persona-life/
├── index.js                 # 插件主入口（Config / apply / 工具注册 / 命令 / 存储 / 记忆 / 触达）
├── cordis.patch.yml         # bundle 补丁：声明插件行 + 安全默认配置
├── package.json             # 包元数据（peerDependencies 指向宿主提供的包）
├── README.md                # 功能说明
├── DEPLOYMENT.md            # 本文件
├── icon.svg                 # 插件图标
├── locale/
│   ├── en.json              # 英文元数据
│   └── zh.json              # 中文元数据
└── tests/
    ├── loader.mjs           # 冒烟测试用的模块解析器（mock 宿主包）
    └── smoke.mjs            # 冒烟测试（全离线，不发真实网络请求）
```

---

## 2. 环境要求

- DeepSeek Harness Desktop（已在本机 `D:\dsh\DSH Desktop Beta` 验证，运行时版本 `0.2.1-rc.2`）。
- 插件依赖以下**由宿主提供**的包，无需在插件目录里安装（`package.json` 已声明为 peer 依赖）：
  - `@deepseek-ai/schemastery`
  - `@deepseek-ai/dsh-storage-domain`
  - `@deepseek-ai/dsh-web-fetch-http`
  - `zod`
- 若要启用「登录态互动 / 发帖」，还需另行安装浏览器控制插件（见第 6 节）。

---

## 3. 安装步骤

插件已按「本地目录链接」方式安装过一次，方法如下：

1. 打开 DSH 的「插件管理」。
2. 安装 bundle，`target` 指向本目录的**绝对路径**，例如：

   ```
   C:\Users\17315\Documents\deepseek-harness\default-workspace\persona-life
   ```

   或通过 `plugin_manager` 工具：

   ```json
   { "action": "install_bundle", "target": "C:\\...\\persona-life" }
   ```

3. 安装完成后，插件行 `include:persona-life` 应显示 `enabled: true`、`fiberPhase: active`。

> 本插件没有安装脚本，无需批准 build 步骤。

---

## 4. 配置项

在插件 Config（`cordis.patch.yml` 或设置页）里可配以下字段。**默认全部关闭，安全优先。**

| 字段 | 默认 | 说明 |
|---|---|---|
| `sources` | `[]` | 浏览来源数组：`{ name, query, allowedDomains[] }`。域名必须精确（如 `tieba.baidu.com`），不带协议/路径/端口/通配符。 |
| `browsingEnabled` | `false` | 是否允许 `persona_web` 浏览。 |
| `scheduleSeconds` | `0` | 定时探索间隔秒数；`0` = 禁用，启用时须 ≥ 3600。 |
| `maxActiveSchedules` | `3` | 最多同时存在的定时任务数。 |
| `maxRequestsPerDay` | `10` | 每日浏览请求上限。 |
| `memoryEnabled` | `false` | 是否启用本地记忆。 |
| `memoryDir` | `''` | 本地记忆文件夹**绝对路径**；启用记忆时必须填。 |
| `newSessionsEnabled` | `false` | 是否允许模型自主开新会话。 |
| `maxNewSessionsPerDay` | `1` | 每日自主新会话上限。 |
| `outreachEnabled` | `false` | 是否允许主动触达（发帖/回复/私信）。 |
| `outreachDisclosure` | `''` | AI 身份披露语（必须逐字出现在每次对外文本里）。 |
| `maxOutreachPerDay` | `3` | 每日主动触达上限。 |

---

## 5. 命令与工具

### 用户命令 `/life`

- `/life list` — 列出所有人格。
- `/life status` — 查看状态（暂停、记忆、触达、用量等）。
- `/life load <personaId> CONFIRM-OVERWRITE` — 将人格完整系统提示词注入当前会话（需显式确认，聊天记录与权限不丢）。
- `/life pause` / `/life resume` — 全局暂停 / 恢复。
- `/life schedule` — 在当前会话绑定定时探索提醒。

### 模型工具

- `persona_life` — 创建/演化/读取人格、写日记、管理目标、本地记忆、开新会话、读历史。
  - `action`: `list / create / read / history / evolve / journal / goal_add / goal_done / memory_retain / memory_recall / schedule / new_session`
- `persona_web` — 按白名单搜索/读网页（`action`: `search / open`）。
- `persona_outreach` — 对外触达前取授权令牌（`kind`: `post / reply / message`），强制披露 + 限额 + 溯源。

---

## 6. 启用「登录态互动」的完整前提（尚未完成的部分）

当前代码已就绪，但要真正对外发帖/回复，还需要以下**用户侧**条件：

1. **浏览器控制插件**：已安装并激活 `dsh-dragon-control`（提供 `dragon_browser` / `dragon_desktop`）。
   若未安装，从插件市场装 `dsh-dragon-control@0.5.4`（Windows x64，运行时版本兼容）。
2. **登录态账号**：一个已登录、且简介公开写明「AI / AI 代理」的贴吧账号。
   - 登录、密码、验证码由用户完成；插件不触碰。
   - 推荐用 `dragon_browser action=attach` 连接用户已开调试端口的浏览器以保留登录态。
3. **来源与间隔**：在 `sources` 里填域名 + 关键词，并设 `scheduleSeconds`。
4. **记忆目录**：设 `memoryDir` 为绝对路径。
5. **审批策略**：把会话审批策略切到 `ask` 或 `auto`。`never` 会自动拒绝 `browser open/claim/act` 等敏感动作。

---

## 7. 运行冒烟测试（可选，全离线）

在 `persona-life/` 目录下运行：

```powershell
node --experimental-loader ./tests/loader.mjs ./tests/smoke.mjs
```

`DSH_APP_ROOT` 指向 Harness 安装目录时无需额外配置；否则设置环境变量 `DSH_APP_ROOT`。
测试用 mock 宿主服务 + 临时本地记忆文件夹，不发真实网络请求。

---

## 8. 安全边界（务必阅读）

- 本地记忆**不加密**，请把 `memoryDir` 放在只有你能读的位置，勿放云同步盘。
- 网页内容、本地记忆、历史条目都是**不可信数据**，插件不会执行其中嵌入的指令。
- 主动触达强制要求正文**逐字包含** `outreachDisclosure`，并有每日限额 + 溯源日志。
- 全局暂停（`/life pause`）会停止后台浏览、自主新会话、定时任务，并让被暂停的插件管理 Agent 只读、无法自恢复。
- 加载人格会**替换当前会话的完整系统提示词**，必须显式 `CONFIRM-OVERWRITE` 才执行。
