// 云端 TTS：硅基流动 CosyVoice2 + 克隆音色
import fs from 'node:fs'
import path from 'node:path'

const HOME = '/root/Documents/deepseek-harness/default-workspace/shenjing/tools'
const CONF = path.join(HOME, 'voice.json')

function loadKey() {
  const y = fs.readFileSync('/root/.dsh/.credentials.yaml', 'utf8')
  const m = y.match(/SHENJING_BRAIN_API_KEY:\s*(\S+)/)
  if (!m) throw new Error('没找到 SHENJING_BRAIN_API_KEY')
  return m[1].replace(/^["']|["']$/g, '')
}

export async function tts(text, outPath) {
  const conf = JSON.parse(fs.readFileSync(CONF, 'utf8'))
  const res = await fetch('https://api.siliconflow.cn/v1/audio/speech', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + loadKey() },
    body: JSON.stringify({
      model: conf.model,
      input: text,
      voice: conf.voice,
      response_format: 'mp3',
      speed: conf.speed ?? 1,
    }),
  })
  if (!res.ok) throw new Error('TTS ' + res.status + ' ' + (await res.text()).slice(0, 300))
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(outPath, buf)
  return { path: outPath, bytes: buf.length }
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const text = process.argv[2] || '我在听。'
  const out = process.argv[3] || '/tmp/shenjing-tts.mp3'
  tts(text, out).then(r => console.log(JSON.stringify(r))).catch(e => { console.error(e.message); process.exit(1) })
}
