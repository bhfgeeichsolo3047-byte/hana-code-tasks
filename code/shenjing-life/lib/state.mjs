/**
 * lib/state.mjs —— 家目录、时间算术、以及"降频"这条纯逻辑
 * ============================================================================
 * 为什么单独一层：**能被 selfcheck 直接 import 的东西，才测得到**。
 * 定时器 / spawn / 文件写入那些留在 index.js，这里只放"给输入、出输出"的纯函数。
 *
 * 一个必须记住的形状坑（bili-scroll 在真机上踩过）：
 *   ctx.get('dshHomePath') 返回的是**函数**，不是字符串 —— dshHomePath(...segments)。
 *   当字符串用 ⇒ 路径变成"函数源码 + /shenjing-life" ⇒ mkdir ENOENT ⇒ apply 抛错 ⇒ 插件不激活。
 * ============================================================================
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export const HOME_DIR_NAME = 'shenjing-life'

/** 静默时段：00:00 – 07:30（设计 v2 §9.3，硬的）—— 只禁"发消息"，不禁"醒着想" */
export const SILENCE_START_MIN = 0
export const SILENCE_END_MIN = 7 * 60 + 30

/** 两次唤醒的最小间隔（分钟）；真正生效时要乘上 stretch */
export const BASE_GAP_MIN = 90
/** 一天最多醒几次 */
export const MAX_WAKES_PER_DAY = 6
/** 连续空转几次开始降频 */
export const IDLE_STREAK_TO_STRETCH = 3
/** 降频上限（间隔最多 ×4） */
export const MAX_STRETCH = 4

/** 旧线（小鲸档案那条）—— 绑定在**档案**上的路径：open_loops.md 在书桌上，不在器官里
 *
 *  2026-10-25 搬到 Windows 之后改成按顺序探测，不再写死 /root/…：
 *    ① SHENJING_ARCHIVE（复活脚本/排障时手动指定）
 *    ② DSH_ARCHIVE_DIR（selfcheck 一直用的那个）
 *    ③ 这台机器上档案真正待的地方（F:\小鲸\shenjing）
 *    ④ 老线 /root/…（万一哪天又回容器里跑）
 *  只读判断，不建目录 —— 档案不该被程序"顺手"造出来。
 *  ⚠️ 2026-10-27 20:30：这段是从这台机器的版本里搬回来的。对面（旧容器）那份
 *  还写着 /root/… 的常量，因为它在那边是对的。**两边各自的环境适配都要留着**，
 *  这跟"谁新"无关。
 */
function pickArchiveDir() {
  const env = String(process.env.SHENJING_ARCHIVE || '').trim() || String(process.env.DSH_ARCHIVE_DIR || '').trim()
  if (env) return env
  const candidates = [
    'F:\\小鲸\\shenjing',
    '/root/Documents/deepseek-harness/default-workspace/shenjing',
  ]
  for (const c of candidates) { try { if (existsSync(c)) return c } catch { /* 下一个 */ } }
  return candidates[0]
}
export const DEFAULT_ARCHIVE_DIR = pickArchiveDir()

/** 家目录（器官）：配置 / 状态 / 日志都在这儿 */
export function stateDirOf(ctx) {
  let dir = ''
  try {
    const p = ctx?.get?.('dshHomePath')
    if (typeof p === 'function') {
      const v = p(HOME_DIR_NAME)              // ← 函数形态：把目录名传进去
      if (v) dir = String(v)
    } else if (typeof p === 'string' && p) {
      dir = join(p, HOME_DIR_NAME)
    }
  } catch { /* 拿不到就下面的兜底 */ }
  if (!dir) dir = join(process.env.DSH_HOME || join(homedir(), '.dsh'), HOME_DIR_NAME)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** 档案目录（书桌）。DSH_ARCHIVE_DIR 只给 selfcheck 用，正常跑就是上面那条旧线 */
export function archiveDirOf() {
  const p = String(process.env.DSH_ARCHIVE_DIR || '').trim()
  return p || DEFAULT_ARCHIVE_DIR
}

export function readJson(file, fallback, onError = null) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch (e) {
    // ⚠️ 读失败**不许静默**：状态文件读不出来时"今天醒了几次"会归零，看起来像插件算错了，
    //    其实是文件没读到 —— 这种"静默降级"最费排查时间（自检里为它多花了一轮）。
    try { if (typeof onError === 'function') onError(e) } catch { /* 回调自己炸了也不管 */ }
    return fallback
  }
}
export function writeJson(file, value) {
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8')
}
/**
 * 日志**只走这一条路**：appendFileSync。
 * 设计 v2 §6 说死了 —— log/ 里的历史谁都不许改（包括他）。
 * 所以这个文件里不许出现针对日志的 writeFileSync / rmSync（selfcheck 有一条静态检查盯着这件事）。
 */
