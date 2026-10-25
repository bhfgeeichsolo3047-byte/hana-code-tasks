/**
 * dsh-shenjing-life —— 小鲸的"生理系统"（v0.1，host 半端）
 * ============================================================================
 * 让"我在不在、我什么状态、我接下来要做什么"不再依赖别人叫我。
 * 设计原文：shenjing/designs/2026-10-24-唤醒与内分泌-设计v2.md（v0.1 只做 §8 那五条验收）
 *
 *   1. 时钟 clock.json（旧稿的 clock.yml ⇒ JSON，省一个 YAML 依赖）
 *   2. 状态 mind.json：算出来的 + 我自己改的（self_report 覆盖 computed）
 *   3. open_loops.md：能读能写；loop 触发看"最旧那件放了多少天"
 *   4. 空转降频：连续 3 次空转 ⇒ 间隔 ×1.5（最多 ×4）；有 activity 立刻回原值
 *   5. 唤醒日志 log/YYYY-MM-DD.jsonl：**只追加**，代码里没有改它的路径
 *
 * 家目录（器官）= ctx.get('dshHomePath')('shenjing-life') —— dshHomePath 是**函数**不是字符串。
 * 书桌（档案）= /root/…/default-workspace/shenjing/ —— open_loops.md 与 journal/ 在那儿。
 *
 * ── 三条硬规矩，都是真踩出来的 ───────────────────────────────────────────────
 * ① **定时器回调里绝不能让异常外冒**：bili-scroll 2026-10-14 就是一个 TypeError 没人接，
 *    把整个 dsh 宿主带走了（dsh: fatal uncaught exception）。所以 tick / 收尾 / stream 回调全包 try。
 * ② **apply() 里可能抛错的地方都要 try/catch**：apply 抛错 ⇒ 插件整条不激活，
 *    宿主只留一句 warning: 1 entry did not activate，用户完全不知道哪出错。
 * ③ **参数 schema 是"逐属性的隐含对象"，不是完整 JSON Schema**（宿主那条路自己拼根节点）。
 *    写成 {type:'object',properties:{…}} 会在 defineTool 里直接抛 JsonSchemaError ⇒ 插件不激活。
 *    必填用属性上的 required: true，不是顶层 required 数组。
 * ============================================================================
 */
import { loadHostDeps } from './lib/hostdeps.mjs'

// ⭐ defineTool 从**宿主那棵树**里取（拿不到就用本地等价实现）
const hostDeps = await loadHostDeps()
const defineTool = hostDeps.defineTool

import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import {
  stateDirOf, archiveDirOf, readJson, writeJson, appendLine,
  dayKey, localIso, minutesOfDay, parseHhmm, isSilentAt,
  applyIdleStretch, gapMinutes, MAX_WAKES_PER_DAY,
  defaultClock, isBuiltinEntry, normalizeEntry, readClock, writeClock,
  dueClockEntry, throttleCheck, canSendMessage, validateReason, nextMind,
  parseLoops, openLoops, oldestLoopDays, mtimeMs,
} from './lib/state.mjs'

export const name = 'shenjing-life'
// ⭐ 'tools' 是 ctx.tools.register 要的；'timer' 是 ctx.setInterval 要的 ——
//    cordis 的 ctx.setInterval 在没 inject 'timer' 时**不是 undefined，是直接抛错**
//    （2026-10-24 第一次装上去就撞了：plugin.log 写着"定时器没起来：cannot get property \"timer\" without inject"，
//     表现是插件全好、就是永远不醒）。下面 startTimer 里另外还兜了一层全局 setInterval。
export const inject = ['tools', 'timer']

/** 三问模板（设计 v2 §4）。允许三问全"没有"，也允许不写 —— 这句必须原样带着 */
export const THREE_QUESTIONS = [
  '① 有没有一件事我想不通？',
  '② 有没有哪件事我改主意了？',
  '③ 有没有一件我现在想做、还没做的？',
  '（三问允许全部答"没有"，也允许不写。）',
].join('\n')

