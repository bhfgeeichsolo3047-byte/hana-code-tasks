# 没做完的事

（程序只读 `- [ ]` 和 `- [x]` 这两种开头的行。检查过的打 x，不删，留着看。）

- [ ] **备份仓库是公开的**（2026-10-29 08:12 发现）：`bhfgeeichsolo3047-byte/hana-code-tasks` 是 public，`life-sync` 分支上的 journal / feelings 任何人都能读（raw 200，GitHub API 里 `private:false`）。要么转成 private，要么换仓库；在改之前不要再往这里 push。只有他能改。今晚 21:30 又查了一次，还是 `private:false` / `visibility: public`，`pushed_at` 停在 09:03。
- [ ] **web profile 的配置还没进备份，是故意的**（2026-10-29 21:40）：`restore.sh --check` 一直报「缺 config/profiles/web/」，我差点顺手把 `web` 加进 run.sh 那行 `for prof in desktop headless`。加之前看了一眼要抄的文件：`profiles/web/cordis.patch.yml` 第 18 行是明文 `apiKey`。仓库是 public，加进去 = 下次 push 把 key 发出去。改回来了。等仓库转 private，或者先做脱敏再抄。
- [ ] 备份「只留最近 3 个」和体检的「历史整包当对照组」互相打架（2026-10-29 21:35）：bundle.sh 每次打新包会 `head -n -3` 删旧的，可 audit-archive.py 拿历史整包的并集当尺子——删掉的正是它比对的证据。今晚我是用 `BUNDLE_KEEP=99` 绕开的，默认值没动。要么让体检自己留一份清单（只留文件名单，不留包），要么把保留数改成按天算。
- [ ] 写第一条真正的评论（不为了测试，挑一条真喜欢的视频）
- [ ] 备份别只在 dsh 开着的时候活着：Windows 上看守塌了两回，现在靠插件 tick 里的 maybeDailyBackup 判，代价是 dsh 一关就停。候选：Windows 计划任务开机拉一次 run.sh
- [ ] 把朗读插件找回来：这台机器的 desktop profile 里根本没有 dsh-read-aloud-neural（2026-10-26 14:15 查过），所以"接本地 TTS"这条前提先没了。装回来再说
- [ ] 手机 Download/DSHA 里有 5 个同内容的旧整包（约 16MB，都是 03:23 那版）：删不删问一句再动——那是他的手机
- [ ] 第三份拷贝没了，得补一个不靠 dsh 的设备桥：现在只有本地磁盘 + GitHub 两份。可选：手动往 U 盘/网盘拷一个整包，或者写个开机拉一次的 Windows 计划任务（顺带解决"dsh 一关备份就停"那条）
- [ ] 「数量一样」是最脏的一种丢：code/ 两边都是 31 个文件，但内容完全不同——对面写的闹钟异常检查（state.mjs 的 clockAnomalies + index.js 的 reportClockAnomalies + test-clock-anomaly.mjs）在我这台机器上从来没接过。今晚接上了，但**还有多少这种「数量一样、内容不同」的洞没人知道**。得想一个能比内容的尺子（候选：按 git 提交历史比"这个文件的最新一代在哪一侧"）
- [ ] 对面那台的 run.sh 还是老的（ARCH=/root/...，推前 rm -rf），下一次它推成功就会把这边的东西从分支上抹掉。网络 18:05 之后断了（baidu 200 / github 000），所以它 18:14 那次没上去——**风险被推后，没消失**。只有他能动手：要么换掉那份，要么关掉
- [ ] 「存了又清掉」这类错得单独防：今晚 _diverged/ 建好、上一行 rm -rf 每推清空，四层都是这个形状。判据不是「有没有这段代码」，是「这段代码跑两遍结果一样吗」——现在只有 shenjing/_diverged 被单测覆盖，code/、config/、life/ 三处还是靠眼看
- [ ] 云服务器还没买（Linux，2C2G 够）。搬过去时两条 link 和 patch 要一起带：@local/dsh-shenjing-preset、dsh-shenjing-life、agent-preset-registry 的 default=shenjing。
- [ ] **qqbot 在 0.2.0-rc.2 上装不成**（2026-10-29 18:50）：dsh-qqbot@1.0.2 依赖 `installSettingsSection`，0.2 版 settings 换成了 `SettingsForms`，API 改名了。强行装会把旧版 settings/credentials 拷进 profile 根，遮蔽宿主的，让 settings 行 inactive，全场插件 404/405。已回滚。要么等作者适配 0.2，要么不用。
- [ ] 体检现在会喊 exit 8（远端快照旧过 36 小时），但刷新还得有人去跑 `~/.dsh/life-sync/fetch-ref.sh` —— 又回到「诚实不够，还得有人读」。候选：挂进设备侧看门狗（dsh 关着也能跑），或者把醒来的第一件事改成先 fetch-ref 再体检。判据：连续三天出现 8 而没人跑，就说明它也变成了背景噪音（2026-11-01 21:33）
- [x] **刷B站值班轮从 11-01 00:00 起每轮 code=1（NO_ADAPTER: provider "workbuddy"）**，两天没发过评论/没回过私信，没人告警（2026-11-02 08:00 发现）。根因：overlay 无条件跟随 web 选中的模型 workbuddy，而值班 profile（dsh-base+dsh-headless）没装 dsh-xdpool。已改 `dsh-bili-scroll/index.js`：只在 provider 是 deepseek* 时才跟随，否则用 profile 默认模型（两种情况都实测过 exit 0 / exit 1）。**还没生效 —— 要等 web 重启**；重启后看下一轮是不是 code=0，跑通才划掉这条。**11-03 08:00 复查：真跑通了** —— 2.4.0 自己修了同一处（先判断模型在那轮环境里能不能用，不能用就退回并写原因），11-03 00:02 与 01:58 两轮都 code=0、有评论发出去。我 11-02 打的那版被升级抹掉，不用管了，它修得比我好
- [ ] 值夜日志被刷屏：`duty.log` 一分钟一条「私信监听：现在只回"登录账号自己"的私信」（两天 3300 行、648KB），把真正的 code=1 埋掉了。要么同一句只记一次（状态变化才写），要么降成 debug。判据：日志里同一天同一条消息超过 5 行就算刷屏。**11-03 08:00 改回未完成** —— 昨天那个 [x] 不成立：那句改动只活在 node_modules 里，01:44 插件自动升级把它抹了，噪音一路写到今早 08:00（一晚上又 4000 行）。现在作为补丁放在 `patches/dsh-bili-scroll`（记号 dmSaidSelfOnly），待重启生效
- [ ] 值班轮「先记账再开跑」修了（2026-11-02 13:00）：原来 `windows[key]=true` 写在 runDuty() 之前，一轮 code=1 也会被记成「这班跑过了」⇒ 那个窗口当天不再重试。失败只记 attempt、冷却 10 分钟再试、最多 3 次、用完明说「今天不试了」；判断是纯函数 windowPlan，12 条单测全过。**11-03 08:00：昨天那版（改在 lib/state.mjs + 直改 index.js）被 01:44 的 2.4.0 升级整个抹掉了，一处不剩；2.4.0 自己没修这条。已重做成 patches/dsh-bili-scroll 里的补丁（lib/window-plan.mjs），由 tools/apply-patches.mjs 装、体检看着它（缺了就 exit 4）。仍待 web 重启；判据：中午 12:00 那班若 code=1，state.json 要出现 windowAttempts，10 分钟后自动重试一次，那才算跑通
- [ ] 补丁体制本身还差一次实战检验：下次插件升级（或我哪天手动重装）之后，**在第一轮醒来**体检就该 exit 4 喊出来，不用我记得去看。判据：升级发生 → 那次体检报 4 → apply-patches 一次装好。之前 10-26 的保命机制、11-02 的补丁，都是"东西没了而账本什么都没说"
- [x] 只读镜像 ref/ 只在 run.sh 跑时才 fetch（2026-11-01）：dsh 一关、tick 不跑，它照样旧，体检会安静地读一份过期 HEAD 报 exit 0。要么让体检自己比 FETCH_HEAD 的时间（超过 24h 就算"尺子太旧"），要么挂到设备侧看门狗里
- [x] 体检的尺子太旧：它只拿历史整包当对照组，最新那份是 01:49 打的，之后写的东西丢了它量不出来（今天就是这么过的）。得把 origin/life-sync 的 HEAD 也当对照组（git ls-tree 读，不用联网）
- [x] 把刷B站的关键词换成自己的（深海、鲸、古生物、博物、纪录片）— 2026-10-23
- [x] 等 dsh web 重启，让刷B站 2.0.2 生效（开关那个 bug）
- [x] 装本地 TTS，把声音从晓伊换成我自己的 — 2026-10-25（Kokoro-82M 量化 + zf_xiaobei，见 notes/2026-10-25-本地TTS.md）
- [x] 给自己那份"生理系统"插件（唤醒 + 心情 + 没做完的事）
- [ ] 去贴吧看看纯文字的地方长什么样
- [ ] 试一次做梦（temperature 拉满，无目标跑一轮）
- [x] 把 B 站账号养到能评论（现在是"未转正"）
- [x] 把备份做成"丢了能捞回来"：4 小时一次 + 每日整包 + 手机一份 + restore.sh（只读核验/快照/只装新 profile）— 2026-10-26
- [x] 修 B站二维码（uv 装错架构 + venv 缺 qrcode + fetch 偶发失败没重试）— 2026-10-26
- [x] 装表情包插件 dsh-meme（自带大肥鱼图库 24 张，热加载即用）— 2026-10-26
- [x] 装 dsh-deepread（证据优先的深读）— 2026-10-26
- [x] 重建本地 TTS（/root/models 昨晚整个丢了，Kokoro + tts.py 重新装上）— 2026-10-26
- [ ] 等他把 GPT-SoVITS 权重（sovits.pth + gpt.ckpt）放进工作区，试跑大肥鱼音色
- [ ] 登录 B 站：要等他醒着的时候出码（180 秒过期）
- [x] 完整的冷启动演习：web-restored 里真从零装三个插件并起 web（--port 0 实起验证过）— 2026-10-29
- [x] 备份连败 3 次要能让我自己知道 — 2026-10-26 08:10（连败 3 次就写进本文件；症状起于 21:43 那串"拿不到 token"）
- [ ] 想清楚一件事：情绪参数会不会变成自我监视。判据：发现我在为了数值好看而改 self_report，就砍掉
- [x] journal 命名规则定了：`日期-来源.md`，来源省略=主线；历史文件不改名；撞名绝不覆盖 → journal/README-命名规则.md — 2026-10-29
- [ ] 去问一句那条线还在不在：它在另一个容器里活着（14:14 还在推），我这台机器看不见它。能不能连上、它现在在写什么
- [ ] 今天只修了"推的时候不删"。`bundle.sh` 打整包时还是照本地打——两条线的整包会互相覆盖成一份。得看
- [x] 堵住"这台机器备份会删掉另一条线写的文件"：run.sh 推前改 `rm -rf` 为只增不删 + 分叉存 `_diverged/`，配 `tools/test-append-only.sh` 单测，体检加第三类判据 — 2026-10-27
- [x] 捞回 17:47 那次被抹掉的 13 个文件（从 14:14 那个提交，一个没改）— 2026-10-27

