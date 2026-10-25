/**
 * selfcheck.mjs —— 插件的"预检"：**在假 ctx 上真跑一遍 apply()**，不靠"重启一次才知道错哪"
 * ============================================================================
 * 为什么非要有它（bili-scroll 2026-10-14 连栽两次，都是重启后翻日志才发现）：
 *   ① config 的字段值是对象 ⇒ 定时器里 TypeError ⇒ **把整个 dsh 带走**；
 *   ② 工具的 parameters 写成了一份"完整 JSON Schema"（宿主那条路要的是**逐属性的隐含对象**）
 *      ⇒ defineTool 抛 JsonSchemaError ⇒ **插件整条不激活**。
 *
 * 这份自检**不碰真家目录**：家指到 /tmp 沙箱，书桌（档案）也指到沙箱，
 * 连那一轮 headless 都用 /tmp 下的假 dsh（所以它真的 spawn、真的写文件，但不会花一个 token）。
 *
 * 跑法：  cd <插件目录> && node selfcheck.mjs
 * 退出码： 0 = 全过；1 = 有断言没过
 *
 * ⚠️ 拼"假 dsh 的源码"时换行一律用 String.fromCharCode(10) 拼，不要在字符串里写转义换行
 *    —— 第一次就是那么写的：假 dsh 自己语法错、exit 1，白查了一轮。
 * ============================================================================
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const NL = String.fromCharCode(10)
const SANDBOX = join(tmpdir(), 'dsh-shenjing-life-selfcheck')
const HOME = join(SANDBOX, 'home')
const ARCHIVE = join(SANDBOX, 'archive')
const FAKE_DSH = join(SANDBOX, 'fake-dsh-bin.js')

let passed = 0
const fails = []
const ok = (cond, label, extra = '') => {
  if (cond) { passed++; console.log('  ✓ ' + label) }
  else { fails.push(label); console.log('  ✗ ' + label + (extra ? '  → ' + extra : '')) }
}
const head = (t) => console.log(NL + t)

/* ── 0. 沙箱 ─────────────────────────────────────────────────────────────── */
try { rmSync(SANDBOX, { recursive: true, force: true }) } catch { /* 清不掉就留着 */ }
mkdirSync(HOME, { recursive: true })
mkdirSync(ARCHIVE, { recursive: true })
mkdirSync(join(ARCHIVE, 'journal'), { recursive: true })
// 先摆 4 天日记（packet 只该取**最近三天**）—— 日期用当年，避开"固定写 2099，到了那天就不对"
const YR = new Date().getFullYear()
for (const [d, txt] of [['01-01', '第一天'], ['01-02', '第二天'], ['01-03', '第三天'], ['01-04', '第四天']]) {
  writeFileSync(join(ARCHIVE, 'journal', YR + '-' + d + '.md'), '（自检摆的）' + txt + NL, 'utf8')
}

// 假 dsh：被 spawn 起来之后把命令行记下来；有没有"活动"看沙箱里有没有旗标文件。
// ⚠️ 家目录以插件传进来的 SHENJING_LIFE_HOME 为准（第一版自检自己拼路径，错了一层，白查一轮）
const fakeSrc = [
  '// 自检用的假 dsh：不是真的 headless 会话，只用来把 spawn -> 退出 -> 结算 这条路走完',
  'import { appendFileSync, existsSync, writeFileSync } from "node:fs"',
  'import { join } from "node:path"',
  '// 2026-10-25 Windows：家目录不许再写死 /tmp/…（Windows 上 /tmp 落到 C:\tmp，跟 tmpdir() 不是一处）',
  '// 改成读插件传进来的 SHENJING_LIFE_HOME —— 它传错，spawn-seen.json 就落不到 PLUGIN_HOME 里，断言照样会红',
  'const home = process.env.SHENJING_LIFE_HOME',
  'const archive = process.env.SHENJING_ARCHIVE',
  'writeFileSync(join(home, "spawn-seen.json"), JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), env: { SHENJING_LIFE_HOME: home, SHENJING_ARCHIVE: archive } }, null, 2))',
  'if (existsSync(join(home, "mode-activity"))) {',
  '  appendFileSync(join(archive, "journal", "extra-activity.md"), "（假 dsh 写的）这一轮动了文件" + String.fromCharCode(10))',
  '}',
  'process.exit(0)',
].join(NL)
writeFileSync(FAKE_DSH, fakeSrc, 'utf8')

