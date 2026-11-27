/**
 * lib/verify.mjs —— 「评论发出后复核」
 * ============================================================================
 * 为什么要有它（2026-10-16，用户 `你的deepseek` 在评论区反馈 + 我们 10/10 亲踩）：
 *   **接口回「发送成功」≠ 公开可见** —— 新号 / 风控会让评论进审核，你自己看不见，
 *   而插件以为发出去了、还把它记进判重表 ⇒ 下一轮不再发 ⇒ **一条都没到人**。
 *   还有更坏的一层：**不公开时连通知都不会推**，于是"@ 了但没人收到"。
 *
 * 复核靠两条只读接口（2026-10-16 实测可行）：
 *   ① **顶层评论**：`/x/v2/reply/main?type=1&oid=<aid>&mode=2&next=0&ps=20`（按时间）
 *      —— 刚发出来的通常在**第一页**；找得到 ⇒ 公开可见（还能顺便读到赞数）。
 *   ② **楼中楼**：`/x/v2/reply/reply?type=1&oid=<aid>&root=<root>&ps=20`
 *      —— 直接按 root 拉那一串，找我们的 rpid。
 *   ⚠️ **看不到 ≠ 没发出**（翻页 / 热度排序都会漏）⇒ 结论一律用"**没查到**"这种说法，
 *      不写成"没发出去"（这是 2026-10-15 那条教训的同一把尺子）。
 *   ✗ `/x/v2/reply/detail` 走不通（回 `-400 请求错误`），别无谓地换它。
 *
 * ⭐ 深鲸补丁（2026-11-25 21:30）—— 复核的账本修了两个洞：
 *   ① 候选不再从 seen.md 的表格单元格里抠 rpid。那格是模型手写的散文，写表时被 `_cell()`
 *      截到 60 字，rpid 会被截成六位（11-25 12:01 那条就是这么变成 `rpid=321247` 的），
 *      而 parseSeen 要九位以上 ⇒ 整行静默 `continue`，**最新的一条恰恰最不可能被复核到**。
 *      现在 rpid 的权威来源是 comments.md（发成功那一刻由 mcp_server.py 机器写的台账）。
 *   ② null 没有过期：`visible: null` 永远留在候选里，每轮白查同一批老记录（11-25 12:03
 *      那轮查的 6 条全是 11-08/11-09 的）。实测 3690 条评论，我们的旧评论排在时间倒序第
 *      180 页附近，「顶层·最新一页」这个口径对它们恒定「没查到」—— 不是错，是够不着。
 *      现在：发出去超过 24h 就记成「放弃·翻页够不着」，不再占候选位；24h 内的 null 隔 6h 才重查。
 * ============================================================================
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dayKey } from './state.mjs'
import { replaceSect } from './report-sect.mjs'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 从判重表里抠出「我们发过的评论」记录：容忍 markdown 表格 / 列表 / 随手写的行 */
export function parseSeen(text) {
  const rows = []
  for (const line of String(text).split(/\r?\n/)) {
    const bv = /BV[0-9A-Za-z]{10}/.exec(line)
    if (!bv) continue
    const nums = [...line.matchAll(/\b(\d{9,})\b/g)].map((m) => Number(m[1]))
    if (!nums.length) continue
    // 约定：第一个长数字 = rpid；如果后面还有第二个，且明显是另一个 id，就当 root（楼中楼）
    const rpid = nums[0]
    const root = nums.length > 1 ? nums[1] : 0
    rows.push({ bv: bv[0], rpid, root, line: line.trim().slice(0, 160) })
  }
  return rows
}

/**
 * ⭐ 深鲸补丁：从评论台账 comments.md 里抠出权威记录。
 * 一行一条：`- 2026-11-25 12:01 BV1xxxx rpid=321247530017 · 正文`
 * 这是 mcp_server.py 在「发成功」那一刻机器写的，rpid 是接口回来的真号，不是模型抄的。
 */
