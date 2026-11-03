#!/usr/bin/env node
/**
 * lib/window-plan.mjs 的单测 —— 这份文件在 shenjing/patches/ 里（进备份），
 * 被测的那份在 node_modules 里（会被升级抹掉）。抹掉了先跑 apply-patches.mjs。
 *
 * 判据是这几条里最要紧的（2026-11-02 那两天的形状）：
 *   一轮 code=1 之后，账本不许说"这班跑过了" —— 它得说"我还没成，我还会再来"。
 */

import { planWindow, DEFAULT_MAX_ATTEMPTS } from '/root/.dsh/profiles/web/node_modules/dsh-bili-scroll/lib/window-plan.mjs'

const KEY = '2026-11-03:night'
const T0 = Date.parse('2026-11-03T00:00:00+08:00')
const MIN = 60 * 1000

let pass = 0
let fail = 0
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name) } catch (e) { fail++; console.log('  ✗ ' + name + ' — ' + e.message) }
}
function eq(a, b, what) {
  const A = JSON.stringify(a), B = JSON.stringify(b)
  if (A !== B) throw new Error(`${what || ''} 期望 ${B}，实际 ${A}`)
}

console.log('window-plan：')

t('第一次：跑', () => {
  const p = planWindow({}, KEY, new Date(T0))
  eq([p.run, p.reason, p.attempt], [true, 'first', 1])
})

t('已经跑成了：不再跑', () => {
  const p = planWindow({ windows: { [KEY]: true } }, KEY, new Date(T0))
  eq([p.run, p.reason], [false, 'done'])
})

t('失败一次、5 分钟前：冷却，先别烧第二轮', () => {
  const p = planWindow({ windowAttempts: { [KEY]: 1 }, windowLastTry: { [KEY]: T0 - 5 * MIN } }, KEY, new Date(T0))
  eq([p.run, p.reason], [false, 'cooldown'])
})

t('失败一次、11 分钟前：重试（这一条原来根本不存在）', () => {
  const p = planWindow({ windowAttempts: { [KEY]: 1 }, windowLastTry: { [KEY]: T0 - 11 * MIN } }, KEY, new Date(T0))
  eq([p.run, p.reason, p.attempt], [true, 'retry', 2])
})

t('冷却边界：差 1 秒还是要等', () => {
  const p = planWindow({ windowAttempts: { [KEY]: 1 }, windowLastTry: { [KEY]: T0 - (10 * MIN - 1000) } }, KEY, new Date(T0))
  eq(p.run, false)
})

t('失败三次：今天不试了，并且要说出来', () => {
  const p = planWindow({ windowAttempts: { [KEY]: 3 } }, KEY, new Date(T0))
  eq([p.run, p.reason], [false, 'exhausted'])
  if (!p.say || !p.say.includes('不试了')) throw new Error('say 里没说不试了：' + p.say)
})

t('已经说过一次的话不再说（日志里重复的话就是噪音）', () => {
  const p = planWindow({ windowAttempts: { [KEY]: 3 }, windowSaid: { [KEY]: true } }, KEY, new Date(T0))
  eq(p.say, '')
})

t('失败照旧算次数：DEFAULT_MAX_ATTEMPTS 是 3', () => {
  eq(DEFAULT_MAX_ATTEMPTS, 3)
})

t('state 整个是空的也能判断（别炸）', () => {
  eq(planWindow(undefined, KEY, T0).run, true)
})

t('now 传数字也行', () => {
  eq(planWindow({}, KEY, T0).run, true)
})

t('别的班失败，不影响这一班', () => {
  const p = planWindow({ windowAttempts: { '2026-11-03:noon': 3 } }, KEY, new Date(T0))
  eq([p.run, p.reason], [true, 'first'])
})

t('冷却时间可调（给测试和以后留口子）', () => {
  const st = { windowAttempts: { [KEY]: 1 }, windowLastTry: { [KEY]: T0 - 3 * MIN } }
  eq(planWindow(st, KEY, new Date(T0), { cooldownMs: 2 * MIN }).run, true)
})

console.log(`\n${pass} 过 / ${fail} 没过`)
process.exit(fail ? 1 : 0)