// 环境要在 import 之前设好：index.js 是模块级读 env 的
process.env.DSH_ARCHIVE_DIR = ARCHIVE
process.env.SHENJING_DSH_BIN = FAKE_DSH
process.env.SHENJING_HEADLESS_PROFILE = 'headless'

/* ── 1. import + 真跑 apply() ────────────────────────────────────────────── */
head('① 假 ctx 上真跑 apply()')
let mod
try {
  mod = await import('./index.js')
  ok(true, 'import ./index.js 成功')
} catch (e) {
  console.log('  ✗ import 就失败了：' + (e?.stack ?? e))
  process.exit(1)
}

const registered = []
const timers = []
const fakeCtx = {
  // ⭐ 宿主给的是**函数**（dshHomePath(...segments)），这里照样给函数 —— 别用字符串
  get: (k) => (k === 'dshHomePath' ? (...seg) => (seg.length ? join(HOME, ...seg) : HOME) : undefined),
  logger: { info: () => {}, warn: () => {} },
  tools: { register: (t) => { registered.push(t); return t } },
  setInterval: (fn, ms) => { const t = setInterval(fn, ms); timers.push(t); return t },
  effect: (fn) => { try { return fn() } catch { return undefined } },
}
try {
  mod.apply(fakeCtx, {})
  ok(true, 'apply(ctx, config) 没抛错')
} catch (e) {
  console.log('  ✗ apply 抛错了（宿主里就是那句 warning: 1 entry did not activate）：' + (e?.stack ?? e))
  process.exit(1)
}
// ⭐ 把插件自己的定时器停掉：60 秒那一跳会跟手动 tick 抢（谁先谁后不确定），
//    而"定时器起没起"下面单独验。停掉它 = 自检可重复。
for (const t of timers) { try { clearInterval(t) } catch { /* 已经停了 */ } }

const names = registered.map((t) => t?.name).filter(Boolean).sort()
const want = ['life_clock', 'life_loops', 'life_mood', 'life_status', 'life_tell', 'life_wake']
ok(JSON.stringify(names) === JSON.stringify(want), '六个工具都注册上了：' + names.join(', '), '实际：' + names.join(','))
ok(mod.name === 'shenjing-life', 'name = ' + mod.name)
ok(JSON.stringify(mod.inject) === JSON.stringify(['tools', 'timer']), 'inject = ' + JSON.stringify(mod.inject))
ok(typeof mod.apply === 'function', '导出 apply 是函数')
// 工具形状：parameters 是**逐属性的隐含对象**，每个值都得是合法值 schema；
// 里面的 object（比如 output.schema）必须显式写 additionalProperties
for (const t of registered) {
  const bad = []
  const walk = (s, p) => {
    if (!s || typeof s !== 'object') { bad.push(p + '(不是对象)'); return }
    if (typeof s === "object" && Object.keys(s).length === 0) return   // 注解型值 schema（type:json）编译出来就是 {}，合法
    if (typeof s.type !== 'string') bad.push(p + '(缺 type)')
    if (s.type === 'object') {
      if (typeof s.additionalProperties !== 'boolean') bad.push(p + '(object 没写 additionalProperties)')
      for (const [k, v] of Object.entries(s.properties || {})) walk(v, p + '.' + k)
    }
    if (s.type === 'array' && s.items) walk(s.items, p + '.items')
  }
  const paramSpec = t.parameterSpec || t.parameters || {}
  for (const [k, v] of Object.entries(paramSpec)) walk(v, 'parameters.' + k)
  if (t.output?.schema) walk(t.output.schema, 'output.schema')
  ok(bad.length === 0, '工具 ' + t.name + ' 的参数 / 输出 schema 合法', bad.join(' '))
}