export function parseComments(text) {
  const rows = []
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^-\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s*(BV[0-9A-Za-z]{10})\s+rpid=(\d+)/.exec(line.trim())
    if (!m) continue
    const rpid = Number(m[4])
    if (!rpid) continue
    const at = new Date(`${m[1]} ${m[2]}:00`).getTime()   // 本机时区，和插件别处一致
    rows.push({ bv: m[3], rpid, at: Number.isFinite(at) ? at : 0, line: line.trim().slice(0, 160) })
  }
  return rows
}

/**
 * ⭐ 深鲸补丁：判重表里「标着评论、却抠不出九位 rpid」的行 —— 这些从来进不了复核，
 * 原来一声不响。现在只负责数出来（由 verifyRecent 记一行日志），不再指望它当候选来源。
 */
export function seenRowsMissingRpid(text) {
  const out = []
  for (const line of String(text).split(/\r?\n/)) {
    if (!/BV[0-9A-Za-z]{10}/.test(line)) continue
    // 表格行：状态在最后一格。标题里带「评论」两个字（比如「被几百条评论纠正后」）不能算
    const cells = line.split('|').map((c) => c.trim())
    const isRow = cells.length >= 5
    const status = isRow ? cells[cells.length - 2] : ''
    const looksComment = isRow ? /评论/.test(status) : /评论/.test(line)
    if (!looksComment) continue
    if (/\b\d{9,}\b/.test(line)) continue
    out.push(line.trim().slice(0, 140))
  }
  return out
}

export const VERIFY_EXPIRY_MS = 24 * 3600 * 1000   // 发出去这么久还查不到 ⇒ 放弃（翻页够不着）
export const VERIFY_RETRY_MS = 6 * 3600 * 1000     // 24h 内，null 至少隔这么久才重查
export const VERIFY_CONFIRM_MS = 7 * 864e5         // 老口径：确认可见后 7 天内不重查

/**
 * ⭐ 深鲸补丁：挑这一轮要复核哪几条（纯函数，好写单测）。
 * @returns {{fresh:Array, skipped:number, gaveUp:Array}}
 */
export function pickFresh(rows, state, now, { max = 6, expiryMs = VERIFY_EXPIRY_MS, retryMs = VERIFY_RETRY_MS, confirmMs = VERIFY_CONFIRM_MS } = {}) {
  const fresh = []
  const gaveUp = []
  const seenRpid = new Set()
  let skipped = 0
  for (const r of rows.slice().reverse()) {            // 从最新的往回看
    const key = String(r.rpid)
    if (seenRpid.has(key)) continue                    // 台账 + 判重表并起来后可能有重复
    seenRpid.add(key)
    const prev = state[key]
    if (prev?.visible === true && now - (prev.at || 0) < confirmMs) { skipped++; continue }
    if (prev?.gaveUp) { skipped++; continue }
    const age = r.at ? now - r.at : null
    // 发出去超过 24h 还从没查到过 ⇒ 记成放弃，不再每轮白查（够不着就是够不着，不是「还在审核」）
    if (age !== null && age >= expiryMs) {
      if (prev?.visible !== true) gaveUp.push(r)
      else skipped++
      continue
    }
    // 24h 内查过但没结论：隔 6h 才再看一眼（刚发出去的等审核，隔几分钟重查没意义）
    if (prev && prev.visible === null && prev.at && now - prev.at < retryMs) { skipped++; continue }
    fresh.push(r)
    if (fresh.length >= max) break
  }
  return { fresh, skipped, gaveUp }
}

export function loadCredential(stateDir) {
  const f = join(stateDir, 'bili_credential.json')
  if (!existsSync(f)) return null
  try {
    const c = JSON.parse(readFileSync(f, 'utf8'))
    if (!c?.sessdata) return null
    return c
  } catch { return null }
}

function headersFor(cred) {
  return {
    'User-Agent': UA,
    Referer: 'https://www.bilibili.com/',
    Cookie: `SESSDATA=${cred.sessdata}; bili_jct=${cred.bili_jct}; buvid3=${cred.buvid3}`,
  }
}

async function jget(url, headers) {
  try {
    const r = await fetch(url, { headers })
    const t = await r.text()
    try { return JSON.parse(t) } catch { return { code: -999, message: 'not json' } }
  } catch (e) { return { code: -998, message: String(e?.message ?? e) } }
}

