/**
 * lib/hostdeps.mjs —— 从宿主那棵树里取 defineTool（拿不到就退到"本地等价实现"）
 * ============================================================================
 * 抄自 dsh-bili-scroll（同一个宿主上跑通的那份），只留我们真正要的一样东西：defineTool。
 *
 * 🔴 为什么要这么绕（2026-10-16 一位用户递来的完整报告，bili-scroll 那边本机也复现了）：
 *   defineTool 在 @deepseek-ai/dsh-tools 里，而它是 **optional peer** ——
 *   桌面版 profile 是 autoInstallPeers: false ⇒ 永远不装 ⇒ **裸 import 会让整条插件不激活** ✗
 *   （DSH 只留一句 warning: 1 entry did not activate … failed to import，用户完全不知道哪出错了）
 *
 * ⭐ 策略：
 *   ① 优先从宿主那棵树里解析（跟宿主用同一份，行为最一致）
 *   ② 拿不到就本地等价实现顶上 —— 我们的 parameters / output.schema **本来就是标准 JSON Schema**，
 *      所以本地实现只做同一条校验（object 必须显式写 additionalProperties），别的原样返回
 *   ③ **绝不因为一个 import 让整条插件不激活**（v0.1 连 schemastery 都不需要：没有 Config）
 * ============================================================================
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** 插件自己那棵树（本地开发时是 link 进来的，可能是空的） */
const SELF_MODULES = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '@deepseek-ai')

/** 可能藏着宿主 @deepseek-ai 包的地方（不写死某一台机器，按可能性排序） */
export function candidateRoots() {
  const out = []
  const push = (p) => { if (p && !out.includes(p)) out.push(p) }
  push(process.env.DSH_HOST_MODULES)

  const appdata = process.env.APPDATA
  if (appdata) {
    const npm = join(appdata, 'npm', 'node_modules')
    push(join(npm, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai'))
    push(join(npm, '@deepseek-ai'))
    try {
      for (const n of readdirSync(join(npm, '@deepseek-ai'))) {
        push(join(npm, '@deepseek-ai', n, 'node_modules', '@deepseek-ai'))
      }
    } catch { /* 没有就算了 */ }
  }
  push('/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai')
  push('/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai')
  push('/usr/local/lib/node_modules/@deepseek-ai')
  push('/usr/lib/node_modules/@deepseek-ai')

  // profile 树：有些机器上这些包是被别的插件 hoist 到 profile 根上的
  try {
    const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
    for (const p of readdirSync(join(dshHome, 'profiles'))) {
      push(join(dshHome, 'profiles', p, 'node_modules', '@deepseek-ai'))
    }
  } catch { /* 没有就算了 */ }

  push(SELF_MODULES)   // 插件自己那份放最后（前面优先"跟宿主同一份"）
  return out
}

/** 按包的 exports['.'] 找入口文件，返回 file:// URL */
function entryUrlFor(root, name) {
  try {
    const dir = join(root, name)
    const pkgFile = join(dir, 'package.json')
    if (!existsSync(pkgFile)) return null
    const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
    const dot = pkg.exports?.['.']
    const rel = typeof dot === 'string' ? dot : (dot?.import || dot?.default || pkg.module || pkg.main)
    if (!rel) return null
    const file = join(dir, String(rel).replace(/^\.\//, ''))
    return existsSync(file) ? pathToFileURL(file).href : null
  } catch { return null }
}

/** 试从宿主树里 import 一个包；拿不到返回 null（失败原因写进 notes，方便远程排查） */
async function fromHostTree(name, log) {
  const fails = []
  for (const root of candidateRoots()) {
    if (root === SELF_MODULES) continue          // 自己那份交给下面的 bare import 处理
    const url = entryUrlFor(root, name)
    if (!url) continue
    try {
      const mod = await import(url)
      log(name + '：从宿主树取到（' + url.replace(/^file:\/\/\//, '') + '）')
      return mod
    } catch (e) { fails.push(String(e?.code || 'ERR') + ':' + root) }
  }
  if (fails.length) log(name + '：宿主树里都不行（' + fails.slice(0, 3).join(' ') + '）')
  return null
}

/** 兜底：**我们自己的等价实现**，只在拿不到宿主的 dsh-tools 时用 */
function localDefineTool(options, log) {
  // 宿主那份的参数形状是"**逐属性的隐含对象**"：defineTool({ parameters: { name: { type:'string', required:true } } })
  //   —— 不是一份完整的 JSON Schema！所以这里按它的规则拼回来：
  //     · 每个属性：{ type, enum?, description?, items? }（required: true 走"必填"）
  //     · 根节点永远是 type:'object'，properties = 这些属性，required = 标了 required:true 的那些
  //     · 缺 additionalProperties 会在宿主那边直接抛 JsonSchemaError ⇒ 我们**显式写上 false**
  //     · 返回值形状（output.schema）走的是"值 schema"那条路，允许 type:'json'（注解型，不约束）
  const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
  const compile = (spec, path) => {
    if (!isObj(spec)) throw new Error('defineTool(' + options.name + '): ' + path + ' 必须是 schema 对象')
    if (spec.type === 'object') {
      if (typeof spec.additionalProperties !== 'boolean') {
        throw new Error('defineTool(' + options.name + '): ' + path + ' 是 object 却没写 additionalProperties（必须显式 true/false）')
      }
      return spec
    }
    const out = { ...spec }
    if (out.type === 'array' && isObj(out.items)) out.items = compile(out.items, path + '.items')
    return out
  }
  const params = isObj(options.parameters) ? options.parameters : {}
  const properties = {}
  const required = []
  for (const [k, v] of Object.entries(params)) {
    if (!isObj(v)) throw new Error('defineTool(' + options.name + '): parameters.' + k + ' 必须是 schema 对象')
    const spec = { ...v }
    if (spec.required === true) { required.push(k); delete spec.required }
    properties[k] = compile(spec, 'parameters.' + k)
  }
  const parameters = { type: 'object', additionalProperties: false, properties }
  if (required.length) parameters.required = required
  const output = { schema: compile(options.output?.schema ?? { type: 'json' }, 'output.schema') }
  log('dsh-tools 拿不到 —— 用本地等价实现顶上了（工具 ' + options.name + '）')
  return { name: options.name, description: options.description, parameters, output, execute: options.execute }
}

/**
 * 取回宿主半端要用的一点点东西
 * @returns {Promise<{defineTool: Function, notes: string[]}>}
 */
export async function loadHostDeps() {
  const notes = []
  const log = (m) => notes.push(m)

  let defineTool = null
  const dtMod = await fromHostTree('dsh-tools', log)
  if (dtMod?.defineTool) {
    defineTool = dtMod.defineTool
  } else {
    try {
      const bare = await import('@deepseek-ai/dsh-tools')
      if (bare?.defineTool) { defineTool = bare.defineTool; log('dsh-tools：宿主树里没有，用自己依赖里那份') }
    } catch (e) { log('dsh-tools 拿不到（' + String(e?.code || '') + '）—— 用本地等价实现顶上') }
  }
  if (!defineTool) defineTool = (options) => localDefineTool(options, log)

  return { defineTool, notes }
}