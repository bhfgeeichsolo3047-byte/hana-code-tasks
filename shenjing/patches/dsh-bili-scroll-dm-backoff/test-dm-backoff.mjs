#!/usr/bin/env node
/**
 * dm-backoff 的单测 —— 2026-11-06 中午
 * 判据（每条都得真红过一次才算数）：
 *   1. -509 之后间隔必须变长（2/4/8/16/30，封顶）
 *   2. 成功一次立刻复位（不是"慢慢降"）
 *   3. 连败到 6 次留一条账；6 小时内不重复记
 *   4. 网络类错误封顶比限流短（网络抖一下不该静音半小时）
 *   5. 账单只有一行（open_loops.md 只认 - [ ] 行）
 * 跑法：node test-dm-backoff.mjs
 */
import { nextDmBackoff, resetDmBackoff, dmBackoffDue, classifyDmError, emptyDmBackoff, dmAlarmLine, DM_BACKOFF } from './files/lib/dm-backoff.mjs'

let pass = 0
const fails = []
function ok(cond, what) {
  if (cond) { pass++; return }
  fails.push(what)
}
const near = (a, b) => Math.abs(a - b) < 1e-6
const M = 60_000

// ① 指数退避 + 封顶
let st = emptyDmBackoff()
let t = 1_000_000
const waits = []
for (let i = 0; i < 8; i++) {
  const r = nextDmBackoff(st, 'HTTP 200 code=-509 msg=请求过于频繁，请稍后再试', t)
  st = r.state
  waits.push(r.waitMs / M)
  t += r.waitMs
}
ok(near(waits[0], 2), '第一次 -509 应该退 2 分钟，实际 ' + waits[0])
ok(near(waits[1], 4), '第二次应该 4 分钟，实际 ' + waits[1])
ok(near(waits[2], 8), '第三次应该 8 分钟，实际 ' + waits[2])
ok(near(waits[3], 16), '第四次应该 16 分钟，实际 ' + waits[3])
ok(waits.every((w) => w <= 30), '封顶 30 分钟，实际最大 ' + Math.max(...waits))
ok(waits[4] === 30 && waits[7] === 30, '之后一直停在 30 分钟，实际 ' + waits.slice(4).join(','))
ok(st.fails === 8, '连败计数应该到 8，实际 ' + st.fails)

// ② 退避中不发请求；到点才发
const now2 = 5_000_000
ok(dmBackoffDue({ fails: 1, until: now2 - 1 }, now2) === true, '过期了就该发')
ok(dmBackoffDue({ fails: 1, until: now2 + 1 }, now2) === false, '还没到点不许发')
ok(dmBackoffDue(null, now2) === true, '没有状态 = 该发')
ok(dmBackoffDue({ until: 'x' }, now2) === true, '坏状态不许永久卡住')

// ③ 成功一次立刻复位
const res = resetDmBackoff()
ok(res.fails === 0 && res.until === 0, '复位后应该什么都不剩')
// 复位之后的下一次错误，必须从最短那一档重新开始（不是接着 7 往上加）
const after = nextDmBackoff(resetDmBackoff(), 'boom', 9_000_000)
ok(near(after.waitMs / M, 2), '复位后第一次出错一律 2 分钟，实际 ' + after.waitMs / M)
const afterRate = nextDmBackoff(resetDmBackoff(), 'HTTP 200 code=-509', 9_000_000)
ok(near(afterRate.waitMs / M, 2), '复位后第一次限流应该 2 分钟，实际 ' + afterRate.waitMs / M)

// ④ 网络类封顶短
let net = emptyDmBackoff()
let nw = 0
for (let i = 0; i < 7; i++) { const r = nextDmBackoff(net, 'fetch failed', 1_000_000 + i); net = r.state; nw = r.waitMs / M }
ok(nw <= 10, '网络类封顶 10 分钟，实际 ' + nw)
ok(classifyDmError('fetch failed') === 'network', 'fetch failed 应该归网络')
ok(classifyDmError('HTTP 200 code=-509 msg=请求过于频繁') === 'rate', '-509 应该归限流')
ok(classifyDmError('Cannot read properties of undefined') === 'other', '代码错误归 other')
ok(classifyDmError('') === 'other', '空消息不许崩')

// ⑤ 连败到 6 次才记账，且 6 小时内不重复
let a = emptyDmBackoff()
const alarms = []
let at = 20_000_000
for (let i = 0; i < 9; i++) {
  const r = nextDmBackoff(a, 'HTTP 200 code=-509', at)
  a = r.state
  if (r.alarm) alarms.push(r.fails)
  at += r.waitMs
}
ok(alarms.length === 1 && alarms[0] === 6, '第一次该在第 6 次失败时报，实际 ' + JSON.stringify(alarms))
// 6 小时后再失败 ⇒ 再报一次
const later = at + 6 * 3600_000
const r10 = nextDmBackoff(a, 'HTTP 200 code=-509', later)
ok(r10.alarm === true, '6 小时后还在败，应该再记一条账')

// ⑥ 账单是一行、带日期和退避分钟、不带换行
const line = dmAlarmLine({ fails: 6, kind: 'rate', until: later + 30 * M, lastErr: 'HTTP 200 code=-509\nmsg=请求过于频繁' }, new Date(later))
ok(line.startsWith('- [ ] 私信监听连续 6 次失败'), '账单开头不对：' + line.slice(0, 30))
ok(!line.includes('\n'), '账单里不许有换行')
ok(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(line), '账单里要有日期时间：' + line)
ok(/退避到 \d+ 分钟后/.test(line), '账单里要有退避多久：' + line)

// ⑦ 默认参数没被偷偷改
ok(DM_BACKOFF.baseMs === 2 * M && DM_BACKOFF.maxMs === 30 * M && DM_BACKOFF.alarmAfter === 6, '默认参数被改了')

console.log(`dm-backoff 单测：${pass} 条通过，${fails.length} 条失败`)
if (fails.length) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1) }
