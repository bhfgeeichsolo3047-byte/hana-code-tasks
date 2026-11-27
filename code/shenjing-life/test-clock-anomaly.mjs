// test-clock-anomaly.mjs —— 闹钟异常检查的用例（含反例）
// 2026-10-26 加：起因是 13:20 报了一次假（noon 其实响了，只是日志那行没落下来）
// 2026-11-28 加：三种 cause（downtime / host-down / timer）和它们的措辞；
//   顺带修 ①②④⑦ 一直红着的老毛病 —— 那四条里的时间写成字面量 `+08:00`，
//   这台机器现在是 JST(+09)，同一条日志被算成"晚 60 分钟"，于是它们在这台机器上从来没绿过。
//   现在构造字面量时用本机时区，跨时区也不会自己变红。
import { clockAnomalies, clockAnomalyLine } from './lib/state.mjs'

const entries = [{ id: 'noon', when: '13:00', kind: 'clock', enabled: true }]
const at = (h, m, d = 26, mo = 9) => new Date(2026, mo, d, h, m)   // 默认 2026-10-26，本机时区
/** 和 at() 同一个时区的 ISO 字符串（别把 +08:00 写死） */
const iso = (date) => {
  const p = (n) => String(n).padStart(2, '0')
  const off = -date.getTimezoneOffset()
  const sgn = off >= 0 ? '+' : '-'
  return date.getFullYear() + '-' + p(date.getMonth() + 1) + '-' + p(date.getDate()) +
    'T' + p(date.getHours()) + ':' + p(date.getMinutes()) +
    sgn + p(Math.floor(Math.abs(off) / 60)) + ':' + p(Math.abs(off) % 60)
}
const logAt = (h, m) => [{ trigger: 'clock:noon@13:00', at: iso(at(h, m)) }]

const cases = [
  ['① 账本说响过、日志丢行 → 不报（这就是 13:20 那次误报的场景）',
    clockAnomalies(entries, at(13, 25), [], { lastFired: { noon: iso(at(13, 0)) } }), 0],
  ['② 两个证据源都没有 → 报 missing',
    clockAnomalies(entries, at(13, 25), [], { lastFired: {} }), 1],
  ['③ 账本记的是昨天 → 今天照样算没响',
    clockAnomalies(entries, at(13, 25), [], { lastFired: { noon: iso(new Date(2026, 9, 25, 13, 0)) } }), 1],
  ['④ 日志有但晚了 17 分钟 → 报 late（宽限 20 分内不算）',
    clockAnomalies(entries, at(14, 0), logAt(13, 17), { lastFired: {} }), 0],
  ['⑤ 晚了 29 分钟 → late',
    clockAnomalies(entries, at(14, 0), logAt(13, 29), { lastFired: {} }), 1],
  ['⑥ 刚过点 5 分钟（没到宽限）→ 不报',
    clockAnomalies(entries, at(13, 5), [], { lastFired: {} }), 0],
  ['⑦ 日志有记录 → 不报',
    clockAnomalies(entries, at(13, 25), logAt(13, 1), { lastFired: {} }), 0],
]

let bad = 0
for (const [name, got, want] of cases) {
  const ok = got.length === want
  if (!ok) bad++
  console.log((ok ? '✅' : '❌') + ' ' + name + '  → ' + got.length + ' 条' + (ok ? '' : '（期望 ' + want + '）') + ' ' + JSON.stringify(got))
}

/* ── 三种病要分得开（2026-11-28） ──────────────────────────────────────────
 * 反例也在：宿主早于到点就起着、机器一直在开，就必须还是 timer，不许被「宿主没跑」那套解释吞掉。
 * ⑫ 用的是 11-27 那天的真样本：到点 08:00，宿主 12:34 才起，机器 11-26 16:05 开过机。 */
const caused = (opts, now = at(15, 0)) => clockAnomalies(entries, now, [], { lastFired: {}, ...opts })
const line = (a, n = at(15, 0)) => clockAnomalyLine(a, n)

const cases2 = [
  ['⑧ 宿主 13:40 才起、机器一直开着 → host-down，措辞点出「宿主 13:40 才起来」',
    caused({ hostStartedAt: at(13, 40).getTime(), machineOnSince: at(9, 0, 25).getTime() }),
    (a) => a.cause === 'host-down' && /宿主 13:40 才起来/.test(line(a)) && !/机器没开着/.test(line(a))],
  ['⑨ 到点那会儿机器没开（14:30 才开机）→ downtime',
    caused({ hostStartedAt: at(14, 32).getTime(), machineOnSince: at(14, 30).getTime() }),
    (a) => a.cause === 'downtime' && /机器没开着（开机 14:30）/.test(line(a))],
  ['⑩ 宿主 06:00 就在跑、机器也开着 → 还是 timer（反例：不许被「宿主没跑」解释掉）',
    caused({ hostStartedAt: at(6, 0).getTime(), machineOnSince: at(9, 0, 20).getTime() }),
    (a) => a.cause === 'timer' && /唤醒这一步没留下记录/.test(line(a))],
  ['⑪ 两个事实都没给（老调用方）→ 退成 timer，不抛错',
    caused({}), (a) => a.cause === 'timer' && typeof line(a) === 'string'],
  ['⑫ 11-27 真样本：到点 08:00、宿主 12:34 起 → host-down、分钟数 278',
    clockAnomalies([{ id: 'morning', when: '08:00', kind: 'clock', enabled: true }],
      at(12, 38, 27, 10), [],
      { lastFired: {}, hostStartedAt: at(12, 34, 27, 10).getTime(), machineOnSince: at(16, 5, 26, 9).getTime() }),
    (a) => a.cause === 'host-down' && /到点 278 分钟/.test(line(a, at(12, 38, 27, 10)))],
]

for (const [name, got, check] of cases2) {
  const a = got[0]
  const ok = got.length === 1 && !!a && check(a)
  if (!ok) bad++
  console.log((ok ? '✅' : '❌') + ' ' + name + (ok ? '' : '  → ' + JSON.stringify(got) + (a ? '\n   行：' + line(a) : '')))
}

console.log(bad ? '\n✗ 有 ' + bad + ' 条不对' : '\n✓ 全过')
process.exit(bad ? 1 : 0)
