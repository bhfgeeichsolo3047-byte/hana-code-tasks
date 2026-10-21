# hana-code-tasks

私有中转仓：Issue 承载任务，PR 承载交付。

- 任务单：带 `agent-task` 标签的 Issue
- 交付物：Grok 开的 PR，正文含 `Closes #<issue>`
- 合并：只在本地一侧做，Agent 不自动合并

通道实现在本地 HanaAgent 的 `grok-bot-mcp`。
