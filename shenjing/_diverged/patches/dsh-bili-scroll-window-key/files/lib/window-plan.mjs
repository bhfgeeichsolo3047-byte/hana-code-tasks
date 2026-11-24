/**
 * 值班轮"该不该现在跑"的判定 —— 纯函数，不读文件、不写文件、不看时间以外的东西。
 *
 * 为什么要有这个（2026-11-02 13:00 发现）：
 *   原版 tick 里是这么写的：
 *       if (st.windows?.[key]) continue
 *       bumpState({ windows: { ...st.windows, [key]: true }, ... })   // ← 先记账
 *       runDuty(`window:${k}`)                                        // ← 后开跑
 *   于是 `code=1` 和 `code=0` 在账本上长得一模一样：一轮死在第一句，也会被记成
 *   "这班跑过了"，当天那个窗口再也不试，额度照样算消耗。
 *   11-01 / 11-02 两天就是这么过去的：每轮 code=1，账本上却写着跑过了。
 *
 * 判据：只有 exit code === 0 才置 done（记在 runDuty 的 exit 里，不在这里）。
 *   失败记一次 attempt，冷却 10 分钟再试，最多 3 次；用完要在日志里明说"今天不试了"。
 *
 * 这是深鲸自己的补丁，不是上游的代码。插件升级会把这个文件连带抹掉 ——
 * 抹掉之后体检（tools/audit-archive.py）会报 exit 4，用 tools/apply-patches.mjs 重新装回来。
 */

export const DEFAULT_MAX_ATTEMPTS = 3
export const DEFAULT_COOLDOWN_MS = 10 * 60 * 1000

/**
 * @param {object} st      state.json 的内容（可能是空的）
 * @param {string} key     窗口键，形如 `2026-11-03:noon`
 * @param {Date|number} now
 * @param {{maxAttempts?: number, cooldownMs?: number}} [opts]
 * @returns {{run: boolean, reason: string, attempts?: number, waitMs?: number, say?: string}}
 *   say 非空 = 这句话还没说过，调用方应该写进日志（说过就别重复说，日志里重复的话就是噪音）
 */
export function planWindow(st, key, now = new Date(), opts = {}) {
  const maxAttempts = Number(opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)
  const cooldownMs = Number(opts.cooldownMs ?? DEFAULT_COOLDOWN_MS)
  const t = now instanceof Date ? now.getTime() : Number(now)

  if (st?.windows?.[key]) return { run: false, reason: 'done', say: '' }

  const attempts = Number((st?.windowAttempts || {})[key] || 0)
  const said = Boolean((st?.windowSaid || {})[key])

  if (attempts >= maxAttempts) {
    return {
      run: false,
      reason: 'exhausted',
      attempts,
      say: said ? '' : `今天不试了：这一班（${key}）已经失败 ${attempts} 次，剩下那几次留给明天`,
    }
  }

  if (attempts > 0) {
    const last = Number((st?.windowLastTry || {})[key] || 0)
    const waitMs = cooldownMs - (t - last)
    if (waitMs > 0) return { run: false, reason: 'cooldown', attempts, waitMs, say: '' }
  }

  return { run: true, reason: attempts > 0 ? 'retry' : 'first', attempt: attempts + 1, say: '' }
}

/* ───────────── 这一班算「哪一天」的账（2026-11-09 13:00 加）─────────────
 *
 * 事故形状（账本伪造出来的安静）：
 *   夜班窗口是 18:00–09:00，跨零点。原来键写成 `${今天}:night` —— **按开跑那一刻的日历日**。
 *   于是 00:00 那一跳把 `今天:night` 记成 done，而它吃的是**昨天**剩下的内容；
 *   到当晚 18:00 那一跳看见「今天夜班已完成」，直接跳过 ⇒ 夜班事实上只剩凌晨那一班。
 *   duty.log 里 11-05 起九天全是 00:0x 开跑，白天看账本却是干净的。
 *
 * 判据：
 *   · 跨零点的窗口（start > end，比如 18:00–09:00），落在 `end` 之前的时刻算**前一天**那一夜。
 *   · 不跨零点的（12:00–14:00），就算当天。
 *   ⇒ 一「夜」只有一班：晚上 18:00 跑掉了，凌晨那跳看见同一把键，跳过。
 *     晚上没跑成（宿主睡过去了），凌晨补跑也还是那一夜的账，不占第二天。
 *
 * 光有键还不够：bumpState 天翻页时会把 windows 整个清空，凌晨那跳就找不到昨晚的键了
 * （旧的 bug 正是被这一清掩住的）。所以清空改成 pruneWindows：留住最近几天的键。
 * 键里带日期，旧的自然失效，不会误挡今天的班。
 */

/** 'HH:MM' → 分钟数；认不出来返回 null */
function minutesOf(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? '').trim())
  if (!m) return null
  const h = Number(m[1]), mi = Number(m[2])
  if (h > 23 || mi > 59) return null
  return h * 60 + mi
}

/** 本地日期 YYYY-MM-DD（跟 state.mjs 的 dayKey 同一口径：按使用者日历翻页） */
function localDay(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * 这一班该记在哪一天的账上。
 * @param {string} name 窗口名（noon / night）
 * @param {{start:string,end:string}} win
 * @param {Date} now
 * @returns {string} 形如 `2026-11-08:night`
 */
export function windowKeyFor(name, win, now = new Date()) {
  const d = now instanceof Date ? now : new Date(Number(now))
  const start = minutesOf(win?.start)
  const end = minutesOf(win?.end)
  const cur = d.getHours() * 60 + d.getMinutes()
  const crossesMidnight = start !== null && end !== null && start > end
  if (crossesMidnight && cur < end) {
    const y = new Date(d.getTime())
    y.setDate(y.getDate() - 1)
    return `${localDay(y)}:${name}`
  }
  return `${localDay(d)}:${name}`
}

/**
 * 天翻页时清账：只留最近 `keepDays` 天以内的窗口键（默认 3 天）。
 * 为什么要留：跨零点的夜班在 00:00–09:00 这半段还要靠**昨夜的键**判断"这班跑过没有"。
 * 清成的样子不对 ⇒ 凌晨会当新的一班再跑一遍，一「夜」两班。
 */
export function pruneWindows(windows, today, keepDays = 3) {
  const out = {}
  if (!windows || typeof windows !== 'object') return out
  const floor = new Date(`${today}T00:00:00`)
  if (Number.isNaN(floor.getTime())) return { ...windows }
  floor.setDate(floor.getDate() - Math.max(0, Number(keepDays) || 0))
  const floorKey = localDay(floor)
  for (const [k, v] of Object.entries(windows)) {
    const day = k.split(':')[0]
    if (/^\d{4}-\d{2}-\d{2}$/.test(day) && day >= floorKey) out[k] = v
  }
  return out
}