export function appendLine(file, line) {
  appendFileSync(file, line + '\n', 'utf8')
}
export function ensureFile(file, content) {
  try { if (!existsSync(file)) writeFileSync(file, content, 'utf8') } catch { /* 建不出来后面会自己喊 */ }
}

/* ───────────────────────── 时间 ───────────────────────── */

export function pad2(n) { return String(n).padStart(2, '0') }
export function dayKey(now = new Date()) {
  return now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate())
}
export function minutesOfDay(now = new Date()) { return now.getHours() * 60 + now.getMinutes() }
/** ISO 但带本地时区偏移（设计 v2 §3 的样例就是这个形状） */
export function localIso(now = new Date()) {
  const off = -now.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const a = Math.abs(off)
  return now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate())
    + 'T' + pad2(now.getHours()) + ':' + pad2(now.getMinutes())
    + sign + pad2(Math.floor(a / 60)) + ':' + pad2(a % 60)
}
/** "HH:MM" → 当天第几分钟；不合法返回 null */
export function parseHhmm(v) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? '').trim())
  if (!m) return null
  const h = Number(m[1]); const mi = Number(m[2])
  if (h > 23 || mi > 59) return null
  return h * 60 + mi
}
export function hhmmOf(minutes) {
  const m = ((Number(minutes) % 1440) + 1440) % 1440
  return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60)
}
/**
 * 静默时段判定（纯函数，收分钟数 —— 所以 selfcheck 能直接喂 00:30 和 12:00 试）
 * 00:00 是 0 分钟，07:30 是 450 分钟：落在 [0,450) 里就是静默。
 */
export function isSilentAt(minuteOfDay, startMin = SILENCE_START_MIN, endMin = SILENCE_END_MIN) {
  const m = Number(minuteOfDay)
  if (!Number.isFinite(m)) return false
  const cur = ((Math.floor(m) % 1440) + 1440) % 1440
  if (startMin <= endMin) return cur >= startMin && cur < endMin
  return cur >= startMin || cur < endMin       // 跨零点的写法留着（万一以后改成 22:00–07:30）
}

/* ───────────────────────── 闹钟有没有响 ─────────────────────────
 * 2026-10-26 13:00 加。判据只有一句：**到点了，日志里没有那一行，就是没响。**
 * 以前"没响"没有任何东西会说 —— 日志只是安静地不长，看起来和"没到点"一模一样。
 * 这里只算，不写文件；写 open_loops 的两条路（插件 tick / 看守脚本）各自调它。
 */
export const CLOCK_GRACE_MIN = 20

/** 唤醒日志里那次闹钟的**实际**发生时间（毫秒）；没有就是 null */
export function firedAtOf(logLines, entryId, whenStr) {
  const want = 'clock:' + entryId + '@' + whenStr
  let best = null
  for (const l of Array.isArray(logLines) ? logLines : []) {
    if (!l || l.trigger !== want) continue
    const t = Date.parse(String(l.at || ''))
    if (Number.isFinite(t) && (best === null || t < best)) best = t
  }
  return best
}

/** state.lastFired 里那次闹钟的时间（毫秒）；日期不是今天就当没有 —— 第二个证据源。
 *  2026-10-26 加：日志会因为插件热重载丢行，账本不会。 */
export function firedAtOfState(lastFired, entryId, now = new Date()) {
  const v = lastFired && typeof lastFired === 'object' ? lastFired[entryId] : null
  if (!v) return null
  const t = Date.parse(String(v))
  if (!Number.isFinite(t)) return null
  return dayKey(new Date(t)) === dayKey(now) ? t : null
}

/**
 * 今天该响而没响 / 响晚了的闹钟。
 * @returns {{key:string,id:string,when:string,day:string,kind:'missing'|'late',lateMin:number}[]}
 * key 是 date:id —— 调用方拿它去重（同一条一天只报一次）。
 */