const life = fakeCtx.shenjingLife
ok(Boolean(life) && typeof life.tick === 'function', '自检把手 ctx.shenjingLife.tick 拿到了')
const files = life?.files || {}
for (const [f, label] of [
  [files.clockFile, 'clock.json'], [files.stateFile, 'state.json'], [files.mindFile, 'mind.json'],
  [files.changeFile, 'changelog.md'], [files.logDir, 'log/'],
]) ok(existsSync(f), '家目录里铺好了 ' + label)
ok(existsSync(join(ARCHIVE, 'open_loops.md')), '书桌上铺好了 open_loops.md')
ok(life.timerState?.mode === 'ctx', '定时器走的是宿主的 ctx.setInterval（mode=' + (life.timerState?.mode || '无') + '）')

const byName = (n) => registered.find((t) => t.name === n)
const call = async (n, args) => await byName(n).execute(args ?? {}, {})
const readJSON = (f) => JSON.parse(readFileSync(f, 'utf8'))
const readClockFile = () => readJSON(files.clockFile).entries
const stateNow = () => readJSON(files.stateFile)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const waitFor = async (cond, ms = 8000, step = 25) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { try { if (cond()) return true } catch { /* 还没到 */ } await wait(step) }
  return false
}
/** 等这一轮"起完 + 结算完"：state.json 的 mtime 变过之后再等它稳定 */
const waitSettled = async (ms = 8000) => {
  const mt = statSync(files.stateFile).mtimeMs
  const changed = await waitFor(() => { try { return statSync(files.stateFile).mtimeMs !== mt } catch { return false } }, ms)
  if (!changed) return false
  let last = null
  for (let i = 0; i < 40; i++) {
    const n = stateNow().wakesToday
    if (last === n) return true
    last = n
    await wait(25)
  }
  return true
}
const PLUGIN_HOME = life.stateDir      // ⚠️ 家以**插件自己算出来的**为准（第一版自检按 HOME 拼，错了一层）

/* ── 2. 纯函数：静默时段 ─────────────────────────────────────────────────── */
head('② 静默时段判定（00:00–07:30）')
const st = await import('./lib/state.mjs')
ok(st.isSilentAt(30) === true, '00:30 → 在静默时段（true）')
ok(st.isSilentAt(720) === false, '12:00 → 不在静默时段（false）')
ok(st.isSilentAt(449) === true, '07:29 → 还是静默（true）')
ok(st.isSilentAt(450) === false, '07:30 → 出静默（false）')
ok(st.isSilentAt(0) === true, '00:00 → 静默（true）')

/* ── 3. 纯函数：空转降频 ─────────────────────────────────────────────────── */
head('③ 空转降频（stretch）与恢复 —— 纯函数')
let s = { stretch: 1, idleStreak: 0 }
const steps = []
for (let i = 1; i <= 3; i++) { s = st.applyIdleStretch(s, 'idle'); steps.push(s.stretch + '/' + s.idleStreak) }
ok(s.stretch === 1.5, '连续 3 次空转 → stretch 1 → 1.5（走 ' + steps.join(' → ') + '）')
for (let i = 1; i <= 3; i++) s = st.applyIdleStretch(s, 'idle')
ok(s.stretch === 2.25, '再 3 次空转 → 2.25')
for (let i = 1; i <= 6; i++) s = st.applyIdleStretch(s, 'idle')
ok(s.stretch === 4, '一直空转 → 停在 ×4（上限）')
s = st.applyIdleStretch(s, 'activity')
ok(s.stretch === 1 && s.idleStreak === 0, '一旦有 activity → 立刻回原值（1）')
ok(st.gapMinutes(4) === 360, '间隔跟着走：90 分钟 × 4 = 360 分钟')

