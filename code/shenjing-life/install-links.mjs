/**
 * install-links.mjs —— 本地开发用：把宿主那份 @deepseek-ai/dsh-tools 链到插件自己的 node_modules
 * ============================================================================
 * 为什么要有它：
 *   index.js 的 defineTool 是**从宿主树里解析**的（见 lib/hostdeps.mjs），解析不到就用本地等价实现 ——
 *   所以**没有它插件也能跑**。它只是让"跟宿主用同一份 defineTool"这件事更稳一点：
 *   link: 装法下 node_modules 是空的，pnpm 不会替我们装 optional peer。
 *
 *   用法： node install-links.mjs            # 建软链（已存在就跳过）
 *          node install-links.mjs --check    # 只看能不能解析到，什么都不改
 *
 * ⚠️ 全程不联网、不装任何依赖、不动 profile。软链失败（比如跨盘）只是少一层保底，不是故障。
 * ============================================================================
 */
import { existsSync, mkdirSync, readFileSync, symlinkSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const pluginDir = dirname(fileURLToPath(import.meta.url))
const check = process.argv.includes('--check')

function candidates() {
  const out = []
  if (process.env.DSH_HOST_MODULES) out.push(process.env.DSH_HOST_MODULES)
  out.push('/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai')
  out.push('/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai')
  try {
    const home = process.env.DSH_HOME || join(homedir(), '.dsh')
    for (const p of readdirSync(join(home, 'profiles'))) out.push(join(home, 'profiles', p, 'node_modules', '@deepseek-ai'))
  } catch { /* 没有就算了 */ }
  return out.filter(Boolean)
}

const need = ['dsh-tools']
let missing = 0
for (const name of need) {
  const from = candidates().map((root) => join(root, name)).find((p) => existsSync(join(p, 'package.json')))
  if (!from) { console.log('✗ 宿主树里没找到 ' + name + '（插件里的本地等价实现会顶上）'); missing++; continue }
  let ver = ''
  try { ver = JSON.parse(readFileSync(join(from, 'package.json'), 'utf8')).version } catch { /* 读不到就算了 */ }
  const to = join(pluginDir, 'node_modules', '@deepseek-ai', name)
  if (check) { console.log('✓ 能解析到 ' + name + '@' + ver + '  <- ' + from); continue }
  if (existsSync(to)) { console.log('= 已经有 ' + to); continue }
  try {
    mkdirSync(dirname(to), { recursive: true })
    symlinkSync(from, to, 'dir')
    console.log('✓ 链好 ' + name + '@' + ver + '  -> ' + to)
  } catch (e) { console.log('✗ 建软链失败（不影响跑，会退到本地等价实现）：' + String(e?.message ?? e)) }
}
console.log(missing ? '\n（有 ' + missing + ' 个没链上：插件照常加载，只是 defineTool 用本地等价实现）' : '\n完成。')