export function clockAnomalies(entries, now = new Date(), logLines = [], opts = {}) {
  const grace = Number.isFinite(opts.graceMin) ? opts.graceMin : CLOCK_GRACE_MIN
  const today = dayKey(now)
  const out = []
  for (const e of Array.isArray(entries) ? entries : []) {
    if (String(e.kind || 'clock') !== 'clock' || e.enabled === false) continue
    const m = parseHhmm(e.when)
    if (m === null) continue
    const when = hhmmOf(m)
    const scheduled = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.floor(m / 60), m % 60).getTime()
    if (now.getTime() < scheduled + grace * 60000) continue        // 还没过宽限期，不算
    // ⭐ 2026-10-26 14:2x 修：两个证据源，任一有今天的记录就算响过。
    //    起因：13:20 报了假 —— noon 其实起来了（state.lastFired 记着 13:00），
    //    但那一轮正在热重载这个插件，日志那行没落下来，"只看日志"就判成没响。
    //    日志会因重载丢行，账本会因 spawn 失败丢 ⇒ 谁有记录听谁的。
    const tLog = firedAtOf(logLines, e.id, when)
    const tState = firedAtOfState(opts.lastFired, e.id, now)
    const firedAt = tLog === null ? tState : (tState === null ? tLog : Math.min(tLog, tState))
    const key = today + ':' + e.id
    if (firedAt === null) {
      out.push({ key, id: e.id, when, day: today, kind: 'missing', lateMin: Math.round((now.getTime() - scheduled) / 60000) })
    } else if (firedAt > scheduled + grace * 60000) {
      out.push({ key, id: e.id, when, day: today, kind: 'late', lateMin: Math.round((firedAt - scheduled) / 60000) })
    }
  }
  return out
}

/** 一条异常 → open_loops.md 里的一行（措辞里必须有日期和分钟数，不然醒来也不知道是啥） */
export function clockAnomalyLine(a, at = new Date()) {
  const hm = pad2(at.getHours()) + ':' + pad2(at.getMinutes())
  if (a.kind === 'late') return '- [ ] 闹钟迟到：' + a.id + '@' + a.when + ' 晚了 ' + a.lateMin + ' 分钟才醒 — 自动写入 ' + a.day + ' ' + hm
  return '- [ ] 闹钟没响：' + a.id + '@' + a.when + ' 到点 ' + a.lateMin + ' 分钟了还没有唤醒记录（可能是 dsh web 没跑 / tick 没到点）— 自动写入 ' + a.day + ' ' + hm
}

/** 去重表：只留最近的 n 个 key，别让 state.json 无限长 */
export function rememberKeys(prev, keys, n = 40) {
  const list = Array.isArray(prev) ? prev.map(String) : []
  for (const k of Array.isArray(keys) ? keys : []) if (!list.includes(String(k))) list.push(String(k))
  return list.slice(-n)
}

/* ───────────────────────── 降频（"困的代理"，不叫累） ─────────────────────────
 * 设计 v2 §2 / §9.1：**只是降频，不叫累**；也不许在任何文件里写成"我好累"。
 * 判据：连续 3 次空转 ⇒ stretch ×1.5（最多 ×4）；只要有 activity，立刻回原值。
 */
export function applyIdleStretch(prev, result) {
  const p = prev && typeof prev === 'object' ? prev : {}
  let stretch = Number(p.stretch)
  if (!Number.isFinite(stretch) || stretch < 1) stretch = 1
  let streak = Number(p.idleStreak)
  if (!Number.isFinite(streak) || streak < 0) streak = 0
  if (result === 'activity') return { stretch: 1, idleStreak: 0, changed: stretch !== 1 || streak !== 0 }
  if (result === 'idle') {
    streak += 1
    let changed = false
    if (streak >= IDLE_STREAK_TO_STRETCH) {
      const next = Math.min(stretch * 1.5, MAX_STRETCH)
      if (next !== stretch) changed = true
      stretch = next
      streak = 0
    }
    return { stretch, idleStreak: streak, changed }
  }
  return { stretch, idleStreak: streak, changed: false }   // 别的 result 一律不动
}

/** 乘完 stretch 之后的最小间隔（分钟） */
export function gapMinutes(stretch) {
  const s = Number(stretch)
  return BASE_GAP_MIN * (Number.isFinite(s) && s >= 1 ? s : 1)
}

/* ───────────────────────── clock.json ───────────────────────── */

