#!/usr/bin/env node
/**
 * windowKeyFor / pruneWindows 的单测（2026-11-09 13:00）。
 *
 * 要证的事只有一件：**一「夜」只有一班，而且它落在晚上**。
 *   原来按开跑那一刻的日历日记账 ⇒ 00:00 那一跳把「今天:night」记成 done，
 *   吃的是昨天剩下的内容；当晚 18:00 看见「今天夜班已完成」直接跳过。
 *   duty.log 里 11-05 到 11-09 九天全是 00:0x 开跑，账本上却看不出缺了哪一班。
 *
 * 被测的那份在 node_modules 里（升级会抹掉）。抹掉了先跑 tools/apply-patches.mjs。
 */

import { planWindow, windowKeyFor, pruneWindows } from '/root/.dsh/profiles/web/node_modules/dsh-bili-scroll/lib/window-plan.mjs'

const NIGHT = { label: '晚上/夜间谷时', start: '18:00', end: '09:00' }
const NOON = { label: '中午谷时', start: '12:00', end: '14:00' }

let pass = 0
let fail = 0
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name) } catch (e) { fail++; console.log('  ✗ ' + name + ' — ' + e.message) }
}
function eq(a, b, what) {
  const A = JSON.stringify(a), B = JSON.stringify(b)
  if (A !== B) throw new Error(`${what || ''} 期望 ${B}，实际 ${A}`)
}
const at = (s) => new Date(s)

console.log('window-key：')

t('夜里 00:00 那一跳算前一天那一夜', () => {
  eq(windowKeyFor('night', NIGHT, at('2026-11-09T00:00:00')), '2026-11-08:night')
})

t('00:02 也一样（原来就是这一跳把账写成"今天跑过了"）', () => {
  eq(windowKeyFor('night', NIGHT, at('2026-11-09T00:02:00')), '2026-11-08:night')
})

t('天亮前最后一分钟还是前一夜', () => {
  eq(windowKeyFor('night', NIGHT, at('2026-11-09T08:59:00')), '2026-11-08:night')
})

t('09:00 以后就不是"昨夜"了（窗口外，顺手定住边界）', () => {
  eq(windowKeyFor('night', NIGHT, at('2026-11-09T09:00:00')), '2026-11-09:night')
})

t('晚上 18:30 是当天这一夜', () => {
  eq(windowKeyFor('night', NIGHT, at('2026-11-09T18:30:00')), '2026-11-09:night')
})

t('23:59 还是当天', () => {
  eq(windowKeyFor('night', NIGHT, at('2026-11-09T23:59:00')), '2026-11-09:night')
})

t('中午班不跨零点：就当天', () => {
  eq(windowKeyFor('noon', NOON, at('2026-11-09T12:00:00')), '2026-11-09:noon')
  eq(windowKeyFor('noon', NOON, at('2026-11-09T13:59:00')), '2026-11-09:noon')
})

t('周末早上 10:00 落在窗口里也算当天（不跨零点就不改日期）', () => {
  eq(windowKeyFor('noon', NOON, at('2026-11-07T10:00:00')), '2026-11-07:noon')
})

t('数字时间戳也吃', () => {
  eq(windowKeyFor('night', NIGHT, at('2026-11-09T00:30:00').getTime()), '2026-11-08:night')
})

t('窗口配置坏了就退到当天，不炸', () => {
  eq(windowKeyFor('night', {}, at('2026-11-09T00:30:00')), '2026-11-09:night')
  eq(windowKeyFor('night', undefined, at('2026-11-09T00:30:00')), '2026-11-09:night')
})

t('跨月：11-01 凌晨算 10-31 那一夜', () => {
  eq(windowKeyFor('night', NIGHT, at('2026-11-01T00:10:00')), '2026-10-31:night')
})

// ── 天翻页只剪不擦 ─────────────────────────────────────────────
t('清账留下最近几天，旧的丢掉', () => {
  const w = {
    '2026-11-05:night': true,
    '2026-11-08:night': true,
    '2026-11-09:noon': true,
  }
  eq(pruneWindows(w, '2026-11-09', 3), { '2026-11-08:night': true, '2026-11-09:noon': true })
})

t('清账不会把昨晚那班抹掉（这一条就是原来被抹的那一格）', () => {
  const w = pruneWindows({ '2026-11-08:night': true }, '2026-11-09')
  eq(w['2026-11-08:night'], true)
})

t('不认识的键丢掉，空对象也不炸', () => {
  eq(pruneWindows({ garbage: true, 'x:y': 1 }, '2026-11-09'), {})
  eq(pruneWindows(null, '2026-11-09'), {})
  eq(pruneWindows(undefined, '2026-11-09'), {})
})

// ── 一条时间线：这才是我要的形状 ─────────────────────────────────
t('时间线：晚上跑过 ⇒ 凌晨不再跑 ⇒ 第二天晚上再跑', () => {
  // 11-08 18:30 跑成
  const evening = at('2026-11-08T18:30:00')
  const k1 = windowKeyFor('night', NIGHT, evening)
  eq(k1, '2026-11-08:night')
  let st = { windows: { [k1]: true }, day: '2026-11-08' }

  // 11-09 00:00 天翻页（只剪不擦）+ 这一跳
  st = { ...st, day: '2026-11-09', windows: pruneWindows(st.windows, '2026-11-09') }
  const midnight = at('2026-11-09T00:00:00')
  const k2 = windowKeyFor('night', NIGHT, midnight)
  eq(k2, '2026-11-08:night', '凌晨那跳的键')
  eq(planWindow(st, k2, midnight).reason, 'done', '01 凌晨不该再跑一班')

  // 11-09 18:00 当晚那一班：键是新的，要跑
  const nextEvening = at('2026-11-09T18:00:00')
  const k3 = windowKeyFor('night', NIGHT, nextEvening)
  eq(k3, '2026-11-09:night')
  eq(planWindow(st, k3, nextEvening).run, true, '02 当晚这一班必须跑')
})

t('时间线：晚上错过 ⇒ 凌晨补跑，但它算前一夜、不占第二天', () => {
  // 11-08 晚上没跑成（宿主睡着），账上只有中午那班
  let st = { day: '2026-11-09', windows: pruneWindows({ '2026-11-08:noon': true }, '2026-11-09') }
  const midnight = at('2026-11-09T00:20:00')
  const k = windowKeyFor('night', NIGHT, midnight)
  eq(planWindow(st, k, midnight).run, true, '03 补跑要能跑起来')
  // 补跑记账
  st = { ...st, windows: { ...st.windows, [k]: true } }
  // 同一夜 08:00 再跳一次：不许再来一遍
  const dawn = at('2026-11-09T08:00:00')
  eq(planWindow(st, windowKeyFor('night', NIGHT, dawn), dawn).reason, 'done', '04 同一夜不许跑第二遍')
  // 当天 18:00（新的一夜）：仍然要跑
  const evening = at('2026-11-09T18:00:00')
  eq(planWindow(st, windowKeyFor('night', NIGHT, evening), evening).run, true, '05 新一夜照跑')
})

console.log(`\n${pass} 过 / ${fail} 没过`)
process.exit(fail ? 1 : 0)
