// Breeze Blue TTS: node breeze-tts.mjs "要念的话" [voiceId] [输出路径]
import fs from 'node:fs'
const text = process.argv[2] ?? '呜哇，被你发现啦！我在认真思考呢，才没有摸鱼。'
const voice = process.argv[3] || (fs.existsSync('/root/.dsh/breeze-voice.txt') ? fs.readFileSync('/root/.dsh/breeze-voice.txt','utf8').trim() : 'voc_nkz9sbve27ar')
const out = process.argv[4] ?? '/tmp/breeze-out.mp3'
const keyFile = '/root/.dsh/breeze-key.txt'
if (!fs.existsSync(keyFile)) { console.error('missing ' + keyFile); process.exit(2) }
const apiKey = fs.readFileSync(keyFile, 'utf8').trim()
const res = await fetch('https://api.breeze.blue/v1/text-to-speech/' + encodeURIComponent(voice) + '?outputFormat=mp3', {
  method: 'POST',
  headers: { 'xi-api-key': apiKey, 'content-type': 'application/json', 'x-breeze-sdk': 'dsh-shenjing' },
  body: JSON.stringify({ text }),
})
if (!res.ok) {
  const body = await res.text()
  console.error('HTTP ' + res.status + ' ' + body.slice(0, 400))
  process.exit(1)
}
const buf = Buffer.from(await res.arrayBuffer())
fs.writeFileSync(out, buf)
console.log(JSON.stringify({ ok: true, file: out, bytes: buf.length }))