/**
 * 复核一条：先试顶层（按时间第一页），再试楼中楼（如果记了 root）
 * @returns {{rpid:number, bv:string, visible:boolean|null, likes?:number, how:string, note:string}}
 */
export async function verifyOne(record, { cred, aidCache = new Map(), headers }) {
  const out = { rpid: record.rpid, bv: record.bv, visible: null, how: '', note: '' }
  if (!aidCache.has(record.bv)) {
    const v = await jget(`https://api.bilibili.com/x/web-interface/view?bvid=${record.bv}`, headers)
    aidCache.set(record.bv, v?.code === 0 ? { aid: v.data.aid, mid: v.data.owner?.mid, title: v.data.title } : null)
    await sleep(300)
  }
  const meta = aidCache.get(record.bv)
  if (!meta) { out.how = '取视频信息失败'; out.note = '这条跳过（视频可能已删/不可见）'; return out }
  const aid = meta.aid

  // ① 顶层：按时间第一页（刚发的就在这儿）
  if (!record.root) {
    const d = await jget(`https://api.bilibili.com/x/v2/reply/main?type=1&oid=${aid}&mode=2&next=0&ps=20`, headers)
    const list = d?.data?.replies || []
    const hit = list.find((r) => r.rpid === record.rpid)
    if (hit && hit.rpid === record.rpid) {
      out.visible = true; out.likes = hit.like; out.how = '顶层·最新一页'
      out.note = hit.invisible ? '（但接口标了 invisible）' : ''
      return out
    }
    out.how = '顶层·最新一页'
    out.note = '最新一页里没找到 —— 可能还在审核，也可能只是翻页看不到（**不等于没发出去**）'
    return out
  }

  // ② 楼中楼：按 root 拉那一串
  const d = await jget(`https://api.bilibili.com/x/v2/reply/reply?type=1&oid=${aid}&root=${record.root}&ps=20&pn=1`, headers)
  const subs = d?.data?.replies || []
  const hit = subs.find((r) => r.rpid === record.rpid)
  if (hit) {
    out.visible = true; out.likes = hit.like; out.how = `楼中楼·root=${record.root}`
    out.note = hit.invisible ? '（但接口标了 invisible）' : ''
    return out
  }
  out.how = `楼中楼·root=${record.root}`
  out.note = subs.length
    ? `那一串里有 ${subs.length} 条，但没有我们这条 —— 可能还在审核（**不等于没发出去**）`
    : '那一串暂时拉不到内容 —— 可能还在审核（**不等于没发出去**）'
  return out
}

/**
 * 复核最近的一批（默认最多 6 条、只挑没复核过的）
 * @returns {Promise<{checked:Array, skipped:number, text:string}>}
 */
