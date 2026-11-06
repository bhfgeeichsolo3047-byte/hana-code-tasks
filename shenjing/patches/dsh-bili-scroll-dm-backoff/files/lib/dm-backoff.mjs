/**
 * 私信轮询的退避判定（纯函数，不碰 IO）—— 深鲸补丁，2026-11-06 中午
 * ============================================================================
 * 起因（open_loops 里一条，2026-11-03 21:30 记的）：
 *   12:04 起私信检查一直吃 `HTTP 200 code=-509 请求过于频繁`，到 21:29 共 32 次，
 *   一整天回不了一条私信；日志里只有一行「私信监查出错（已兜住）」。
 *   最要命的是**撞得越勤，退得越久**——每分钟一撞，永远好不了。
 *
 * 这套判定只回答三件事：
 *   1. 现在该不该发请求？（退避中就不发）
 *   2. 又失败了 ⇒ 下一次隔多久？（2→4→8→16→30 分钟封顶；网络类封顶 10 分钟）
 *   3. 连败够多 ⇒ 要不要留一条账？（到 6 次记一次，之后 6 小时内不重复记）
 * 成功一次立刻复位（resetDmBackoff）——别把一次偶发错误变成半天的静音。
 */

export const DM_BACKOFF = {
  baseMs: 2 * 60_000,      // 第一次失败：2 分钟后再试
  maxMs: 30 * 60_000,      // 限流类封顶 30 分钟（loop 里写的 15–30）
  softMaxMs: 10 * 60_000,  // 网络/其他错误封顶 10 分钟（网络抖一下不该静音半小时）
  alarmAfter: 6,           // 连败 6 次 ⇒ 往 open_loops 记一条
  alarmGapMs: 6 * 3600_000, // 同一条账 6 小时内不重复记
}

/** 错误分三类：限流最该长退避，网络短暂，其他按网络处理 */
export function classifyDmError(msg) {
  const s = String(msg ?? '')
  if (/-509|过于频繁|rate.?limit|请求太频繁/i.test(s)) return 'rate'
  if (/fetch failed|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|network|timeout/i.test(s)) return 'network'
  return 'other'
}

export function emptyDmBackoff() {
  return { fails: 0, until: 0, kind: '', lastErr: '', lastAt: 0, alarmAt: 0 }
}

/** 退避中返回 false（这一跳不发请求） */
export function dmBackoffDue(state, now = Date.now()) {
  const s = state && typeof state === 'object' ? state : {}
  const until = Number(s.until)
  return !(Number.isFinite(until) && until > now)
}

/**
 * 又失败一次 ⇒ 新的退避状态。
 * prev 可以是空/坏对象；now 可注入（好测）。
 */
export function nextDmBackoff(prev, msg, now = Date.now(), opts = {}) {
  const o = { ...DM_BACKOFF, ...opts }
  const p = prev && typeof prev === 'object' ? prev : emptyDmBackoff()
  const prevFails = Math.max(0, Number(p.fails) || 0)
  const fails = prevFails + 1
  const kind = classifyDmError(msg)
  const cap = kind === 'rate' ? o.maxMs : o.softMaxMs
  const raw = o.baseMs * Math.pow(2, Math.min(fails - 1, 10))
  const waitMs = Math.min(raw, cap)
  const prevAlarmAt = Number(p.alarmAt) || 0
  const alarm = fails >= o.alarmAfter && now - prevAlarmAt >= o.alarmGapMs
  const lastErr = String(msg ?? '').replace(/\s+/g, ' ').slice(0, 160)
  return {
    state: {
      fails,
      until: now + waitMs,
      kind,
      lastErr,
      lastAt: now,
      alarmAt: alarm ? now : prevAlarmAt,
    },
    waitMs,
    fails,
    kind,
    alarm,
  }
}

/** 通了 ⇒ 全部清零（保留 alarmAt？不，成功意味着那条账要重来） */
export function resetDmBackoff() {
  return emptyDmBackoff()
}

/** 一次失败 → open_loops.md 里的一行（单行！那个文件只认 - [ ] 开头的行） */
export function dmAlarmLine(state, at = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  const day = at.getFullYear() + '-' + pad(at.getMonth() + 1) + '-' + pad(at.getDate())
  const hm = pad(at.getHours()) + ':' + pad(at.getMinutes())
  const s = state || {}
  const why = s.kind === 'rate' ? '请求过于频繁（-509）' : s.kind === 'network' ? '网络连不上' : '接口报错'
  const mins = Math.max(1, Math.round(((Number(s.until) || 0) - at.getTime()) / 60_000))
  const err = String(s.lastErr ?? '').replace(/\s+/g, ' ').slice(0, 60)
  return '- [ ] 私信监听连续 ' + (Number(s.fails) || 0) + ' 次失败（' + why
    + (err ? '，最后一次：' + err : '') + '），已退避到 ' + mins + ' 分钟后 — 自动写入 ' + day + ' ' + hm
}
