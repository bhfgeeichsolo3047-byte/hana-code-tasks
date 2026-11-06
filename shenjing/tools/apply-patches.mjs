#!/usr/bin/env node
/**
 * 把我的补丁装回 node_modules —— 一次装，之后每次醒来都靠体检盯着。
 *
 * 为什么要有这个脚本（2026-11-03 08:00）：
 *   11-02 我改的是 `profiles/web/node_modules/dsh-bili-scroll/index.js` 本身。
 *   11-03 凌晨 01:44 插件自动升到 2.4.0，整个目录被换掉，我三处改动一句不剩，
 *   连 lib/state.mjs 都退回原版。而升级不会告诉任何人「你的补丁没了」。
 *   ⇒ node_modules 里的东西不是我的：**升级会抹掉它，抹得很安静。**
 *
 * 所以补丁的真相放在 shenjing/patches/<插件>/ 里（这个目录进备份、进体检），
 * node_modules 只是它的安装位置。抹掉了就再装一次；装不上就大声退出。
 *
 * 用法：
 *   node shenjing/tools/apply-patches.mjs            # 装所有缺的补丁
 *   node shenjing/tools/apply-patches.mjs --check    # 只查不装（体检风格：缺了就 exit 2）
 *   node shenjing/tools/apply-patches.mjs --force    # 已经装过也重装（改补丁后调试用）
 *
 * 退出码：0 都装好了 / 2 有补丁没装上（锚点没了或插件不在）/ 3 只有 --check 且缺
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const ARCHIVE = resolve(HERE, '..')
const PATCH_ROOT = join(ARCHIVE, 'patches')
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const ARGS = process.argv.slice(2)
const CHECK_ONLY = ARGS.includes('--check')
const FORCE = ARGS.includes('--force')

function findPluginDir(name) {
  // 优先 web profile；找不到就扫所有 profile（路径会变，别写死一条）
  const cands = [
    join(DSH_HOME, 'profiles', 'web', 'node_modules', name),
    join(DSH_HOME, 'profiles', 'desktop', 'node_modules', name),
    join(DSH_HOME, 'profiles', 'headless', 'node_modules', name),
  ]
  for (const c of cands) if (existsSync(join(c, 'package.json'))) return c
  return null
}

function lines(text) {
  return text.split('\n')
}

function findUnique(ls, needle, what, file) {
  const hits = []
  for (let i = 0; i < ls.length; i++) if (ls[i].includes(needle)) hits.push(i)
  if (hits.length === 0) throw new Error(`锚点没了：${file} 里找不到「${needle}」（上游改过这段？）`)
  if (hits.length > 1) throw new Error(`锚点不唯一：${file} 里有 ${hits.length} 处「${needle}」`)
  return hits[0]
}

function applyEdit(pluginDir, e) {
  const path = join(pluginDir, e.file)
  const raw = readFileSync(path, 'utf8')
  const ls = lines(raw)
  // ⚠️ 2026-11-03：这个插件的源码是 CRLF（Windows 上写的）。我第一次装补丁时插入的行是 LF，
  //   同一个文件里混着两种换行——JS 不care，但下次 diff 会一片红，看得人以为是坏掉了。
  //   ⇒ 跟文件自己的换行走：文件用 CRLF，插进去的行也带 \r。
  const eol = ls.some((l) => l.endsWith('\r')) ? '\r' : ''
  const fix = (arr) => arr.map((l) => (eol && !l.endsWith('\r') ? l + eol : l))
  if (e.mode === 'replaceLine') {
    e = { ...e, newText: e.newText.split('\n').map((l) => (eol && !l.endsWith('\r') ? l + eol : l)).join('\n') }
  } else if (e.mode === 'replaceBlock') {
    e = { ...e, newLines: fix(e.newLines) }
  } else if (e.mode === 'insertAfter' || e.mode === 'insertBefore') {
    e = { ...e, insertLines: fix(e.insertLines) }
  }
  if (e.mode === 'replaceLine') {
    const i = findUnique(ls, e.contains, 'line', e.file)
    ls[i] = e.newText
  } else if (e.mode === 'replaceBlock') {
    const a = findUnique(ls, e.firstContains, 'first', e.file)
    let b = -1
    for (let i = a; i < Math.min(a + 40, ls.length); i++) if (ls[i].includes(e.lastContains)) { b = i; break }
    if (b < 0) throw new Error(`块尾没了：${e.file} 里「${e.firstContains}」之后 40 行内找不到「${e.lastContains}」`)
    if (e.keepLastLine) ls.splice(a, b - a, ...e.newLines)
    else ls.splice(a, b - a + 1, ...e.newLines)
  } else if (e.mode === 'insertAfter') {
    const i = findUnique(ls, e.contains, 'ins', e.file)
    ls.splice(i + 1, 0, ...e.insertLines)
  } else if (e.mode === 'insertBefore') {
    const i = findUnique(ls, e.contains, 'ins', e.file)
    ls.splice(i, 0, ...e.insertLines)
  } else if (e.mode === 'wrapLine') {
    const i = findUnique(ls, e.contains, 'wrap', e.file)
    const line = ls[i]
    const m = line.match(/^(\s*)/)
    const indent = m ? m[1] : ''
    // ⚠️ 2026-11-06：CRLF 文件里这一行末尾带 \r，直接拼 post 会变成 `…UID')\r }`
    //    （一行里混进一个回车，跑起来没事，diff 一片红）。把 \r 摘下来放回行尾。
    const tailCr = line.endsWith('\r') ? '\r' : ''
    const body = tailCr ? line.slice(0, -1) : line
    ls[i] = indent + e.pre + body.slice(indent.length) + e.post + tailCr
  } else {
    throw new Error(`不认识的 mode: ${e.mode}`)
  }
  writeFileSync(path, ls.join('\n'), 'utf8')
}

function missingMarkers(pluginDir, patch) {
  const miss = []
  for (const m of patch.markers || []) {
    const p = join(pluginDir, m.file)
    let text = ''
    try { text = readFileSync(p, 'utf8') } catch { miss.push(`${m.file}（整个文件不在）`); continue }
    for (const needle of m.must) if (!text.includes(needle)) miss.push({ file: m.file, needle })
  }
  return miss
}

function syntaxOk(pluginDir, file) {
  const src = join(pluginDir, file)
  const tmp = join(tmpdir(), `shenjing-patchcheck-${Date.now()}-${file.replace(/[\/]/g, '_')}.mjs`)
  copyFileSync(src, tmp)
  try {
    execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' })
    return { ok: true }
  } catch (err) {
    return { ok: false, detail: String(err.stderr || err.message).split('\n').slice(0, 6).join('\n') }
  }
}

let failed = 0
let installed = 0
let already = 0

const dirs = existsSync(PATCH_ROOT)
  ? execFileSync('ls', [PATCH_ROOT], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
  : []

if (!dirs.length) {
  console.log('patches/ 是空的 —— 没有补丁要装。')
  process.exit(0)
}

for (const id of dirs) {
  const pdir = join(PATCH_ROOT, id)
  const manifestPath = join(pdir, 'patch.json')
  if (!existsSync(manifestPath)) continue
  const patch = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const pluginDir = findPluginDir(patch.plugin || id)

  console.log(`\n== ${id}`)
  if (!pluginDir) {
    console.log(`  ✗ 找不到插件 ${patch.plugin}（没装？路径变了？）— 补丁无处可装`)
    failed++
    continue
  }
  let ver = '?'
  try { ver = JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8')).version } catch { /* 无所谓 */ }
  console.log(`  插件在 ${pluginDir}（版本 ${ver}，补丁针对 ${patch.targetVersion || '?'}）`)

  const miss = missingMarkers(pluginDir, patch)
  if (!miss.length && !FORCE) {
    console.log('  ✓ 已经在位，什么都不用做')
    already++
    continue
  }
  if (!miss.length && FORCE) console.log('  --force：重装一遍（锚点可能已经不存在，会报错）')

  if (miss.length) console.log(`  缺 ${miss.length} 个记号：` + miss.map((m) => (typeof m === 'string' ? m : `${m.file}:${m.needle}`)).join('、'))
  if (CHECK_ONLY) { console.log('  --check：只查不装'); failed++; continue }

  try {
    for (const c of patch.copy || []) {
      const from = join(pdir, c.from)
      const to = join(pluginDir, c.to)
      mkdirSync(dirname(to), { recursive: true })
      copyFileSync(from, to)
      console.log(`  + 放进 ${c.to}`)
    }
    for (const e of patch.edits || []) { applyEdit(pluginDir, e); console.log(`  ~ 改了 ${e.file}（${e.mode}）`) }
  } catch (err) {
    console.log(`  ✗ 装不上：${err.message}`)
    console.log('    → 上游那段改了。别硬来：先看新版是不是已经自己修了，再决定补丁还要不要。')
    failed++
    continue
  }

  const stillMiss = missingMarkers(pluginDir, patch)
  if (stillMiss.length) {
    console.log('  ✗ 改完了记号还是缺：' + stillMiss.map((m) => (typeof m === 'string' ? m : `${m.file}:${m.needle}`)).join('、'))
    failed++
    continue
  }
  const bad = (patch.edits || []).map((e) => e.file)
    .filter((f, i, a) => a.indexOf(f) === i)
    .map((f) => ({ f, r: syntaxOk(pluginDir, f) }))
    .find((x) => !x.r.ok)
  if (bad) {
    console.log(`  ✗ 装上了但语法不过（${bad.f}）—— 宿主会起不来，别重启：\n${bad.r.detail}`)
    failed++
    continue
  }
  console.log('  ✓ 装好了，语法检查过')
  installed++
}

console.log(`\n合计：装上 ${installed}、本来就在 ${already}、没装成 ${failed}`)
if (failed) process.exit(2)
process.exit(0)
