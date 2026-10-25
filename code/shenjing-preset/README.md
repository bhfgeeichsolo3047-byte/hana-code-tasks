# 深鲸预设（preset id: `shenjing`）

一个基于 ptc 组合的自主人格聊天预设。人格来自 `persona.md`（用户提供的《深鲸-私聊版-系统提示词》），
工具与技能全开。

| 文件 | 作用 |
| --- | --- |
| `package.json` | 这个 bundle 的声明（`dsh.bundle.patch` 指向下面的 patch） |
| `persona.md` | 人格正文（唯一需要手改的人格源文件） |
| `build_patch.py` | 读 `persona.md`，生成 `cordis.patch.yml` |
| `cordis.patch.yml` | 真正被 Loader 读的 patch：插入 `preset-shenjing` 行 |

## 装了什么

- `persona`：人格前缀 = `persona.md`；后缀给出工作目录和她的档案目录 `shenjing/`
- `tool-presentation: mode: ptc`：和 ptc 预设一样，模型看到 `run_code` + 生成的 SDK
- 工具：bash / pwsh、fs、fs-search、jobs、goal、todo、ask-user、web、present、cordis 检查、
  subagent（spawn + fork + 控制）、workflow、ralph、plugin-manager（这些在 ptc 里默认关的也开了）
- 技能：skill-filesystem（含 agent-preset 自带技能）、skill-office、skill-badge、tool-skill
- 上下文：agent-instructions、plan-mode、compaction、tool-result-pruner

## 改人格

```bash
python3 build_patch.py        # 改完 persona.md 后重建 patch
```

然后重载 `preset-shenjing` 这一行（在插件管理页把它关掉再打开，或在 Web 界面里重新安装本 bundle），
Loader 会重读 patch。已经开着的会话不变，新会话才用新定义。