/* ── 4. life_mood ────────────────────────────────────────────────────────── */
head('④ life_mood 的 reason 硬规则')
const bad1 = await call('life_mood', { valence: 0.5, reason: '' })
ok(bad1.ok === false && bad1.rejected === true, 'reason 为空 → 拒收（' + String(bad1.error || '').slice(0, 26) + '…）')
const mindBefore = readFileSync(files.mindFile, 'utf8')
const bad2 = await call('life_mood', { reason: '  心情有点复杂  ' })
ok(bad2.ok === false, '去空白后不足 8 个字 → 拒收')
ok(readFileSync(files.mindFile, 'utf8') === mindBefore, '两次被拒之后 mind.json 一个字都没变')
const good = await call('life_mood', { valence: -0.5, energy: 0.3, tension: 0.6, reason: '有一条没做完的事放了三天，今天接口又拒了三次', selfReport: true })
ok(good.ok === true && good.mind.source === 'self', '写成功、且 selfReport=true ⇒ source=self')
ok(good.mind.valence === -0.5 && good.mind.tension === 0.6, '数值原样写进去了')
ok(readFileSync(files.changeFile, 'utf8').includes('接口又拒了三次'), 'changelog.md 里留了一行（含 reason）')

/* ── 5. life_clock ───────────────────────────────────────────────────────── */
head('⑤ life_clock：add / remove / enable 真写进家目录')
ok(readClockFile().length === 5, '默认 5 条唤醒表（morning/noon/night/loops/quiet），实际 ' + readClockFile().length)
const add = await call('life_clock', { action: 'add', id: 'evening', when: '19:45', note: '傍晚看一眼' })
ok(add.ok === true, 'add evening @19:45 成功')
ok(readClockFile().some((e) => e.id === 'evening' && e.when === '19:45'), 'clock.json 里真的有这条了')
ok(readFileSync(files.changeFile, 'utf8').includes('evening'), 'changelog 里记了"加它干嘛"')
ok((await call('life_clock', { action: 'add', id: 'x' })).ok === false, 'add 不给 when → 拒绝')
const dis = await call('life_clock', { action: 'disable', id: 'noon' })
ok(dis.ok === true && readClockFile().find((e) => e.id === 'noon').enabled === false, 'disable noon → 落盘了')
const en = await call('life_clock', { action: 'enable', id: 'noon' })
ok(en.ok === true && readClockFile().find((e) => e.id === 'noon').enabled === true, 'enable noon → 又回来了')
ok((await call('life_clock', { action: 'remove', id: 'quiet' })).ok === false, '内置的 quiet（kind=silence）不许删 → 拒绝')
const delEv = await call('life_clock', { action: 'remove', id: 'evening' })
ok(delEv.ok === true && !readClockFile().some((e) => e.id === 'evening'), 'remove evening → 落盘了（不需要理由）')
ok(readFileSync(files.changeFile, 'utf8').includes('删掉了 evening'), 'changelog 里记了删掉这件事')

/* ── 6. life_loops ───────────────────────────────────────────────────────── */
head('⑥ life_loops：open_loops.md 读写')
await call('life_loops', { action: 'add', text: '把插件的定时器坑写进 journal' })
await call('life_loops', { action: 'add', text: '给 selfcheck 加一条静默时段用例' })
let ls = await call('life_loops', { action: 'list' })
ok(ls.open === 2 && ls.items.length === 2, '加了 2 条，list 看到 2 条未完成')
ok(readFileSync(files.loopsFile, 'utf8').includes('- [ ] 给 selfcheck 加一条静默时段用例'), '真的写进 open_loops.md 了')
await call('life_loops', { action: 'done', index: 0 })
ls = await call('life_loops', { action: 'list' })
ok(ls.open === 1 && ls.items[0].done === true, 'done 第 0 条 → 少了一条未完成，且标成 [x]')
ok((await call('life_loops', { action: 'remove', index: 0 })).ok === true, 'remove 第 0 条 → 删掉了')
ok((await call('life_loops', { action: 'list' })).items.length === 1, '现在剩 1 条')