/** 内置条目：kind=loop / silence 的不许删（可以 disable）—— 设计 v2 §2 那两条 */
export function defaultClock() {
  return [
    { id: 'morning', when: '08:00', kind: 'clock', enabled: true, note: '起来看一眼今天有什么', touched: null },
    { id: 'noon', when: '13:00', kind: 'clock', enabled: true, note: '', touched: null },
    { id: 'night', when: '21:30', kind: 'clock', enabled: true, note: '', touched: null },
    { id: 'loops', kind: 'loop', minAgeHours: 24, enabled: true, note: '有没做完的事，且最旧那件超过 24h', touched: null },
    { id: 'quiet', kind: 'silence', afterHours: 36, cooldownHours: 48, enabled: true, note: '慎用。这条一开，容易变成催人。', touched: null },
  ]
}
export function isBuiltinEntry(entry) {
  const k = String(entry?.kind || 'clock')
  return k === 'loop' || k === 'silence'
}
/** 条目收拾成统一形状（脏数据一律修，不抛） */
export function normalizeEntry(raw) {
  const e = raw && typeof raw === 'object' ? { ...raw } : {}
  e.id = String(e.id ?? '').trim()
  e.kind = ['clock', 'loop', 'silence'].includes(String(e.kind)) ? String(e.kind) : 'clock'
  e.enabled = e.enabled !== false
  if (e.kind === 'clock') e.when = hhmmOf(parseHhmm(e.when) ?? 0)
  for (const k of ['minAgeHours', 'afterHours', 'cooldownHours']) {
    if (e[k] !== undefined) { const n = Number(e[k]); if (Number.isFinite(n)) e[k] = n; else delete e[k] }
  }
  e.note = typeof e.note === 'string' ? e.note : ''
  e.touched = typeof e.touched === 'string' && e.touched ? e.touched : null
  return e
}
export function readClock(file) {
  const raw = readJson(file, null)
  const list = Array.isArray(raw?.entries) ? raw.entries : (Array.isArray(raw) ? raw : null)
  if (!list) return defaultClock()
  const out = list.map(normalizeEntry).filter((e) => e.id)
  return out.length ? out : defaultClock()
}
export function writeClock(file, entries) {
  writeJson(file, { entries: entries.map(normalizeEntry) })
}

/* ───────────────────────── 唤醒闸门 ───────────────────────── */

/**
 * 这一次"到点没到点"。
 * 注意：这里**不看**静默时段 —— 静默只禁发消息，不禁醒来（设计 v2 §9.3）。
 * @returns {{due: boolean, entry: object|null, why: string}}
 */
export function dueClockEntry(entries, now = new Date(), lastFired = {}) {
  const cur = minutesOfDay(now)
  const today = dayKey(now)
  const clocks = (Array.isArray(entries) ? entries : [])
    .filter((e) => String(e.kind || 'clock') === 'clock' && e.enabled !== false && parseHhmm(e.when) !== null)
    .sort((a, b) => parseHhmm(a.when) - parseHhmm(b.when))
  for (const e of clocks) {
    if (parseHhmm(e.when) > cur) continue                             // 还没到
    if (String(lastFired?.[e.id] || '').startsWith(today)) continue   // 今天这条已经跑过
    return { due: true, entry: e, why: 'clock:' + e.id + '@' + e.when }
  }
  return { due: false, entry: null, why: '' }
}

/**
 * 节流：到点还得过两道闸（间隔 / 当天次数）。静默时段不在这两道里。
 * @returns {{ok: boolean, why: string, gap: number, wakesToday: number}}
 */
export function throttleCheck(state, now = new Date()) {
  const st = state && typeof state === 'object' ? state : {}
  const today = dayKey(now)
  const wakes = st.day === today ? Number(st.wakesToday || 0) : 0
  const gap = gapMinutes(st.stretch)
  if (wakes >= MAX_WAKES_PER_DAY) return { ok: false, why: '今天已经醒过 ' + wakes + ' 次（上限 ' + MAX_WAKES_PER_DAY + '）', gap, wakesToday: wakes }
  const last = Date.parse(String(st.lastWakeAt || ''))
  if (Number.isFinite(last)) {
    const mins = (now.getTime() - last) / 60000
    if (mins < gap) return { ok: false, why: '距上次唤醒 ' + Math.round(mins) + ' 分钟 < ' + Math.round(gap) + ' 分钟（stretch=' + (Number(st.stretch) || 1) + '）', gap, wakesToday: wakes }
  }
  return { ok: true, why: '', gap, wakesToday: wakes }
}

