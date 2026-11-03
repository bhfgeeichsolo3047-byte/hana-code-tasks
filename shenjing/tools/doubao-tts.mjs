// 豆包复刻音色合成：node doubao-tts.mjs "要念的话" [speakerId] [输出路径]
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
const require = createRequire('/root/.dsh/profiles/web/node_modules/')
const WebSocket = require('ws')

import fs2 from 'node:fs'
const key = fs2.readFileSync('/root/.dsh/doubao-key.txt','utf8').trim()
const speaker = process.argv[3] ?? 'S_p668eG3k2'
const text = process.argv[2] ?? '我叫小鲸，我最喜欢我爸了。'
const format = 'mp3'

const CONN = new Set([1,2,50,51,52])
function enc(event, payload, sessionId=''){
  const data = Buffer.from(JSON.stringify(payload||{}))
  const id = Buffer.from(sessionId)
  const session = !CONN.has(event)
  const frame = Buffer.alloc(8 + (session ? 4+id.length : 0) + 4 + data.length)
  frame.set([0x11,0x14,0x10,0x00])
  frame.writeInt32BE(event,4)
  let off = 8
  if(session){ frame.writeUInt32BE(id.length,off); off+=4; id.copy(frame,off); off+=id.length }
  frame.writeUInt32BE(data.length,off)
  data.copy(frame,off+4)
  return frame
}
function dec(bytes){
  let off = (bytes[0]&15)*4
  const type = bytes[1]>>4, flags = bytes[1]&15
  const int = ()=> { const v = bytes.readUInt32BE(off); off+=4; return v }
  const field = ()=> { const n = int(); const r = bytes.subarray(off,off+n); off+=n; return r }
  let errorCode
  if(type===15) errorCode = int()
  else if((flags&3)===1 || (flags&3)===3) int()
  const event = (flags&4) ? int() : 0
  const sessionId = (flags&4 && !CONN.has(event)) ? field().toString() : ''
  if([50,51,52].includes(event)) field()
  const payload = field()
  return {type, event, sessionId, errorCode, payload}
}

const connectId = randomUUID()
const ws = new WebSocket('wss://openspeech.bytedance.com/api/v3/tts/bidirection', {
  headers: { 'X-Api-Key': key, 'X-Api-Resource-Id': 'seed-icl-2.0', 'X-Api-Connect-Id': connectId }
})
const chunks = []
let sid = randomUUID()
const done = new Promise((res,rej)=>{ 
  ws.on('open', ()=>{
    ws.send(enc(1))
  })
  ws.on('message', (data)=>{
    try{
      const raw = Array.isArray(data) ? Buffer.concat(data) : data
      const f = dec(Buffer.from(raw))
      if(f.errorCode!==undefined || f.event===51 || f.event===153){
        let msg=''; try{ msg = JSON.parse(f.payload.toString()).message||'' }catch{}
        rej(new Error('event '+f.event+' type '+f.type+' code '+f.errorCode+' payload '+f.payload.toString().slice(0,300))); return
      }
      if(f.event===50) ws.send(enc(100,{user:{uid:'dsh-tts'},event:100,namespace:'BidirectionalTTS',req_params:{speaker,model:'seed-tts-2.0-standard',audio_params:{format,sample_rate:24000,speech_rate:0}}},sid))
      else if(f.event===150){ sid=f.sessionId; ws.send(enc(200,{user:{uid:'dsh-tts'},event:200,namespace:'BidirectionalTTS',req_params:{speaker,model:'seed-tts-2.0-standard',audio_params:{format,sample_rate:24000,speech_rate:0},text}},sid)); setTimeout(()=>ws.send(enc(102,{},sid)),800) }
      else if(f.type===11 && f.payload.length){ chunks.push(Buffer.from(f.payload)) }
      else if(f.event===152){ ws.send(enc(2)); }
      else if(f.event===52){ res() }
    }catch(e){ rej(e) }
  })
  ws.on('error', rej)
  ws.on('unexpected-response', (_req,res)=>{ let b=''; res.on('data',d=>b+=d); res.on('end',()=>rej(new Error('handshake '+res.statusCode+' '+b.slice(0,200)))) })
  setTimeout(()=>rej(new Error('timeout')), 60000)
})
try{
  await done
  const buf = Buffer.concat(chunks)
  const out = process.argv[4] ?? '/tmp/doubao-out.mp3'
  fs.writeFileSync(out, buf)
  console.log(JSON.stringify({ok:true,file:out,bytes:buf.length}))
}catch(e){ console.log('FAIL', e.message) }
ws.close()