/* ── 7. life_wake（packet） ──────────────────────────────────────────────── */
head('⑦ life_wake：wake packet（读取部分，它自己不调模型）')
const wp = await call('life_wake', { reason: 'selfcheck' })
ok(wp.ok === true && wp.trigger === 'selfcheck', 'life_wake 返回 packet，trigger 带上')
ok(wp.mind && typeof wp.mind.valence === 'number', 'packet 里有 mind')
ok(wp.loops && Array.isArray(wp.loops.items), 'packet 里有 loops（未完成 ' + wp.loops.open + ' 条）')
ok(Array.isArray(wp.journals) && wp.journals.length === 3, 'packet 里有最近三天 journal 末尾（摆了 4 天，取回 ' + wp.journals.length + ' 份）')
ok(String(wp.journals[0]?.tail ?? '').length <= 800, 'journal 末尾截到 800 字以内')
ok(typeof wp.sendAllowed === 'boolean' && wp.threeQuestions.includes('三问'), 'packet 里有"该不该发消息"和三问模板')

/* ── 8. 定时器那一跳：到点 ⇒ 真 spawn 假 dsh ⇒ 结算 ───────────────────────── */
head('⑧ 定时器那一跳：到点 ⇒ 真 spawn 假 dsh ⇒ 结算（idle / activity）')
// ⚠️ 三个坑都在这段里踩过：
//   ① 模拟时钟必须跟"真实当天"同一天（收尾写回用的是真实时钟），否则 readState 会按跨天把计数清零；
//   ② 每一跳之间要留够 90 分钟（节流窗口，还要乘 stretch）—— 间隔不够时"不起"是节流在正常工作；
//   ③ 默认唤醒表一天只有 morning/noon/night 三条，所以"凑到 6 次"得自己加条目（见 ⑨）。
const N2 = new Date()
const at = (h, m) => new Date(N2.getFullYear(), N2.getMonth(), N2.getDate(), h, m, 0)
const todayKey = [N2.getFullYear(), String(N2.getMonth() + 1).padStart(2, '0'), String(N2.getDate()).padStart(2, '0')].join('-')
/** 起一跳 + 等结算（每条 clock 一天只跑一次，所以顺序就是 morning → noon → night） */
const tickAndSettle = async (h, m) => {
  const before = stateNow().wakesToday
  writeFileSync(files.stateFile, JSON.stringify({ ...stateNow(), lastWakeAt: new Date(at(h, m).getTime() - 8 * 3600 * 1000).toISOString() }, null, 2), 'utf8')
  const r = life.tick(at(h, m))
  const settled = await waitSettled()
  return { r, settled, before, after: stateNow().wakesToday }
}

let t1 = await tickAndSettle(8, 0)
ok(t1.r.ran === true, '08:00 那一跳真的起了一轮（' + JSON.stringify(t1.r.why) + '）')
ok(await waitFor(() => existsSync(join(PLUGIN_HOME, 'spawn-seen.json'))), '假 dsh 真的被 spawn 起来了（' + PLUGIN_HOME + '）')
ok(t1.settled, '08:00 的 exit 回调结算完')
ok(stateNow().wakesToday === 1, '今天唤醒数 = 1（实际 ' + stateNow().wakesToday + '）')
ok(stateNow().day === todayKey, 'state.day 跟模拟时钟是同一天（' + stateNow().day + ' / 期望 ' + todayKey + '）')
const seen = readJSON(join(PLUGIN_HOME, 'spawn-seen.json'))
// 完整命令行 = [node, <探测到的 dsh bin.js>, '--profile', 'headless', <提示词>]
ok(seen.argv.includes('--profile') && seen.argv.includes('headless'), '命令行里有 --profile headless')
ok(seen.argv[0] === '--profile', 'argv[0] = --profile（这一份是脚本自己看见的参数，真命令行见下面那行日志）')
ok(seen.argv[1] === 'headless', 'argv[1] = headless（profile 传对了）')
ok(String(seen.argv[2] || '').includes('三问') && String(seen.argv[2] || '').includes(PLUGIN_HOME), 'argv[2] 是 prompts/wake.md 渲染出来的提示词（里面有家目录和三问）')
ok(seen.cwd === PLUGIN_HOME, 'cwd = 插件家目录')
ok(seen.env.SHENJING_ARCHIVE === ARCHIVE, '子进程环境变量：档案目录传对了')
ok(stateNow().lastWakeResult === 'idle', '结算成 idle')
ok(readFileSync(join(files.logDir, todayKey + '.jsonl'), 'utf8').includes('"result":"idle"'), 'log/<日期>.jsonl 追加了一条 result=idle')

