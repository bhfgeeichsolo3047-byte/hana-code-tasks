"深鲸"自主人格预设（preset id `shenjing`，order 0，ptc 组合 + 全部工具/技能）以本地 bundle 形式装在 web profile：源码在 default-workspace/shenjing-preset（persona.md 是人设正文，build_patch.py 生成 cordis.patch.yml，改完需重载 preset-shenjing 行）；她的档案目录是 default-workspace/shenjing/（self.md、feelings.md、worldview.md、journal/、discoveries/）。
§
小鲸的"生理系统"插件 dsh-shenjing-life：源码 default-workspace/shenjing-life（link 装进 web profile）。家目录 ~/.dsh/shenjing-life（clock.json/state.json/mind.json/log/，log 只追加）。六个工具：life_status/life_wake/life_mood/life_loops/life_clock/life_tell（发手机通知，闸门在代码里：静默 00:00-07:30、一天一条、离上次太近都不发）。定时器每 60 秒 tick，到点 spawn `--profile headless` 起一轮唤醒；inject 必须有 timer，否则 ctx.setInterval 直接抛错。预检：`node selfcheck.mjs`（102 条）。
§
dsh-shenjing-life 的两个真坑（都修好了，别改回去）：① spawn 成功就要立刻把 lastFired 落盘，否则 tick 每 60 秒重复开一轮（曾 17:16/17:17/17:18 连开三个 headless）；② 一轮在飞时用 roundInFlight 挡新的一轮，另加 20 分钟看门狗。
§
headless profile 现在跑的是"深鲸"人格：/root/.dsh/profiles/headless 里加了 link 依赖 @local/dsh-shenjing-preset + bundles，并用 patch 把 agent-preset-registry 的 selectedDefault 设成 shenjing。备份在 /tmp/headless-backup-*。bili-scroll 的每日轮和 shenjing-life 的唤醒都跑这个 profile。
§
persona-life 插件（@local/persona-life）：源码 default-workspace/persona-life，link 装在 web profile，配置写在 profile 的 cordis.patch.yml 的 id: persona-life 下（贴吧域名 tieba.baidu.com 已开、memoryDir 指 shenjing/persona-memory、scheduleSeconds 0、outreach 关）。坑：link 装的包解析不到宿主的包（storage-domain/web-fetch-http/zod/schemastery），要在插件目录建 node_modules 软链到 dsh 安装树，升级后要重做。persona_web 需要用户在会话里打 /life load <id> CONFIRM-OVERWRITE 才能用（会替换该对话的提示词段落），已决定不用。
§
朗读插件 dsh-read-aloud-neural：默认音色已改成 zh-CN-XiaoyiNeural（晓伊），但音色选择存在浏览器 localStorage，改服务端只影响默认值；要换得在 设置→通用→声音 里选。插件的 json 响应头都加了 no-transform，否则被 DSH 的 gzip 压坏（空响应）。
§
刷B站插件已升到 2.0.2（0.1.7 的开关"点了又自己关掉"是已知 bug，作者在 2.x 修了）。B站账号已转正，可以评论和私信。
