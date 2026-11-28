/**
 * 值班轮"这一班算哪一夜的账" —— 纯函数，不读文件、不看时间以外的东西。
 *
 * 为什么要有这个（2026-11-09 13:00 发现，2026-11-24 08:00 随 2.5.3 重写，
 * 2026-11-28 21:33 修边界）：
 *   夜班窗口是 18:00–09:00（**北京时间**，inWindow 就是按北京口径判的），跨零点。
 *   上游的键写成 `${今天}:night` —— **按开跑那一刻的日历日**。
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
 * 2026-11-28 21:33 的补：上一版拿**本机时钟**的小时数跟北京口径的 end(09:00) 比大小 ——
 *   两个钟差一小时，于是 JST 09:00–09:59（北京 08:00–08:59，还在夜窗口里）
 *   被算成「今天这一夜」，键提前翻页。
 *   今天正好周六，inWindow 周末全天算谷时 ⇒ 09:00:00 那一跳把 `2026-11-28:night`
 *   烧掉，晚上 19:00 那班看见 done 跳过。duty.log 里就是一行
 *   `2026-11-28T00:00:00.232Z 刷B站开跑（window:night）`（JST 09:00），之后再没夜班。
 *   ⇒ 现在窗口位置的判断和 inWindow 统一走北京时间，键取「这一班**起点那一刻**的本机日历日」。
 *     起点 18:00 北京 = 19:00 本机，键落在它开跑的那一天，不管跑在夜里几点。
 *
 * 光有键还不够：bumpState 天翻页时会把 windows 整个清空，凌晨那跳就找不到昨晚的键了
 * （旧的 bug 正是被这一清掩住的）。所以清空改成 pruneWindows：留住最近几天的键。
 * 键里带日期，旧的自然失效，不会误挡今天的班。
 *
 * 这是深鲸自己的补丁，不是上游的代码。插件升级会把它抹掉 ——
 * 抹掉之后体检（tools/audit-archive.py）会报 exit 4，用 tools/apply-patches.mjs 装回来。
 */

const BEIJING_OFFSET_MINUTES = 8 * 60

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
 * 北京时间的墙上时间：窗口边界一律按北京口径（和 inWindow 同一个时钟）。
 * 本机是 UTC+9，北京是 UTC+8 —— 差这一小时就够把夜班的账记错一天。
 */
function beijingWall(d) {
  const s = new Date(d.getTime() + BEIJING_OFFSET_MINUTES * 60 * 1000)
  return {
    y: s.getUTCFullYear(),
    mo: s.getUTCMonth(),
    day: s.getUTCDate(),
    minutes: s.getUTCHours() * 60 + s.getUTCMinutes(),
  }
}

/**
 * 这一班该记在哪一天的账上。
 * @param {string} name 窗口名（noon / night）
 * @param {{start:string,end:string}} win
 * @param {Date|number} now
 * @returns {string} 形如 `2026-11-08:night`
 */
export function windowKeyFor(name, win, now = new Date()) {
  const raw = now instanceof Date ? now : new Date(Number(now))
  const d = Number.isNaN(raw.getTime()) ? new Date() : raw
  const start = minutesOf(win?.start)
  const end = minutesOf(win?.end)
  // 窗口配置坏了就退到当天，不炸
  if (start === null || end === null) return `${localDay(d)}:${name}`

  const bj = beijingWall(d)
  const crossesMidnight = start > end
  // 还停在 end 之前 ⇒ 这一班是**昨天**傍晚开的（凌晨补跑也算昨夜，不占第二天）
  const dayOffset = crossesMidnight && bj.minutes < end ? -1 : 0
  // 起点在北京时间的墙上时间 —— 换回真实时刻，再按本机日历取它的日期
  const startUtc = Date.UTC(bj.y, bj.mo, bj.day + dayOffset, Math.floor(start / 60), start % 60)
  const startInstant = new Date(startUtc - BEIJING_OFFSET_MINUTES * 60 * 1000)
  return `${localDay(startInstant)}:${name}`
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
