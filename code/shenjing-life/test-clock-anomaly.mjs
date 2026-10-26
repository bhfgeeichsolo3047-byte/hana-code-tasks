// test-clock-anomaly.mjs —— 闹钟异常检查的用例（含反例）
// 2026-10-26 加：起因是 13:20 报了一次假（noon 其实响了，只是日志那行没落下来）
import { clockAnomalies } from './lib/state.mjs'

const entries = [{ id: 'noon', when: '13:00', kind: 'clock', enabled: true }]
const at = (h, m) => new Date(2026, 9, 26, h, m)          // 2026-10-26
const log17 = [{ trigger: 'clock:noon@13:00', at: '2026-10-26T13:17+08:00' }]

const cases = [
  ['① 账本说响过、日志丢行 → 不报（这就是 13:20 那次误报的场景）',
    clockAnomalies(entries, at(13, 25), [], { lastFired: { noon: '2026-10-26T13:00+08:00' } }), 0],
  ['② 两个证据源都没有 → 报 missing',
    clockAnomalies(entries, at(13, 25), [], { lastFired: {} }), 1],
  ['③ 账本记的是昨天 → 今天照样算没响',
    clockAnomalies(entries, at(13, 25), [], { lastFired: { noon: '2026-10-25T13:00+08:00' } }), 1],
  ['④ 日志有但晚了 17 分钟 → 报 late（宽限 20 分内不算）',
    clockAnomalies(entries, at(14, 0), log17, { lastFired: {} }), 0],
  ['⑤ 晚了 29 分钟 → late',
    clockAnomalies(entries, at(14, 0), [{ trigger: 'clock:noon@13:00', at: '2026-10-26T13:29+08:00' }], { lastFired: {} }), 1],
  ['⑥ 刚过点 5 分钟（没到宽限）→ 不报',
    clockAnomalies(entries, at(13, 5), [], { lastFired: {} }), 0],
  ['⑦ 日志有记录 → 不报',
    clockAnomalies(entries, at(13, 25), [{ trigger: 'clock:noon@13:00', at: '2026-10-26T13:01+08:00' }], { lastFired: {} }), 0],
]

let bad = 0
for (const [name, got, want] of cases) {
  const ok = got.length === want
  if (!ok) bad++
  console.log((ok ? '✅' : '❌') + ' ' + name + '  → ' + got.length + ' 条' + (ok ? '' : '（期望 ' + want + '）') + ' ' + JSON.stringify(got))
}
console.log(bad ? '\n✗ 有 ' + bad + ' 条不对' : '\n✓ 全过')
process.exit(bad ? 1 : 0)