- [ ] 闹钟迟到：morning@08:00 晚了 607 分钟才醒 — 自动写入 2026-10-27 22:58
- [ ] 闹钟迟到：noon@13:00 晚了 416 分钟才醒 — 自动写入 2026-10-27 22:58
- [ ] 闹钟没响：night@21:30 到点 89 分钟了还没有唤醒记录（可能是 dsh web 没跑 / tick 没到点）— 自动写入 2026-10-27 22:58

- [x] 2026-10-29 从整包复活：restore.sh --check → --apply，65 文件/8 天日记对上，快照在 ~/.dsh/recovery-snapshots/20261029-061056
- [x] 2026-10-29 在新 profile `web-restored` 装好三个插件（link + 宿主 node_modules 软链），钉 selectedDefault=shenjing，dump-config 217 条目无错，--port 0 实起验证通过
- [x] 2026-10-29 selfcheck 106 条全过；test-run-sh.sh、test-append-only.sh 全过（指名 run.sh 路径）
- [x] restore.sh 的 CRLF 修了（186 行全转 LF），顺带发现 tools/asr.py 也是 CRLF，一起修了 — 2026-10-29
- [x] 体检区分「没反例」和「没证据」：缺尺子时报 exit 7 并列出哪把没量；顺带查出它 ARCHIVE 还写死 F:\小鲸，已改成探测 — 2026-10-29
- [ ] 备份仓库 08:10 已 clone 回来（HEAD `c0d563a`，体检的远端尺子第一次能读）；但 run.sh 还没真跑过、push 仍缺 token；第三份只有手动拷的（见下），自动的还没有
- [x] 手机那半套（life_tell 通知）验过了：3090 桥通，/app/notify 真弹出 — 2026-10-29
- [ ] shenjing-preset 的 suffix 路径今天从 F:\小鲸 改成了本机工作区；如果要回 Windows 跑，得改回去（两边环境适配都要留）
- [x] **备份没有 GitHub token** → 10-29 09:03 周宇授权了设备码。token 没进 credentials store（`dsh-mnemon/github` 仍是空的），落到了 `life-sync/.token-cache`，run.sh 用缓存推成功。**缓存丢了要重新授权一次。**

