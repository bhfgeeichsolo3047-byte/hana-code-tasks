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