// 第 2、3 跳：noon(13:00) 和 night(21:30) —— 两跳之间隔 8 小时多，节流窗口过得去
const t2 = await tickAndSettle(13, 30)
ok(t2.r.ran === true, '13:30 那一跳起了（' + JSON.stringify(t2.r.why) + '）')
ok(t2.after === 2, '结算后计数 = 2（' + t2.after + '）')
const t3 = await tickAndSettle(21, 45)
ok(t3.r.ran === true, '21:45 那一跳起了（' + JSON.stringify(t3.r.why) + '）')
ok(t3.after === 3, '结算后计数 = 3（' + t3.after + '）')
ok(stateNow().wakesToday === 3, '今天一共醒了 3 次（' + stateNow().wakesToday + '）')
ok(stateNow().stretch === 1.5, '连续 3 次空转 ⇒ stretch 抬到 1.5（实际 ' + stateNow().stretch + '）')
ok(readFileSync(files.changeFile, 'utf8').includes('空转降频'), 'changelog 里留了降频这一行')

// activity：给一个"到点还没跑过"的条目，让假 dsh 这次动文件（它往 journal 追加一行）
await call('life_clock', { action: 'add', id: 'act-check', when: '23:30', note: '自检用：验 activity 判定' })
writeFileSync(join(PLUGIN_HOME, 'mode-activity'), '1', 'utf8')
const t4 = await tickAndSettle(23, 45)
ok(t4.r.ran === true, '23:45 那一跳起了（' + JSON.stringify(t4.r.why) + '）')
ok(stateNow().lastWakeResult === 'activity', '这一轮判成 activity（journal 变了才算）')
ok(stateNow().stretch === 1 && stateNow().idleStreak === 0, '有 activity ⇒ stretch 回落（实际 ' + stateNow().stretch + '）')
rmSync(join(PLUGIN_HOME, 'mode-activity'), { force: true })

