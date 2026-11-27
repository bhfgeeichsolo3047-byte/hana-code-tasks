#!/usr/bin/env node
/**
 * 单测：复核的候选挑选（2026-11-25 21:30）
 *   只测纯函数，不联网、不碰真实账本。
 * 用法：node test-verify-candidates.mjs [/path/to/lib/verify.mjs]
 *   不传路径就测 web profile 里装着的那份（也就是补丁生效后的那份）。
 */
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const target = process.argv[2] || '/root/.dsh/profiles/web/node_modules/dsh-bili-scroll/lib/verify.mjs'
const m = await import(pathToFileURL(target).href)
const { parseComments, seenRowsMissingRpid, pickFresh, VERIFY_EXPIRY_MS, VERIFY_RETRY_MS } = m

let pass = 0
const t = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name) }
const H = 3600 * 1000
const now = new Date('2026-11-25 21:30:00').getTime()

t('台账行解析出真 rpid 和时间', () => {
  const rows = parseComments([
    '# 不是行',
    '| 2026-11-25 | BV1wSyZzcEax | 标题 | UP | 评论 |',
    '- 2026-11-25 12:01 BV1wSyZzcEax rpid=321247530017 · 78层折成106层，第二遍直接借第一遍的KV缓存',
  ].join('\n'))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].rpid, 321247530017)
  assert.equal(rows[0].bv, 'BV1wSyZzcEax')
  assert.equal(rows[0].at, new Date('2026-11-25 12:01:00').getTime())
})

t('判重表里六位 rpid 的评论行数得出来（正是 11-25 12:01 那种）', () => {
  const bad = seenRowsMissingRpid([
    '| 2026-11-25 | BV1wSyZzcEax | GLM-5.4 （rpid=321247 | 过拟合青年 | 评论 |',
    '| 2026-11-25 | BV1QCWo6kERL | 盒子姬 （rpid=321275687649，2026-11-25） | 盒子姬 | 评论 |',
    '| 2026-11-25 | BV1444B6pE71 | 被几百条评论纠正后 | 毕的二阶导 | 挑了 |',
    '| 2026-11-25 | BV1fZ4G6KEpx | 400 亿 Token | 哈基Wii | 跳过 |',
  ].join('\n'))
  assert.equal(bad.length, 1)
  assert.match(bad[0], /rpid=321247(?!\d)/)
})

t('发出去超过 24h 还从没查到过 ⇒ 放弃，不再当选候选', () => {
  const { fresh, gaveUp } = pickFresh(
    [{ bv: 'BV1yNxM6wEiP', rpid: 319627087425, at: now - 30 * H }], {}, now)
  assert.equal(fresh.length, 0)
  assert.equal(gaveUp.length, 1)
})

t('刚发出去几小时的 ⇒ 进候选', () => {
  const { fresh } = pickFresh([{ bv: 'BV1QCWo6kERL', rpid: 321275687649, at: now - 3 * H }], {}, now)
  assert.equal(fresh.length, 1)
})

t('24h 内 null：6h 内不重查，超过 6h 才再看一眼', () => {
  const row = { bv: 'BV1a', rpid: 111111111111, at: now - 3 * H }
  const state = { '111111111111': { visible: null, at: now - 2 * H } }
  assert.equal(pickFresh([row], state, now).fresh.length, 0)
  assert.equal(pickFresh([row], { '111111111111': { visible: null, at: now - 7 * H } }, now).fresh.length, 1)
})

t('确认可见过的不再重查；记过放弃的也不再重查', () => {
  const row = { bv: 'BV1b', rpid: 222222222222, at: now - 2 * H }
  assert.equal(pickFresh([row], { '222222222222': { visible: true, at: now - 2 * H } }, now).fresh.length, 0)
  assert.equal(pickFresh([row], { '222222222222': { visible: null, gaveUp: true, at: now - 2 * H } }, now).fresh.length, 0)
})

t('同一个 rpid 出现两次只算一条', () => {
  const row = { bv: 'BV1c', rpid: 333333333333, at: now - 1 * H }
  assert.equal(pickFresh([row, { ...row }], {}, now).fresh.length, 1)
})

t('max 封顶', () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({ bv: 'BV1d' + i, rpid: 400000000000 + i, at: now - 1 * H }))
  assert.equal(pickFresh(rows, {}, now, { max: 6 }).fresh.length, 6)
})

t('放弃是单向的：第二轮不再把它当候选、也不重复记', () => {
  const row = { bv: 'BV1e', rpid: 555555555555, at: now - 30 * H }
  const r1 = pickFresh([row], {}, now)
  assert.equal(r1.gaveUp.length, 1)
  const state = {}
  for (const r of r1.gaveUp) state[String(r.rpid)] = { visible: null, gaveUp: true, at: now, bv: r.bv }
  const r2 = pickFresh([row], state, now + 12 * H)
  assert.equal(r2.gaveUp.length, 0)
  assert.equal(r2.fresh.length, 0)
})

console.log(`\n${pass} 条全过`)
