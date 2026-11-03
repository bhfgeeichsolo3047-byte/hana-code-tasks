import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
const HERE = path.dirname(new URL(import.meta.url).pathname)
const require = createRequire(path.join(HERE, 'msedge-tts.cjs'))
const { MsEdgeTTS } = require(path.join(HERE, 'msedge-tts.cjs'))

export async function edgeTTS(text, outPath, voice = 'zh-CN-XiaoxiaoNeural') {
  const tts = new MsEdgeTTS()
  await tts.setMetadata(voice, 'audio-24khz-48kbitrate-mono-mp3')
  const r = await tts.toStream(text)
  const chunks = []
  await new Promise((res, rej) => {
    r.audioStream.on('data', c => chunks.push(c))
    r.audioStream.on('end', res)
    r.audioStream.on('error', rej)
    setTimeout(() => rej(new Error('edge tts timeout')), 40000)
  })
  const b = Buffer.concat(chunks)
  fs.writeFileSync(outPath, b)
  return { path: outPath, bytes: b.length, voice }
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const voice = process.argv[2] || 'zh-CN-XiaoxiaoNeural'
  const text = process.argv[3] || '你好'
  const out = process.argv[4] || '/tmp/edge.mp3'
  edgeTTS(text, out, voice).then(r => console.log(JSON.stringify(r))).catch(e => { console.error(e.message); process.exit(1) })
}