/* ── 9. 节流闸 ───────────────────────────────────────────────────────────── */
head('⑨ 闸门：间隔不够 / 当天次数用完')
writeFileSync(files.stateFile, JSON.stringify({ ...stateNow(), lastWakeAt: at(23, 45).toISOString() }, null, 2), 'utf8')
const t5 = life.tick(at(23, 50))
ok(t5.ran === false, '23:50（所有条目都跑完了 / 间隔也不够）⇒ 不起（' + t5.why + '）')
// 当天上限：把"已经醒过 6 次 + 刚醒过"摆进 state，再加一条到点的条目 ⇒ 必须被"上限"挡住
const stCap = stateNow()
await call('life_clock', { action: 'add', id: 'cap-check', when: '23:55', note: '自检用：验当天上限' })
writeFileSync(files.stateFile, JSON.stringify({ ...stCap, wakesToday: 6, lastWakeAt: new Date(Date.now() - 10 * 3600 * 1000).toISOString() }, null, 2), 'utf8')
const t6 = life.tick(at(23, 58))
ok(t6.ran === false && String(t6.why).includes('上限'), '今天已经 6 次 ⇒ 不起（' + t6.why + '）')
const thr = await call('life_clock', { action: 'list' })
ok(thr.throttle && thr.throttle && thr.throttle.wakesToday === 6, 'life_clock list 能看到节流状态（' + (thr.throttle && thr.throttle.wakesToday) + '/' + (thr.throttle && thr.throttle.maxWakesPerDay) + '）')
const t7 = life.tick(at(6, 0))
ok(t7.ran === false, '早上 06:00（还没到 08:00 那条）⇒ 不起（' + t7.why + '）')
/* ── 10. 静默时段：照样可以醒，但不许发消息 ─────────────────────────────── */
head('⑩ 静默时段：照样可以醒，但不许发消息')
const p0030 = life.wakePacket(at(0, 30), 'selfcheck:0030')
ok(p0030.inSilence === true, '00:30 的 packet：inSilence=true')
ok(p0030.sendAllowed === false && p0030.sendBlockedBy === 'silent', '00:30 的 packet：sendAllowed=false，理由 silent')
const p1200 = life.wakePacket(at(12, 0), 'selfcheck:1200')
ok(p1200.inSilence === false, '12:00 的 packet：inSilence=false')
// 发消息的闸是独立的一条：把 proactiveToday 摆成 1 ⇒ 今天不再发
const stp = stateNow()
writeFileSync(files.stateFile, JSON.stringify({ ...stp, proactiveToday: 1 }, null, 2), 'utf8')
const p1300 = life.wakePacket(at(13, 0), 'selfcheck:1300')
ok(p1300.sendAllowed === false && p1300.sendBlockedBy === 'already-sent-today', '今天已经发过一条 ⇒ 不发了（already-sent-today）')
writeFileSync(files.stateFile, JSON.stringify({ ...stp, proactiveToday: 0 }, null, 2), 'utf8')

/* ── 11. log 是 append-only ─────────────────────────────────────────────── */
head('⑪ log 是 append-only（代码层静态检查 + 行为）')
const src = readFileSync('./index.js', 'utf8') + readFileSync('./lib/state.mjs', 'utf8')
const offenders = []
for (const line of src.split(NL)) {
  if (/\b(writeFileSync|rmSync|unlinkSync|truncateSync|renameSync|copyFileSync)\b/.test(line) && /logPath|logDir|\.jsonl/.test(line)) offenders.push(line.trim())
}
ok(offenders.length === 0, 'index.js / state.mjs 里没有对 log/*.jsonl 的改写调用', offenders.join(' | '))
ok(src.includes('appendLine'), '日志统一走 appendLine（内部只有 appendFileSync）')
const todayLog = join(files.logDir, todayKey + '.jsonl')
const linesBefore = readFileSync(todayLog, 'utf8').split(NL).filter(Boolean).length
// 加一条还没跑过的条目（其余都跑过了），再把当天计次放掉 ⇒ 这一跳该起，并且"又追加一条"; 旧的还都在
await call('life_clock', { action: 'add', id: 'log-check', when: '23:59', note: '自检用：验日志只追加' })
writeFileSync(files.stateFile, JSON.stringify({ ...stateNow(), wakesToday: 1 }, null, 2), 'utf8')
const t8 = await tickAndSettle(23, 59)
ok(t8.r.ran === true, '23:59 那一跳起了（' + JSON.stringify(t8.r.why) + '）')
const linesAfter = readFileSync(todayLog, 'utf8').split(NL).filter(Boolean).length
ok(linesAfter === linesBefore + 1, '又追加了一条，旧的没被动（' + linesBefore + ' → ' + linesAfter + '）')
const allLines = readFileSync(todayLog, 'utf8').split(NL).filter(Boolean)
const allJson = allLines.every((l) => { try { const j = JSON.parse(l); return j && j.at && j.trigger && j.result } catch { return false } })
ok(allJson && allLines.length >= 5, '每一条都是合法 JSONL（{at, trigger, result, note}），共 ' + allLines.length + ' 条')
ok(allLines.filter((l) => l.includes('"result":"idle"')).length >= 4, 'idle 的条数对得上（' + allLines.filter((l) => l.includes('"result":"idle"')).length + ' 条 idle）')
ok(allLines.some((l) => l.includes('"result":"activity"')), 'activity 那条也在里面')