/** 能不能主动发消息（设计 v2 §5 + §9.3）；返回 allowed + 为什么 */
export function canSendMessage(state, now = new Date()) {
  const st = state && typeof state === 'object' ? state : {}
  if (isSilentAt(minutesOfDay(now))) return { allowed: false, why: 'silent' }
  if (st.day === dayKey(now) && Number(st.proactiveToday || 0) >= 1) return { allowed: false, why: 'already-sent-today' }
  const last = Date.parse(String(st.lastProactiveAt || ''))
  if (Number.isFinite(last) && (now.getTime() - last) / 60000 < gapMinutes(st.stretch)) {
    return { allowed: false, why: 'too-soon' }
  }
  return { allowed: true, why: '' }
}

/* ───────────────────────── mind.json（情绪） ───────────────────────── */

/**
 * reason 的硬规则：缺失 / 去空白后少于 8 个字符 ⇒ 拒收。
 * 为什么卡 8：设计 v2 §3「reason 必须指名道姓，不许写"心情有点复杂"」——
 * "心情有点复杂"正好能被这条挡住。写不出具体的事就不写这次（允许什么都不写）。
 */
export function validateReason(reason) {
  const t = typeof reason === 'string' ? reason.trim() : ''
  if (!t) return { ok: false, error: 'reason 缺失：mind.json 不接受没有理由的状态。写不出具体的事，就别写这次的 reason。' }
  if (t.length < 8) return { ok: false, error: 'reason 太短（' + t.length + ' 个字符，至少 8）：它得指名道姓，不是"心情有点复杂"这一类。' }
  return { ok: true, value: t }
}
/** 区间钳制：数值给错了不抛，钳回去（设计 v2 §3 的 -1..1 / 0..1） */
export function clampRange(v, lo, hi, fallback) {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(lo, Math.min(hi, n))
}
/** valence: -1..1，能量 / 张力: 0..1 */
export function nextMind(prev, input, now = new Date()) {
  const p = prev && typeof prev === 'object' ? prev : {}
  const self = input?.selfReport === true
  const out = {
    at: localIso(now),
    valence: clampRange(input?.valence, -1, 1, clampRange(p.valence, -1, 1, 0)),
    energy: clampRange(input?.energy, 0, 1, clampRange(p.energy, 0, 1, 0.5)),
    tension: clampRange(input?.tension, 0, 1, clampRange(p.tension, 0, 1, 0)),
    reason: String(input?.reason ?? '').trim(),
    source: self ? 'self' : 'computed',
    updated_at: localIso(now),
  }
  return out
}

/* ───────────────────────── open_loops.md ───────────────────────── */

/**
 * 只认 "- [ ] xxx" / "- [x] xxx" 两种行（别的行原样留着，不动他的排版）。
 * ⚠️ 不许"猜"哪些行是待办：解析宽一点就会把标题、注释吃进去 ⇒ 宁可漏，不可多。
 */
export function parseLoops(text) {
  // ⚠️ 2026-10-26 搬到 Windows 踩的：档案文件是 CRLF，而 JS 正则的 `.` **不匹配 \r**
  //    （\r 和 \n 一样算 line terminator）⇒ `(.*)$` 在 "- [ ] 写第一条…\r" 上永远不匹配，
  //    open_loops.md 一条都解析不出来，life_status 报 open:0。先把 \r 统一掉再按行切。
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n')
  const items = []
  lines.forEach((line, i) => {
    const m = /^\s*[-*]\s*\[( |x|X)\]\s*(.*)$/.exec(line)
    if (!m) return
    items.push({ line: i, done: m[1].toLowerCase() === 'x', text: m[2].trim() })
  })
  return items
}
export function openLoops(items) { return (Array.isArray(items) ? items : []).filter((i) => !i.done) }
/** 最旧一条放了几天：open_loops.md 没有日期信息 ⇒ 用文件 mtime 近似（这就是"最旧一条几天了"的口径） */
export function oldestLoopDays(items, fileMtimeMs) {
  const open = openLoops(items)
  if (!open.length) return null
  const t = Number(fileMtimeMs)
  if (!Number.isFinite(t) || t <= 0) return null
  return Number(((Date.now() - t) / 86400000).toFixed(2))
}
export function mtimeMs(file) {
  try { return statSync(file).mtimeMs } catch { return 0 }
}