export async function verifyRecent(stateDir, { max = 6, log = () => {} } = {}) {
  const seenFile = join(stateDir, 'seen.md')
  if (!existsSync(seenFile)) return { checked: [], skipped: 0, text: '⚠️ 判重表还没生成，没什么可复核的' }
  const cred = loadCredential(stateDir)
  if (!cred) return { checked: [], skipped: 0, text: '⚠️ 还没扫码登录，没法复核（复核要用你自己的登录态）' }

  // ⭐ 深鲸补丁：候选 = 评论台账（权威，rpid 是接口真号）+ 判重表里能解析出 rpid 的行（兜底）
  const seenText = readFileSync(seenFile, 'utf8')
  const ledgerFile = join(stateDir, 'comments.md')
  const fromLedger = existsSync(ledgerFile) ? parseComments(readFileSync(ledgerFile, 'utf8')) : []
  const merged = new Map()
  for (const r of fromLedger) merged.set(String(r.rpid), r)
  for (const r of parseSeen(seenText)) if (!merged.has(String(r.rpid))) merged.set(String(r.rpid), r)
  const rows = [...merged.values()]
  if (!rows.length) return { checked: [], skipped: 0, text: '还没发过评论，暂时不用核（等你开了「自动评论并 @ 你」、并且真的发出去过一条之后，这里才有东西可核）' }

  // 判重表里那些「标着评论、抠不出 rpid」的行：不再静默丢，数出来记一行
  const noRpid = seenRowsMissingRpid(seenText)

  const stateFile = join(stateDir, 'verify-state.json')
  let state = {}
  try { state = JSON.parse(readFileSync(stateFile, 'utf8')) } catch { /* 头一次跑 */ }
  const now = Date.now()
  const { fresh, skipped, gaveUp } = pickFresh(rows, state, now, { max })

  const persist = () => { try { writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8') } catch { /* 写不了就算了，复核不该因此失败 */ } }

  if (noRpid.length) log(`⚠️ 判重表里 ${noRpid.length} 行标着「评论」但抠不出九位 rpid —— 这些行进不了复核（候选改从 comments.md 来）：${noRpid[0]}`)
  if (gaveUp.length) {
    for (const r of gaveUp) {
      const prev = state[String(r.rpid)] || {}
      state[String(r.rpid)] = { ...prev, visible: null, at: prev.at || now, gaveUp: true, gaveUpAt: now, how: '放弃·翻页够不着', bv: r.bv, likes: null }
    }
    persist()
    log(`放弃复核 ${gaveUp.length} 条（发出去超过 ${Math.round(VERIFY_EXPIRY_MS / 3600000)} 小时仍查不到：翻页够不着，不再每轮白查）`)
  }
  if (!fresh.length) {
    const tail = gaveUp.length ? `，另有 ${gaveUp.length} 条记成放弃` : ''
    return { checked: [], skipped, text: `这一轮没有要查的（跳过的 ${skipped} 条${tail}）` }
  }

  const headers = headersFor(cred)
  const aidCache = new Map()
  const checked = []
  for (const r of fresh) {
    const res = await verifyOne(r, { cred, aidCache, headers })
    checked.push(res)
    state[String(r.rpid)] = { visible: res.visible, at: now, how: res.how, bv: r.bv, likes: res.likes ?? null }
    log(`复核 ${r.bv} rpid=${r.rpid} → ${res.visible === true ? '公开可见' : '没查到'}（${res.how}）`)
    await sleep(700)
  }
  persist()

  const lines = ['', '## 评论复核（宿主自动跑的，不是那一轮自己说的）', '']
  for (const c of checked) {
    const t = c.visible === true ? `公开可见（赞 ${c.likes ?? 0}）` : '没查到'
    lines.push(`- \`${c.bv}\` rpid **${c.rpid}** —— ${t} · 依据：${c.how}${c.note ? ' · ' + c.note : ''}`)
  }
  if (skipped) lines.push(`- （另外 ${skipped} 条最近已复核过，没重复查）`)
  if (gaveUp.length) lines.push(`- （${gaveUp.length} 条发出去超过 ${Math.round(VERIFY_EXPIRY_MS / 3600000)} 小时仍查不到，记成「放弃·翻页够不着」，不再复检）`)
  const text = lines.join('\n')
  return { checked, skipped, gaveUp: gaveUp.length, text }
}

/** 把复核结果追加到当天的报告末尾（报告可能还不存在 —— 那就别硬造一份） */
export function appendVerifyToReport(stateDir, text) {
  try {
    const f = join(stateDir, 'out', `${dayKey()}.md`)
    if (!existsSync(f)) return null
    // ⭐ #135：一轮里复核可能被触发两次（收尾自动核 + 手动点），原来是无脑追加 ⇒ 那段出现两遍
    let cur = readFileSync(f, 'utf8')
    const marker = '## 评论复核'
    writeFileSync(f, replaceSect(cur, marker, text), 'utf8')
    return f
  } catch { return null }
}

// ── 单独跑：node lib/verify.mjs <stateDir>（方便手工验 / 也方便我测） ──
if (process.argv[1] && /verify\.mjs$/.test(process.argv[1])) {
  const dir = process.argv[2] || join(process.env.DSH_HOME || join(process.env.USERPROFILE || '.', '.dsh'), 'bili-duty')
  const r = await verifyRecent(dir, { log: (m) => console.log('  ' + m) })
  console.log(r.text)
}