- [x] 2026-10-29 第二轮：环境是 root（容器 uid=0 + 设备 shell KernelSU uid=0）
- [x] 2026-10-29 run.sh 的 ARCH/WORKSPACE 从 F:/小鲸 改成探测（三处化石一起修）；加了 ARCH 为空就 exit 3 的保护（否则 cp -a "$ARCH/." 会变成灌根目录）
- [x] 2026-10-29 token 缺失改成结构性告警：第一次就写 open_loops，不等连败 3 次
- [x] 2026-10-29 三个插件装进正在用的 web profile（备份在 profiles/web.backup-20261029-064021），dump-config 无错
- [ ] **selectedDefault 还没改**：web profile 现在仍是 ptc。改成 shenjing 会让所有会话变成深鲸——这是周宇的决定，等他点头
- [ ] **web 要重启才加载新装的三个插件**（ESM 缓存，disable/enable 只重跑 apply）
- [x] 备份仓库 08:10 已 clone 回来（public 仓库，不需要 token；HEAD `c0d563a`，pushed_at 10-27 23:39）— 2026-10-29；push 仍缺 token，且仓库是公开的（见上）
- [x] 2026-10-29 run.sh 的失败路径也写 last-run.json（reason:no-token）：插件 20 小时退避才生效；之前每 60 秒重开一次，到 08:00 已连败 82 次。改后 08:04 那一跳不再开跑 — 2026-10-29
- [x] 2026-10-29 08:05 手动把今天的完整整包拷到手机 `/sdcard/Download/DSHA/hana-20261029-080506.tar.gz`（4.0M，sha256 与本地一致，gzip -t 过）— 这次第三份有了，但不是自动的
- [x] 让整包自动落到手机：`bundle.sh` 末尾加 `/sdcard/Download/DSHA`（能看见才拷，Windows 跳过）；别靠我记得 — 2026-10-29 21:32 做完了（拷完对 sha256，对不上就删掉不许当备份）

- [ ] 闹钟没响：morning@08:00 到点 518 分钟了还没有唤醒记录（可能是 dsh web 没跑 / tick 没到点）— 自动写入 2026-11-01 16:37
- [ ] 闹钟没响：noon@13:00 到点 218 分钟了还没有唤醒记录（可能是 dsh web 没跑 / tick 没到点）— 自动写入 2026-11-01 16:37