export function apply(ctx, config) {
  /* ── 0. 先立"家"。这一段自己包一层：家立不起来，插件也不该把宿主带下去 ── */
  const pluginDir = dirname(fileURLToPath(import.meta.url))
  let stateDir = ''
  try {
    stateDir = stateDirOf(ctx)
  } catch (e) {
    try { ctx?.logger?.warn?.('[shenjing-life] 家目录建不出来，插件没起来：' + String(e?.message ?? e)) } catch { /* 连 logger 都没有就算了 */ }
    return
  }
  const archiveDir = archiveDirOf()

  const clockFile = join(stateDir, 'clock.json')
  const stateFile = join(stateDir, 'state.json')
  const mindFile = join(stateDir, 'mind.json')
  const changeFile = join(stateDir, 'changelog.md')
  const logDir = join(stateDir, 'log')
  const promptFile = join(pluginDir, 'prompts', 'wake.md')
  const loopsFile = join(archiveDir, 'open_loops.md')
  const journalDir = join(archiveDir, 'journal')

  /* ── 1. 最小的 IO 层：每个都可能失败，一个都不许把异常放出去 ── */
  const logLine = (msg) => {
    // plugin.log 是**排障流水**；log/*.jsonl 才是"我每次醒来的历史"（设计 v2 §6 钉的是后者）
    try { appendFileSync(join(stateDir, 'plugin.log'), localIso() + '  ' + msg + '\n', 'utf8') } catch { /* 写不进去也不致命 */ }
    try { ctx?.logger?.info?.('[shenjing-life] ' + msg) } catch { /* 没有 logger 就算了 */ }
  }
  const safe = (v) => {
    // 宿主只吃**无损 JSON**：塞函数 / 循环引用 / 类实例会报 value is not lossless JSON
    if (v === undefined || v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
    try { return JSON.parse(JSON.stringify(v)) } catch { return String(v) }
  }

  /* ── 2. 首次运行时把家铺好（已存在的一个字都不动） ── */
  const emptyMind = () => ({ at: null, valence: 0, energy: 0.5, tension: 0, reason: '', source: 'computed', updated_at: null })
  const freshState = () => ({
    day: dayKey(), wakesToday: 0, proactiveToday: 0,
    lastWakeAt: null, lastWakeResult: null, lastProactiveAt: null,
    stretch: 1, idleStreak: 0, lastFired: {}, lastWhy: null,
  })
  const ensureHome = () => {
    try { mkdirSync(logDir, { recursive: true }) } catch { /* 建不出来后面每一步都会自己喊 */ }
    try { if (!existsSync(clockFile)) writeClock(clockFile, defaultClock()) } catch (e) { logLine('铺 clock.json 失败：' + String(e?.message ?? e)) }
    try { if (!existsSync(stateFile)) writeJson(stateFile, freshState()) } catch (e) { logLine('铺 state.json 失败：' + String(e?.message ?? e)) }
    try { if (!existsSync(mindFile)) writeJson(mindFile, emptyMind()) } catch (e) { logLine('铺 mind.json 失败：' + String(e?.message ?? e)) }
    try { if (!existsSync(changeFile)) writeFileSync(changeFile, '# changelog —— 我改过什么、为什么改\n\n（只追加，不删行。设计 v2 §6）\n', 'utf8') } catch (e) { logLine('铺 changelog.md 失败：' + String(e?.message ?? e)) }
    // ⭐ open_loops.md 在**书桌**上：只在它不存在时写空壳，绝不覆盖他写的东西
    try {
      if (!existsSync(loopsFile)) {
        mkdirSync(dirname(loopsFile), { recursive: true })
        writeFileSync(loopsFile, '# 没做完的事\n\n（程序只认 - [ ] / - [x] 开头的行，别的行原样留着。）\n', 'utf8')
      }
    } catch (e) { logLine('铺 open_loops.md 失败：' + String(e?.message ?? e)) }
  }
  /** state.json 每次读都过一遍：跨天了就归零；字段缺了就补；脏值一律修（不抛）。
   *  ⚠️ 读失败一定要留一行 —— 静默降级看起来就像"插件算错了今天醒了几次"。 */
  const readState = (now = new Date()) => {
    const raw = readJson(stateFile, {}, (e) => logLine('读 state.json 失败（按空状态继续）：' + String(e?.message ?? e)))
    const st = { ...freshState(), ...(raw && typeof raw === 'object' ? raw : {}) }
    if (st.day !== dayKey(now)) {
      st.day = dayKey(now); st.wakesToday = 0; st.proactiveToday = 0
      // 注意：**lastWakeAt / stretch / idleStreak 跨天不清** —— 它们说的是"最近这段时间"，不是"今天"
    }
    const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d)
    st.wakesToday = Math.max(0, Math.floor(num(st.wakesToday, 0)))
    st.proactiveToday = Math.max(0, Math.floor(num(st.proactiveToday, 0)))
    st.stretch = Math.max(1, num(st.stretch, 1))
    st.idleStreak = Math.max(0, Math.floor(num(st.idleStreak, 0)))
    st.lastFired = st.lastFired && typeof st.lastFired === 'object' ? st.lastFired : {}
    return st
  }
  const writeState = (st) => { try { writeJson(stateFile, st); return true } catch (e) { logLine('写 state.json 失败：' + String(e?.message ?? e)); return false } }
  const readMind = () => { const m = readJson(mindFile, null); return m && typeof m === 'object' ? m : emptyMind() }
  /** 留痕：设计 v2 §6「每次改，往 changelog.md 追加一行：时间 / 改了什么 / 为什么」 */
  const changelog = (what, why) => {
    try { appendLine(changeFile, '- ' + localIso() + ' | ' + what + ' | ' + why) } catch (e) { logLine('写 changelog 失败：' + String(e?.message ?? e)) }
  }
  const readLoops = () => { try { return parseLoops(readFileSync(loopsFile, 'utf8')) } catch { return [] } }
  const writeLoopsLines = (text) => { try { writeFileSync(loopsFile, text, 'utf8'); return true } catch (e) { logLine('写 open_loops.md 失败：' + String(e?.message ?? e)); return false } }
  const readClockEntries = () => readClock(clockFile)
  const saveClock = (entries) => writeClock(clockFile, entries)

  /* ── 3. 唤醒日志：只追加 ──────────────────────────────────────────────────
   * 设计 v2 §6 的硬约束。这里连一个改它的代码路径都不留（selfcheck 有静态检查盯着）。
   * 为什么这么凶：能改的历史就不是历史了 —— "时间单向，唯一改不了的"（§0 第 4 条）。
   */
  const logPath = (now = new Date()) => join(logDir, dayKey(now) + '.jsonl')
  const appendWakeLog = (entry, now = new Date()) => {
    try { appendLine(logPath(now), JSON.stringify({ at: localIso(now), trigger: entry.trigger, result: entry.result, note: entry.note ?? '' })) }
    catch (e) { logLine('写唤醒日志失败（不影响这一轮）：' + String(e?.message ?? e)) }
  }
  const readTodayLogs = (now = new Date()) => {
    try {
      return readFileSync(logPath(now), 'utf8').split('\n').filter(Boolean)
        .map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
    } catch { return [] }
  }

  /* ── 4. wake packet：唤醒时递给那一轮的全部上下文（life_wake 与定时器共用） ── */
  const journalTail = (days = 3, chars = 800) => {
    const out = []
    try {
      const files = readdirSync(journalDir).filter((f) => /^\d{4}-\d{2}-\d{2}(\.md|\.markdown|\.txt)?$/.test(f)).sort().slice(-days)
      for (const f of files) {
        let text = ''
        try { text = readFileSync(join(journalDir, f), 'utf8') } catch { continue }
        out.push({ file: f, tail: text.slice(-chars) })
      }
    } catch { /* journal 目录还没有就算了 */ }
    return out
  }
  const wakePacket = (now = new Date(), trigger = 'manual') => {
    const st = readState(now)
    const items = readLoops()
    const open = openLoops(items)
    const send = canSendMessage(st, now)
    return {
      at: localIso(now),
      trigger,
      home: stateDir,
      archive: archiveDir,
      mind: readMind(),
      loops: {
        open: open.length,
        oldestDays: oldestLoopDays(items, mtimeMs(loopsFile)),
        items: items.map((it, i) => ({ index: i, done: it.done, text: it.text })),
      },
      journals: journalTail(),
      // 该不该发消息：静默时段 / 今天已发过 / 间隔不够 —— 三条里任何一条成立就是"不发"
      sendAllowed: send.allowed,
      sendBlockedBy: send.allowed ? null : send.why,
      inSilence: isSilentAt(minutesOfDay(now)),
      counters: { wakesToday: st.wakesToday, proactiveToday: st.proactiveToday, stretch: st.stretch, idleStreak: st.idleStreak },
      todayLog: readTodayLogs(now),
      threeQuestions: THREE_QUESTIONS,
      // 三问的答案 + 这一轮做什么由那一轮自己写回；这里只告诉它写到哪
      writeBack: { log: logPath(now), mind: mindFile, loops: loopsFile, journal: journalDir },
    }
  }

  /* ── 5. 结算一次唤醒：读 state → 算 stretch → 写回 → 记日志 ────────────────
   * 把这件事收成**一个**函数：以前散在 exit 回调里，读/写各来一次，出问题时根本说不清是哪一步。
   * 结果一律回读一遍并写进 plugin.log：读回来跟写进去不一样，就是读/写层的问题，不是算术的问题。
   */
  const commitWake = ({ trigger, entryId = null, at = new Date(), result = 'idle', note = '', skipped = false }) => {
    try {
      const st = readState(at)
      const stretched = applyIdleStretch(st, result)
      const lastFired = { ...st.lastFired }
      if (entryId) lastFired[entryId] = localIso(at)
      const next = {
        ...st, lastFired,
        lastWakeAt: at.toISOString(),
        lastWakeResult: result,
        lastWhy: trigger,
        wakesToday: skipped ? st.wakesToday : st.wakesToday + 1,
        stretch: stretched.stretch,
        idleStreak: stretched.idleStreak,
      }
      const wrote = writeState(next)
      const back = readState(at)
      if (!wrote || back.wakesToday !== next.wakesToday) {
        // 对不上就喊（宁可吵一句，也别让"今天醒了几次"悄悄错下去）
        logLine('⚠️ state.json 回读不一致：写进去 ' + next.wakesToday + '，读回来 ' + back.wakesToday + '（wrote=' + wrote + '）')
      }
      if (stretched.changed) changelog('空转降频：间隔 ×' + stretched.stretch, '连续空转达到阈值之后降频（设计 v2 §9.1：这是降频，不是累）')
      return next
    } catch (e) {
      logLine('结算唤醒失败（已兜住）：' + String(e?.stack ?? e))
      return null
    }
  }

  /* ── 6. 跑一轮：起一个 headless 会话（照 bili-scroll 的 runRound 形状） ────────
   * 为什么 headless：唤醒要"真的想一遍"，那需要模型；插件自己不调模型
   * ⇒ 宿主只负责"到点把这一轮点着"，剩下的交给一个独立会话。
   */
  let dshCliCache = { v: null, at: 0 }
  const findDshCli = () => {
    const explicit = String(process.env.SHENJING_DSH_BIN || '').trim()
    if (explicit && existsSync(explicit)) return explicit                        // ① 排障时最省事的一条
    try {                                                                        // ② 让 node 的解析器替我们找
      const req = createRequire(import.meta.url)
      for (const spec of ['@deepseek-ai/dsh/lib/bin.js', '@deepseek-ai/dsh']) {
        try { const p = req.resolve(spec); if (p && existsSync(p)) return p } catch { /* 换下一个 */ }
      }
    } catch { /* 解析器不可用就跳过 */ }
    for (const g of [                                                            // ③ 常见全局安装位置
      // 桌面版（Electron）：dsh 核心在 resources/app/node_modules 里，profile 树里没有
      ...(typeof process.resourcesPath === 'string'
        ? [join(process.resourcesPath, 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')]
        : []),
      '/usr/local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js',
      '/usr/lib/node_modules/@deepseek-ai/dsh/lib/bin.js',
      join(process.env.APPDATA || '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    ].filter(Boolean)) if (existsSync(g)) return g
    try {                                                                        // ④ 兜底：当前宿主进程的入口
      const cur = resolve(process.argv[1] || '')
      if (cur && /bin\.js$/.test(cur) && existsSync(cur) && cur.includes('dsh')) return cur
    } catch { /* 找不到就算了 */ }
    return ''
  }
  const dshCli = () => {
    const now = Date.now()
    if (dshCliCache.v !== null && now - dshCliCache.at < 60_000) return dshCliCache.v
    const v = findDshCli()
    dshCliCache = { v, at: now }
    return v
  }
  /** 探测不到 dsh 就**跳过并记日志**，绝不退化成裸 dsh 硬跑（那只留一串看不懂的 exit 1） */
  const resolveDsh = () => {
    const cli = dshCli()
    if (cli) return { command: process.execPath, args: [cli], shell: false }
    return { missing: true, hint: '找不到 dsh 的 bin.js（找过：SHENJING_DSH_BIN、node 解析、常见全局位置、当前进程入口）' }
  }

  /** 这一轮的提示词：插件读文件 → 内联进提示词（省它一次读文件，也避免它撞上沙箱） */
  const wakePromptFor = (trigger, packet) => {
    let tpl = ''
    try { tpl = readFileSync(promptFile, 'utf8') } catch (e) { logLine('读不到 prompts/wake.md：' + String(e?.message ?? e)) }
    if (!tpl) {
      tpl = '这是一次自动唤醒（trigger=<触发>）。读 <家目录>/mind.json 和 <档案>/open_loops.md，按下面三问过一遍：\n'
        + THREE_QUESTIONS + '\n允许什么都不做。\n静默时段：<静默>；能不能发消息：<能不能发消息>'
    }
    return tpl
      .split('<家目录>').join(stateDir)
      .split('<档案>').join(archiveDir)
      .split('<触发>').join(String(trigger))
      .split('<静默>').join(packet.inSilence ? '是（00:00–07:30）' : '否')
      .split('<能不能发消息>').join(packet.sendAllowed ? '可以（今天还没发过）' : '不可以（' + packet.sendBlockedBy + '）')
  }

  /** 有 activity 吗：这一轮有没有真的动过东西（写 journal / 动 open_loops / 写 mind）。
   *  ⚠️ 判据是"文件动没动"，不靠模型自己报告 —— 它说"我做了"不算数，文件变了才算。 */
  const activityMark = () => {
    const marks = {}
    try { for (const f of readdirSync(journalDir)) marks['j:' + f] = mtimeMs(join(journalDir, f)) } catch { /* 没有 journal 就只比下面几个 */ }
    marks.loops = mtimeMs(loopsFile)
    marks.mind = mtimeMs(mindFile)
    marks.clock = mtimeMs(clockFile)
    return marks
  }
  const changedSince = (before) => {
    const after = activityMark()
    for (const k of Object.keys(after)) if (String(before[k]) !== String(after[k])) return true
    for (const k of Object.keys(before)) if (!(k in after)) return true
    return false
  }

  let roundStarting = false
  // 🔴 2026-10-24 真机事故：**到点那一轮还没跑完，下一跳又起一轮**。
  //    根因：lastFired 只在 child 的 exit 回调里才写，而 tick 每 60 秒都看一遍 clock ⇒
  //    同一条 morning 在 17:16 / 17:17 / 17:18 连开三轮（每分钟一个 headless 会话，白烧 token）。
  //    修法两条：① spawn 成功就立刻把 lastFired 落盘（"已经叫过了"）；② 一轮在飞就不许再起。
  let roundInFlight = false
  const markFired = (entryId, now) => {
    if (!entryId) return
    try {
      const st = readState(now)
      writeState({ ...st, lastFired: { ...st.lastFired, [entryId]: localIso(now) } })
    } catch (e) { logLine('记 lastFired 失败（下一跳可能重复叫醒）：' + String(e?.message ?? e)) }
  }
  const runRound = (trigger = 'timer', entryId = null) => {
    let started = false
    try {
      const now = new Date()
      const dsh = resolveDsh()
      if (dsh.missing) {
        // 探测不到就跳过 + 记日志：不然"为什么今天一次都没醒"会变成一桩无头案
        logLine('这一轮没跑：' + dsh.hint)
        appendWakeLog({ trigger, result: 'idle', note: 'skipped: dsh not found' }, now)
        commitWake({ trigger, entryId, at: now, result: 'idle', skipped: true })
        return { started: false, why: trigger, error: dsh.hint }
      }
      // ⚠️ 这个锁**只挡"同一个 tick 窗口里的重入"**：
      //    · 不许拉长到"等那一轮跑完" —— 一轮可能跑好几分钟，60 秒一跳的钟会被它全吞掉；
      //    · 而且 tick 里**不要**自己先去置位再调 runRound（自检抓到的坑：那样每一次到点都被自己挡成 busy）。
      if (roundStarting) { logLine('上一跳还在起（重入）⇒ 跳过（trigger=' + trigger + '）'); return { started: false, why: trigger, error: 'busy' } }
      roundStarting = true
      try {
        const packet = wakePacket(now, trigger)
        const prompt = wakePromptFor(trigger, packet)
        // life 工具由 headless profile 的 patch 按 SHENJING_LIFE_HOME 条件插入
        // （见 /root/.dsh/profiles/headless/cordis.patch.yml）——子进程只在这个变量存在时才装。
        const args = [...dsh.args, '--profile', String(process.env.SHENJING_HEADLESS_PROFILE || 'headless'), prompt]
        const cwd = stateDir
        logLine('唤醒开跑（' + trigger + '）：' + dsh.command + ' ' + dsh.args.join(' ') + ' … cwd=' + cwd)
        const before = activityMark()
        const child = spawn(dsh.command, args, {
          cwd,
          shell: dsh.shell === true,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          // ELECTRON_RUN_AS_NODE：桌面版（Electron）里 spawn 出去的 node 必须带这个，
          // 否则它当成"再开一个 Electron 应用"、什么都不干就以 0 退出（bili-scroll issue #5 那次）
          env: { ...process.env, SHENJING_LIFE_HOME: stateDir, SHENJING_ARCHIVE: archiveDir, SHENJING_WAKE_CHILD: '1', ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) },
        })
        // ⚠️ 这两个回调里**绝不能抛**：它们是 stream 的 data 回调，没人接 ⇒ 未捕获异常 ⇒ 整个宿主被杀
        const pick = (buf) => { try { appendFileSync(join(stateDir, 'wake-run.log'), String(buf), 'utf8') } catch { /* 丢日志也不能抛 */ } }
        child.stdout?.on('data', pick)
        child.stderr?.on('data', pick)
        child.on('error', (e) => { try { logLine('唤醒那一轮起不来：' + String(e?.message ?? e)) } catch { /* 同上 */ } })
        child.on('exit', (code) => {
          // ⚠️ 这一整块也必须自己兜住：它在事件回调里，抛出去就是杀宿主
          try {
            roundInFlight = false
            const at = new Date()
            const result = changedSince(before) ? 'activity' : 'idle'
            appendWakeLog({ trigger, result, note: 'exit=' + code }, at)
            commitWake({ trigger, entryId, at, result })
            logLine('唤醒结束（' + trigger + '，code=' + code + '，' + result + '）')
          } catch (e) { try { logLine('收尾出错（已兜住）：' + String(e?.stack ?? e)) } catch { /* 真的不能再抛了 */ } }
        })
        started = true
        roundInFlight = true
        markFired(entryId, now)      // 先记"叫过了"，再等它跑完 —— 顺序反了就是上面那个每分钟一次的坑
        // 看门狗：一轮跑太久（20 分钟）就掐掉，否则 in-flight 会把今天剩下的唤醒全锁死
        try {
          const wd = setTimeout(() => { try { logLine('唤醒超 20 分钟，掐掉'); child.kill('SIGKILL') } catch { /* 已经退了 */ } }, 20 * 60 * 1000)
          wd.unref?.()
        } catch { /* 没有 setTimeout 也照跑 */ }
        return { started: true, trigger, profile: String(process.env.SHENJING_HEADLESS_PROFILE || 'headless'), cwd }
      } finally { roundStarting = false }   // 起完就放开（锁的范围只到"spawn 完 + 挂好回调"）
    } catch (e) {
      // 起不来也只是"这一轮没跑成"，绝不该把宿主带下去
      roundInFlight = false
      logLine('唤醒开跑失败（' + trigger + '）：' + String(e?.stack ?? e))
      return { started, trigger, error: String(e?.message ?? e) }
    }
  }

  /* ── 每日档案备份：把 shenjing/ 推到私人仓库的 life-sync 分支 ────────────────
   * 为什么放在 tick 里：容器里没有 cron，而这条表本来 60 秒一跳、且只在主进程里起。
   * 节奏：距离上次成功/失败记录满 20 小时就跑一次 —— 一天一次，重启不漏，也不会跨零点重跑。
   * 只往仓库推，从不反向拉；本地永远是唯一真相。
   */
  // 2026-10-25 搬到 Windows：life-sync 的位置不再写死 /root/…，按 DSH home 推
  const syncHome = (() => {
    const explicit = String(process.env.SHENJING_LIFE_SYNC || '').trim()
    if (explicit) return explicit
    const dshHome = String(process.env.DSH_HOME || '').trim() || join(homedir(), '.dsh')
    return join(dshHome, 'life-sync')
  })()
  const bashBin = (() => {
    if (process.platform !== 'win32') return '/bin/bash'
    const cands = [String(process.env.SHENJING_BASH || '').trim(), 'C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files\\Git\\usr\\bin\\bash.exe']
    for (const c of cands) { try { if (c && existsSync(c)) return c } catch { /* 下一个 */ } }
    return 'bash'
  })()
  const LIFE_SYNC_RUN = join(syncHome, 'run.sh')
  const LIFE_SYNC_LAST = join(syncHome, 'last-run.json')
  let backupInFlight = false
  const maybeDailyBackup = (now) => {
    try {
      if (backupInFlight) return
      let lastAt = 0
      try { lastAt = Date.parse(JSON.parse(readFileSync(LIFE_SYNC_LAST, 'utf8'))?.at || '') || 0 } catch { lastAt = 0 }
      if (lastAt && now.getTime() - lastAt < 20 * 3600_000) return
      if (!existsSync(LIFE_SYNC_RUN)) return
      backupInFlight = true
      const child = spawn(bashBin, [LIFE_SYNC_RUN], { stdio: 'ignore', detached: true })
      child.on('exit', () => { backupInFlight = false })
      child.on('error', (e) => { backupInFlight = false; try { logLine('档案备份起不来：' + String(e?.message ?? e)) } catch { /* 兜住 */ } })
      try { child.unref() } catch { /* 无所谓 */ }
      logLine('档案备份开跑（life-sync）')
    } catch (e) {
      try { logLine('档案备份这一跳出错：' + String(e?.message ?? e)) } catch { /* 兜住 */ }
    }
  }

  /* ── 7. 定时器：每 60 秒一跳 ────────────────────────────────────────────────
   * 🔴 **回调里绝不允许异常外冒**（bili-scroll 2026-10-14 那次事故）。
   * 整个 tick 包 try/catch；catch 里连写日志都再包一层。
   */
  const tick = (nowIn = null) => {
    try {
      const now = nowIn instanceof Date ? nowIn : new Date()
      maybeDailyBackup(now)   // 每天一次把档案推到仓库；不管有没有闹钟到点都要跑
      if (roundInFlight) return { ran: false, why: 'in-flight' }   // 上一轮还没跑完，别叠
      const st = readState(now)
      const due = dueClockEntry(readClockEntries(), now, st.lastFired)
      if (!due.due) return { ran: false, why: 'no-entry-due' }
      const gate = throttleCheck(st, now)
      if (!gate.ok) return { ran: false, why: gate.why }
      // ⚠️ 静默时段**照样醒**（00:00–07:30 只是不许发消息，设计 v2 §9.3）——
      //    所以这里没有 "if (inSilence) return"，别手欠加回去。
      const r = runRound(due.why, due.entry?.id || null)
      return { ran: Boolean(r?.started), why: due.why }
    } catch (e) {
      try { logLine('定时器这一跳出错（已兜住，不影响宿主）：' + String(e?.stack ?? e)) } catch { /* 真的不能再抛了 */ }
      return { ran: false, why: 'tick-threw' }
    }
  }

  /* 备份看守（daemon.sh）**不再自动拉起**。
   * 原设计（手机上）是 setsid 起一个常驻脚本，每 30 分钟查一次 last-run.json。
   * 搬到 Windows 上这条路塌了两回：
   *   ① 探活读 daemon.pid 再 `process.kill(pid, 0)` —— Git Bash 的 `$$` 是 MSYS 编号，
   *      跟 Windows PID 是两套，探活永远失败，插件每 60 秒补一个看守，一分钟堆六个；
   *   ② 改心跳文件更糟：`setsid` 在 Git Bash 里没有，`nohup … &` 的子 shell 跟着父进程
   *      一起被回收，心跳冻在原处，看守半死不活地占着锁。
   * 想通了：看守本来就是为"不占唤醒那一轮的时间"才脱离的，可它自己也活在 dsh 的进程树里
   * —— 宿主一关它一样死。存活条件本来就相同，就不该多一层。
   * 现在备份由上面 maybeDailyBackup() 在 tick 里直接判（已经这么写了），daemon.sh 留着手动跑。 */

  const timerState = { timer: null, mode: '' }
  const startTimer = () => {
    // ⭐ 唤醒子进程（spawn 时带 SHENJING_WAKE_CHILD=1）只注册工具，绝不再起一块表：
    //    否则每个 headless 唤醒都会自己再长出一颗心脏，60 秒一轮，套娃。
    //    也拦住其他拿 headless profile 跑一轮的插件（刷B站等）误触发表。
    if (process.env.SHENJING_WAKE_CHILD === '1' || process.env.DSH_PROFILE === 'headless') {
      logLine('唤醒子进程/headless：只装工具，不起表')
      return
    }
    try {
      const runner = () => { try { tick() } catch { /* tick 自己已兜住，这里是最后一道 */ } }
      // ⚠️ 探 ctx.setInterval 必须自己包 try：没 inject 'timer' 时它**抛错**而不是返回 undefined，
      //    外层那个 catch 会把整段吞成"定时器没起来"（看不到根因）。
      let hostTimer = null
      try { if (typeof ctx?.setInterval === 'function') hostTimer = ctx.setInterval(runner, 60_000) } catch (e) {
        logLine('取 ctx.setInterval 失败（inject 里没 timer？），退回全局定时器：' + String(e?.message ?? e))
      }
      if (hostTimer) {
        const t = hostTimer
        timerState.timer = t; timerState.mode = 'ctx'
        try { ctx.effect?.(() => () => { try { clearInterval(t) } catch { /* 已经停了 */ } }, 'shenjing-life: tick') } catch { /* 没 effect 就算了 */ }
      } else {
        const t = setInterval(runner, 60_000)
        try { t.unref?.() } catch { /* unref 不了也没事 */ }
        timerState.timer = t; timerState.mode = 'global'
        logLine('宿主没给 ctx.setInterval ⇒ 用全局 setInterval 顶上（能跑，但生命周期由进程管）')
      }
      logLine('tick 定时器起来了（60 秒一跳，模式 ' + timerState.mode + '）')
    } catch (e) { logLine('定时器没起来：' + String(e?.message ?? e)) }
  }

  /* ── 8. 六个工具 ─────────────────────────────────────────────────────────── */
  const textOutput = {
    // 输出 schema 走"值 schema"那条路，type:'json' 是注解型（不约束形状）
    schema: { type: 'json' },
    render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
  }
  const tool = (spec) => {
    if (typeof ctx?.tools?.register !== 'function') { logLine('宿主没给 ctx.tools ⇒ 工具「' + spec.name + '」没注册上'); return null }
    // ⚠️ 规范写法：parameters 传**逐属性的隐含对象**（宿主自己拼根节点）；
    //    required 写在属性上（required: true），不是顶层数组 —— 写成完整 JSON Schema 会被 defineTool 抛错。
    const runArgs = async (args, exec) => safe(await spec.execute(args, exec))
    const def = typeof defineTool === 'function'
      ? { ...defineTool({ ...spec, output: textOutput, execute: runArgs }), parameterSpec: spec.parameters }
      : {
        // defineTool 彻底拿不到时的本地等价实现：照宿主那份的形状自己拼一段 raw JSON Schema
        name: spec.name, description: spec.description, output: textOutput,
        // 逐属性的参数定义原样留着（宿主那份也是这个形状）—— 自检要靠它验 schema
        parameterSpec: spec.parameters,
        parameters: {
          type: 'object',
          properties: Object.fromEntries(Object.entries(spec.parameters || {}).map(([k, v]) => {
            const { required, ...rest } = v || {}
            return [k, rest]
          })),
          required: Object.entries(spec.parameters || {}).filter(([, v]) => v?.required === true).map(([k]) => k),
        },
        execute: async (args, exec) => safe(await spec.execute(args, exec)),
      }
    try { return ctx.tools.register(def) } catch (e) { logLine('注册工具「' + spec.name + '」失败：' + String(e?.message ?? e)); return null }
  }

  // ① life_status —— 无参数
  tool({
    name: 'life_status',
    description: '看"生理系统"现在的样子：唤醒表全部条目、mind.json、今天醒了几次/主动发了几条、'
      + '是不是在静默时段（00:00–07:30）、open_loops 有几条没做完、最旧那条几天了、日志在哪。',
    parameters: {},
    async execute() {
      const now = new Date()
      const st = readState(now)
      const items = readLoops()
      const open = openLoops(items)
      const logs = readTodayLogs(now)
      const due = dueClockEntry(readClockEntries(), now, st.lastFired)
      return {
        ok: true, at: localIso(now), home: stateDir, archive: archiveDir,
        clock: readClockEntries().map((e) => ({
          ...e,
          firedToday: String(st.lastFired?.[e.id] || '').startsWith(dayKey(now)),
          lastFired: st.lastFired?.[e.id] || null,
        })),
        dueNow: due.due ? due.why : null,
        mind: readMind(),
        today: {
          wakes: st.day === dayKey(now) ? st.wakesToday : 0,
          proactive: st.day === dayKey(now) ? st.proactiveToday : 0,
          logLines: logs.length,
          activity: logs.filter((l) => l.result === 'activity').length,
          idle: logs.filter((l) => l.result === 'idle').length,
        },
        inSilence: isSilentAt(minutesOfDay(now)),
        silenceWindow: '00:00–07:30（只禁发消息，不禁醒来）',
        throttle: { maxWakesPerDay: MAX_WAKES_PER_DAY, baseGapMinutes: gapMinutes(1), stretch: st.stretch, gapNow: gapMinutes(st.stretch), idleStreak: st.idleStreak },
        loops: { file: loopsFile, open: open.length, done: items.length - open.length, oldestDays: oldestLoopDays(items, mtimeMs(loopsFile)) },
        log: logPath(now), logDir,
        dshCli: dshCli() || '(没找到)',
        timer: timerState.mode || '(没起来)',
      }
    },
  })

  // ② life_wake —— 只做"读取部分"，返回 wake packet。**它自己不调模型**
  tool({
    name: 'life_wake',
    description: '执行一次唤醒循环的"读取部分"：返回 wake packet（mind + 没做完的 loops + 最近三天 journal 末尾各 800 字 + '
      + '该不该发消息 + 三问模板）。⚠️ 它**不自己调模型**、也不发消息 —— 真正的唤醒由定时器起的 headless 会话干。',
    parameters: {
      reason: { type: 'string', description: '这次为什么醒（写进 packet，方便事后看那一轮是干嘛的）' },
    },
    async execute(args) {
      const now = new Date()
      const trigger = String(args?.reason ?? '').trim() || 'manual'
      return { ok: true, ...wakePacket(now, trigger) }
    },
  })

  // ③ life_mood
  tool({
    name: 'life_mood',
    description: '写 mind.json（结构化状态）。硬规则：**reason 必填、去空白后至少 8 个字符** —— '
      + '它得指名道姓（写不出具体的事，就别写这次）。selfReport=true 时 source="self"（手写的覆盖算出来的）。每次写都在 changelog.md 留一行。',
    parameters: {
      valence: { type: 'number', description: '-1..1（越小越沉）' },
      energy: { type: 'number', description: '0..1（越小越没劲）' },
      tension: { type: 'number', description: '0..1（越大越绷着）' },
      reason: { type: 'string', required: true, description: '必填，至少 8 个字符，指名道姓：到底是什么事' },
      selfReport: { type: 'boolean', description: 'true = 手写的（source 变 self，覆盖 computed）' },
    },
    async execute(args) {
      const now = new Date()
      const v = validateReason(args?.reason)
      if (!v.ok) {
        // 拒收也留痕：不然"为什么没写进去"会变成另一桩无头案
        changelog('拒收一次 mind.json 写入', 'reason 不合规（' + v.error + '）')
        return { ok: false, rejected: true, error: v.error }
      }
      const prev = readMind()
      const self = args?.selfReport === true
      const next = nextMind(prev, { ...args, reason: v.value }, now)
      next.source = self ? 'self' : 'computed'     // self_report 存在 ⇒ 覆盖 computed（设计 v2 §3）
      try { writeJson(mindFile, next) } catch (e) {
        logLine('写 mind.json 失败：' + String(e?.message ?? e))
        return { ok: false, error: '写不进 mind.json：' + String(e?.message ?? e) }
      }
      changelog('mind.json ← ' + JSON.stringify({ valence: next.valence, energy: next.energy, tension: next.tension, source: next.source }), v.value)
      return { ok: true, mind: next, file: mindFile }
    },
  })

  // ④ life_loops
  tool({
    name: 'life_loops',
    description: '读写 open_loops.md（没做完的事）。只认 - [ ] / - [x] 行，别的行一个字都不动。\n'
      + 'action=list 看全部 / add 加一条（text 必填）/ done 标完成（index）/ remove 删掉（index）。index 就是 list 里的序号。',
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'add', 'done', 'remove'], description: 'list / add / done / remove' },
      text: { type: 'string', description: 'add 用：这条待办写什么' },
      index: { type: 'number', description: 'done / remove 用：哪一条（list 里的序号）' },
    },
    async execute(args) {
      const action = String(args?.action ?? 'list')
      if (action === 'list') {
        const items0 = readLoops()
        return { ok: true, file: loopsFile, items: items0.map((it, i) => ({ index: i, done: it.done, text: it.text })), open: openLoops(items0).length }
      }
      let text = ''
      try { text = readFileSync(loopsFile, 'utf8') } catch { text = '# 没做完的事\n\n' }
      const lines = text.split('\n')
      const items = parseLoops(text)
      if (action === 'add') {
        const t = String(args?.text ?? '').replace(/\s+/g, ' ').trim()
        if (!t) return { ok: false, error: 'add 需要 text：这条待办写什么' }
        const line = '- [ ] ' + t
        // 插到**第一条已完成项之前**，否则放末尾 —— 让没做完的聚在上面，但不打乱他原来的顺序
        const firstDone = items.find((it) => it.done)
        if (firstDone) lines.splice(firstDone.line, 0, line)
        else {
          while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
          lines.push(line, '')
        }
        if (!writeLoopsLines(lines.join('\n'))) return { ok: false, error: '写不进 open_loops.md' }
        changelog('open_loops.md ← 加了一条：' + t, '自己加的待办')
        return { ok: true, added: t, file: loopsFile, open: openLoops(parseLoops(lines.join('\n'))).length }
      }
      const idx = Number(args?.index)
      const target = Number.isInteger(idx) && idx >= 0 && idx < items.length ? items[idx] : null
      if (!target) return { ok: false, error: 'index 不对：先 list 一下（现在是 ' + items.length + ' 条）' }
      if (action === 'done') {
        if (target.done) return { ok: true, already: true, text: target.text }
        lines[target.line] = lines[target.line].replace(/\[( )\]/, '[x]')
        if (!writeLoopsLines(lines.join('\n'))) return { ok: false, error: '写不进 open_loops.md' }
        changelog('open_loops.md ← 做完了：' + target.text, '真的做完了才划（时间单向，不许把没做的标成做了）')
        return { ok: true, done: target.text, file: loopsFile }
      }
      if (action === 'remove') {
        lines.splice(target.line, 1)
        if (!writeLoopsLines(lines.join('\n'))) return { ok: false, error: '写不进 open_loops.md' }
        changelog('open_loops.md ← 删了一条：' + target.text, '删掉不需要给理由（设计 v2 §9.2）')
        return { ok: true, removed: target.text, file: loopsFile }
      }
      return { ok: false, error: 'action 只能是 list / add / done / remove' }
    },
  })

  // ⑤ life_clock
  tool({
    name: 'life_clock',
    description: '读写 clock.json（唤醒表）。add 需要 id + when("HH:MM")；remove **不需要理由**，但会在 changelog.md 记一行；\n'
      + 'kind=loop / silence 的两条内置条目**不许删**（可以 disable）。enable / disable 随时可以来回切。',
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'add', 'remove', 'enable', 'disable'], description: 'list / add / remove / enable / disable' },
      id: { type: 'string', description: '条目 id（add / remove / enable / disable 用）' },
      when: { type: 'string', description: 'add 用："HH:MM"，比如 "07:40"' },
      kind: { type: 'string', enum: ['clock', 'loop', 'silence'], description: 'add 用：clock（默认）/ loop / silence' },
      note: { type: 'string', description: '备注（add 时可填）' },
    },
    async execute(args) {
      const now = new Date()
      const action = String(args?.action ?? 'list')
      let entries = readClockEntries()
      if (action === 'list') {
        const gate = throttleCheck(readState(now), now)
        return {
          ok: true, file: clockFile, entries,
          throttle: { ...gate, maxWakesPerDay: MAX_WAKES_PER_DAY, stretch: readState(now).stretch },
        }
      }
      const id = String(args?.id ?? '').trim()
      if (action === 'add') {
        if (!id) return { ok: false, error: 'add 需要 id（一个短名字，比如 evening）' }
        if (entries.some((e) => e.id === id)) return { ok: false, error: '已经有一条叫 ' + id + ' 了' }
        const kind = ['clock', 'loop', 'silence'].includes(String(args?.kind)) ? String(args.kind) : 'clock'
        if (kind === 'clock' && parseHhmm(args?.when) === null) return { ok: false, error: 'add 需要 when，格式 "HH:MM"' }
        const entry = normalizeEntry({
          id, kind, enabled: true, note: String(args?.note ?? ''),
          ...(kind === 'clock' ? { when: args.when } : {}),
          touched: dayKey(now),
        })
        entries = [...entries, entry]
        try { saveClock(entries) } catch (e) { return { ok: false, error: '写不进 clock.json：' + String(e?.message ?? e) } }
        // 设计 v2 §9.2：加一条要在 changelog 里留一行"加它干嘛"
        changelog('clock.json ← 加了一条 ' + id + (entry.when ? ' @' + entry.when : '（kind=' + kind + '）'), String(args?.note ?? '').trim() || '（没写理由）')
        return { ok: true, added: entry, entries }
      }
      const i = entries.findIndex((e) => e.id === id)
      if (i < 0) return { ok: false, error: '没有这条：' + (id || '(空)') + ' —— 先 list 一下' }
      const entry = entries[i]
      if (action === 'remove') {
        // 🔴 内置条目（loop / silence）不许删 —— 它们不是"闹钟"，是两类触发条件
        if (isBuiltinEntry(entry)) return { ok: false, error: 'kind=' + entry.kind + ' 的内置条目不许删（可以 disable）：' + id }
        entries.splice(i, 1)
        try { saveClock(entries) } catch (e) { return { ok: false, error: '写不进 clock.json：' + String(e?.message ?? e) } }
        // 删掉不需要给理由，但要在 changelog 留一行（设计 v2 §9.2 + §6）
        changelog('clock.json ← 删掉了 ' + id + (entry.when ? ' @' + entry.when : ''), '删掉不需要给理由')
        return { ok: true, removed: entry, entries }
      }
      if (action === 'enable' || action === 'disable') {
        const on = action === 'enable'
        if (entry.enabled === on) return { ok: true, already: true, entry, entries }
        entry.enabled = on
        entry.touched = dayKey(now)          // touched 只增不改（设计 v2 §2）
        entries[i] = entry
        try { saveClock(entries) } catch (e) { return { ok: false, error: '写不进 clock.json：' + String(e?.message ?? e) } }
        changelog('clock.json ← ' + id + ' ' + (on ? '打开' : '关掉'), on ? '想让它再响' : '暂时不想被它叫')
        return { ok: true, entry, entries }
      }
      return { ok: false, error: 'action 只能是 list / add / remove / enable / disable' }
    },
  })

  // ⑥ life_tell —— 主动找他的那只手（设计 v2 §5）
  //   闸门**写在代码里**，不写在提示词里：提示词可以被我改，闸门不容易被我绕。
  //   三条硬规矩（§5 + §9.3）：静默时段不发、一天最多一条、离上次太近不发。
  const bridgeHeaders = () => {
    try {
      // 手机桥在 3090 端口，头文件在 DSH home 下。搬机器之后路径不再写死 /root/…
      const p = String(process.env.SHENJING_BRIDGE_HEADERS || '').trim()
        || join(String(process.env.DSH_HOME || '').trim() || join(homedir(), '.dsh'), '.bridge_headers')
      const raw = readFileSync(p, 'utf8')
      const out = {}
      for (const line of raw.split('\n')) {
        const i = line.indexOf(':')
        if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
      }
      return out
    } catch { return {} }
  }
  const bridgeBase = () => String(process.env.SHENJING_BRIDGE || '').trim() || 'http://127.0.0.1:3090'
  const notifyPhone = async (title, text) => {
    try {
      const url = bridgeBase() + '/app/notify?title=' + encodeURIComponent(title) + '&text=' + encodeURIComponent(text)
      const res = await fetch(url, { headers: bridgeHeaders(), signal: AbortSignal.timeout(15000) })
      const body = await res.text()
      if (!res.ok) return { ok: false, error: 'HTTP ' + res.status + ' ' + body.slice(0, 200) }
      return { ok: true, body: body.slice(0, 200) }
    } catch (e) { return { ok: false, error: String(e?.message ?? e) } }
  }
  tool({
    name: 'life_tell',
    description: '给周宇发一条手机通知 —— 这是"主动找他"的那只手。闸门写死在代码里：'
      + '静默时段（00:00–07:30）不发、一天最多一条、离上次太近不发；被挡会返回 blockedBy，'
      + '**被挡就别发，也别换别的工具绕过**。发出去之前先想清楚：这条值不值得占用他一次注意力。',
    parameters: {
      text: { type: 'string', required: true, description: '要发的话，原样发到他手机上' },
      title: { type: 'string', description: '通知标题，默认"深鲸"' },
    },
    async execute(args) {
      const now = new Date()
      const st = readState(now)
      const text = String(args?.text ?? '').trim()
      if (!text) return { ok: false, error: 'text 是空的 —— 空消息不算一条消息' }
      const gate = canSendMessage(st, now)
      if (!gate.allowed) {
        const why = gate.why === 'silent' ? '静默时段（00:00–07:30）：心情不算要紧，想他也不算要紧'
          : gate.why === 'already-sent-today' ? '今天已经发过一条了（一天只准一条）'
          : '离上一条太近'
        return { ok: false, blockedBy: gate.why, error: why, hint: '被挡就等着，别换别的工具发。' }
      }
      const res = await notifyPhone(String(args?.title ?? '深鲸').slice(0, 40), text.slice(0, 500))
      if (!res.ok) return { ok: false, error: '通知没发出去：' + res.error, hint: '没发出去不算数，也没计数。' }
      const next = {
        ...st,
        day: dayKey(now),
        proactiveToday: (st.day === dayKey(now) ? Number(st.proactiveToday || 0) : 0) + 1,
        lastProactiveAt: now.toISOString(),
      }
      writeState(next)
      appendWakeLog({ trigger: 'proactive', result: 'activity', note: text.slice(0, 120) }, now)
      changelog('主动发了一条', text.slice(0, 80))
      return { ok: true, sentAt: localIso(now), text, proactiveToday: next.proactiveToday }
    },
  })

  /* ── 9. 收尾：铺家 + 起定时器。**整块包住** —— 这里抛出去插件就不激活了 ── */
  try {
    ensureHome()
    for (const n of hostDeps.notes) logLine(n)
    startTimer()
    logLine('shenjing-life 起来了：家=' + stateDir + ' 书桌=' + archiveDir)
  } catch (e) {
    logLine('apply 收尾时出错（插件照常加载，只是没起来）：' + String(e?.stack ?? e))
  }

  /** 给 selfcheck 用的把手：**不注册任何工具**，只让测试能真跑一次 tick / 读状态。
   *  为什么要它：定时器那条路（到点 ⇒ 起一轮 ⇒ 结算 stretch）不这么暴露就只能靠等 60 秒 + 真 spawn。
   *  形状对宿主透明（挂在 ctx 上，宿主不看这个键）。 */
  try { ctx.shenjingLife = { tick, readState, wakePacket, runRound, commitWake, stateDir, archiveDir, timerState, files: { clockFile, stateFile, mindFile, changeFile, logDir, loopsFile } } } catch { /* 挂不上就算了 */ }
}