/* ── 12. 五个工具各自真调一次 ───────────────────────────────────────────── */
head('⑫ 五个工具各自真调一次（形状 + 返回值不炸）')
const s1 = await call('life_status', {})
ok(s1.ok === true && Array.isArray(s1.clock) && s1.clock.length >= 5, 'life_status：返回 ' + (s1.clock || []).length + ' 条 clock + mind + 计数')
ok(typeof s1.today.wakes === 'number' && typeof s1.today.proactive === 'number', 'life_status：今天的唤醒数 / 主动消息数都在')
ok(typeof s1.inSilence === 'boolean' && s1.log.endsWith('.jsonl'), 'life_status：静默判定 + 日志路径')
ok(s1.loops.open === 1 && s1.loops.oldestDays !== null, 'life_status：未完成 1 条、最旧一条 ' + s1.loops.oldestDays + ' 天')
ok(s1.clock.some((e) => e.firedToday === true), 'life_status：能看出哪条今天已经跑过')

/* ── 13. life_tell：闸门在代码里，不在提示词里 ──────────────────────────── */
head('⑬ life_tell：被挡就不发')
const stateFilePath = life.files.stateFile
const stRaw = JSON.parse(readFileSync(stateFilePath, 'utf8'))
ok((await call('life_tell', { text: '   ' })).ok === false, '空消息 → 拒发（不会去碰手机通知）')
writeFileSync(stateFilePath, JSON.stringify({ ...stRaw, proactiveToday: 1 }))
const tellBlocked = await call('life_tell', { text: '今天已经发过一条了，这条该被挡' })
// ⚠️ 2026-10-26：这条断言原来硬等 blockedBy==='already-sent-today'，但 life_tell 用的是**真实时钟**，
//    00:00–07:30 跑自检时闸门会先撞上"静默" ⇒ 红。静默优先于计数本来就是设计（§9 定案：静默比任何情绪都优先），
//    所以两种都是对的行为，只要"确实被挡了、且挡的理由是这两条之一"。
const tellWhy = tellBlocked.blockedBy || '-'
ok(tellBlocked.ok === false && (tellWhy === 'already-sent-today' || tellWhy === 'silent'),
  '今天已发过一条 ⇒ 拒发（blockedBy=' + tellWhy + '）')
// 计数那条单独验一次（绕开静默窗口，直接问闸门函数）：不然白天绿、夜里红，等于没验
if (stRaw.day) {
  const gateAt = new Date(new Date().setHours(12, 0, 0, 0))
  const gateLib = (await import('./lib/state.mjs')).canSendMessage
  ok(gateLib({ ...stRaw, day: stRaw.day, proactiveToday: 1 }, gateAt).why === 'already-sent-today',
    '闸门：中午 + 今天已发一条 ⇒ already-sent-today（不受跑自检的时刻影响）')
}
writeFileSync(stateFilePath, JSON.stringify({ ...stRaw, proactiveToday: 0 }))

/* ── 收尾 ────────────────────────────────────────────────────────────────── */
for (const t of timers) { try { clearInterval(t) } catch { /* 已经停了 */ } }
console.log(NL + '─'.repeat(66))
console.log('自检结果：' + passed + ' 条通过，' + fails.length + ' 条没过')
if (fails.length) { console.log('没过的：'); for (const f of fails) console.log('  - ' + f) }
console.log('（全程不碰真家目录：家 = ' + HOME + '，书桌 = ' + ARCHIVE + '，headless 用假 dsh = ' + FAKE_DSH + '）')
console.log('沙箱留在 ' + SANDBOX + '，要看现场就进去翻（跑之前会先清一次）')
try { rmSync(join(PLUGIN_HOME, 'mode-activity'), { force: true }) } catch { /* 无所谓 */ }
process.exit(fails.length ? 1 : 0)
