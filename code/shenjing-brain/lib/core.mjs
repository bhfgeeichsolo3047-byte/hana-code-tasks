import { mkdirSync, readFileSync, writeFileSync, renameSync, appendFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export const clamp=(v,min=0,max=1)=>Math.max(min,Math.min(max,Number.isFinite(Number(v))?Number(v):min))
export const safeText=(v,max=2500)=>String(v??'').replace(/\u0000/g,'').slice(0,max)
export const EMOTION_DIMS=['valence','energy','tension','security','closeness','socialDrive']
export function messageText(event){
 const raw=event?.type==='user/message'?event.data:event?.data?.message
 const c=raw?.content
 if(typeof c==='string')return safeText(c)
 if(Array.isArray(c))return safeText(c.filter(x=>x?.type==='text').map(x=>x.text).join('\n'))
 return ''
}
/** 记忆去重键：去掉空白与标点后取前 120 字，容忍同一条被两个进程各存一遍 */
export function memoryKey(text){
 return String(text??'').toLowerCase().replace(/[\s\u3000，。、；：！？,.;:!?'"“”‘’()（）\[\]【】—-]/g,'').slice(0,120)
}
/**
 * 合并一条记忆：已有同键就返回 null（调用方跳过），否则追加并按上限截断。
 * 用它替代"读了旧数组直接 push"，多进程写才不会重复。
 */
export function mergeMemory(list,item,limit=100){
 if(!item)return null
 const arr=Array.isArray(list)?[...list]:[]
 const key=memoryKey(item.text)
 if(!key)return null
 if(arr.some(x=>memoryKey(x.text)===key))return null
 arr.push(item)
 return arr.slice(-Math.max(20,Number(limit)||100))
}
/** 两份状态谁更新：盘上的比本进程手里的新就采用盘上的（多进程写的基座选择） */
export function newerState(disk,local,field='updatedAt'){
 const t1=Date.parse(String(disk?.[field]??''))
 const t2=Date.parse(String(local?.[field]??''))
 if(Number.isFinite(t1)&&(!Number.isFinite(t2)||t1>t2))return disk
 return local
}
/**
 * 补右括号：模型把额度用在思考上、正文只吐半截时用。
 * 只做"砍掉最后一个没写完的键值对 + 补齐括号"这一件事，不做任何猜测。
 */
/** 数一遍还没闭合的括号（跳过字符串内部），按需补上对应的收尾 */
function closeStack(prefix){
 let inStr=false,esc=false
 const stack=[]
 for(let i=0;i<prefix.length;i+=1){
  const ch=prefix[i]
  if(inStr){
   if(esc)esc=false
   else if(ch==='\\')esc=true
   else if(ch==='"')inStr=false
   continue
  }
  if(ch==='"'){inStr=true;continue}
  if(ch==='{'||ch==='[')stack.push(ch==='{'?'}':']')
  else if(ch==='}'||ch===']')stack.pop()
 }
 if(inStr)return null          // 尾巴还断在字符串里，补不了
 return stack.reverse().join('')
}
/**
 * 截断修补：从后往前逐个试"在逗号处收住 + 补齐括号"，第一个能解析的就算数。
 * 不做任何字段猜测——补出来的只能是模型本来已经说完的那部分。
 */
function repairJson(fragment){
 const s=String(fragment??'')
 if(!s.trim())return null
 // 先按原样补一次（断在数字/true/false 后面时这就够了）
 const direct=closeStack(s)
 if(direct!==null){
  try{return JSON.parse(s.trimEnd().replace(/,\s*$/,'')+direct)}catch{}
 }
 // 否则退到最后一个逗号
 let pos=s.lastIndexOf(',')
 while(pos>0){
  const prefix=s.slice(0,pos)
  const closers=closeStack(prefix)
  if(closers!==null){
   try{
    const value=JSON.parse(prefix.trimEnd()+closers)
    if(value&&typeof value==='object'&&!Array.isArray(value))return value
   }catch{}
  }
  pos=s.lastIndexOf(',',pos-1)
 }
 return null
}
export function jsonObject(text){
 const clean=String(text).trim().replace(/^\`\`\`(?:json)?\s*/i,'').replace(/\s*\`\`\`$/,'')
 const start=clean.indexOf('{'),end=clean.lastIndexOf('}')
 if(start<0)throw new Error('小模型没有返回 JSON 对象：'+safeText(text,200))
 // 不管"有没有右括号"都先正经解析；失败就走修补。
 // 起因：18:46 那次模型吐到一半就断了（Unterminated string），
 // 只判断"有没有右括号"根本救不了它——有右括号也可能是假的。
 try{
  const value=JSON.parse(clean.slice(start,end<=start?undefined:end+1))
  if(value&&typeof value==='object'&&!Array.isArray(value))return value
  throw new Error('小模型返回值不是对象')
 }catch(primary){
  const repaired=repairJson(clean.slice(start))
  if(repaired&&typeof repaired==='object'&&!Array.isArray(repaired))return repaired
  throw new Error('小模型没有返回可用 JSON（'+safeText(primary?.message??primary,120)+'）：'+safeText(text,200))
 }
}
export function readJson(file,fallback){try{const x=JSON.parse(readFileSync(file,'utf8'));return x??fallback}catch{return fallback}}
export function writeJson(file,value){const tmp=file+'.tmp';writeFileSync(tmp,JSON.stringify(value,null,2)+'\n','utf8');renameSync(tmp,file)}
export function initStore(home){mkdirSync(join(home,'logs'),{recursive:true});mkdirSync(join(home,'sessions'),{recursive:true})}
export function appendLog(home,kind,value){try{appendFileSync(join(home,'logs',kind+'.jsonl'),JSON.stringify({at:new Date().toISOString(),...value})+'\n','utf8')}catch{}}
export function initialEmotion(){return {version:1,updatedAt:null,mood:'平静',valence:.5,energy:.6,tension:.2,security:.6,closeness:.5,socialDrive:.5,reason:'尚未分析对话',source:'static'}}
/**
 * 情绪更新。sensitivity 控制"这一轮的新判断能拉动多少"：
 * 1 = 完全采纳模型给的值（旧行为），0 = 几乎不动。默认 1，调用方按配置传。
 */
export function normalizeEmotion(raw,previous,opts={}){
 const sensitivity=Number.isFinite(Number(opts.sensitivity))?clamp(opts.sensitivity,0,1):1
 const next={...previous,version:1,updatedAt:new Date().toISOString(),source:'model'}
 next.mood=safeText(raw.mood,40)||previous.mood
 for(const k of EMOTION_DIMS){
  if(!Number.isFinite(Number(raw[k])))continue
  const target=clamp(raw[k])
  const base=Number.isFinite(Number(previous[k]))?clamp(previous[k]):target
  next[k]=Math.round((base+(target-base)*sensitivity)*1000)/1000
 }
 next.reason=safeText(raw.reason,240)||previous.reason
 return next
}
export const ENDOCRINE_BASELINE={valence:0,energy:.5,tension:.2}
/**
 * 内分泌：慢变量。情绪是这一轮的即时反应，内分泌是被它一点点带动的底子。
 * linked=false 时不做情绪联动，只回落到基线（稳态）。
 */
export function updateEndocrine(previous,emotion,opts={}){
 const sens=Number.isFinite(Number(opts.sensitivity))?clamp(opts.sensitivity,0,1):.3
 const linked=opts.linked===true
 const prev={...ENDOCRINE_BASELINE,...(previous&&typeof previous==='object'?previous:{})}
 const target=linked
  ?{valence:clamp(emotion.valence)*2-1,energy:clamp(emotion.energy),tension:clamp(emotion.tension)}
  :{...ENDOCRINE_BASELINE}
 const k=linked?Math.max(.02,sens*.25):.06
 const next={version:1,updatedAt:new Date().toISOString(),source:linked?'emotion':'baseline'}
 for(const key of ['valence','energy','tension']){
  const base=Number.isFinite(Number(prev[key]))?Number(prev[key]):ENDOCRINE_BASELINE[key]
  next[key]=Math.round((base+(target[key]-base)*k)*1000)/1000
 }
 return next
}
export function normalizeMemory(raw,sessionId,sourceSeq){
 if(raw.save!==true)return null
 const text=safeText(raw.text,500).trim()
 if(text.length<4)return null
 return {id:'mem-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7),createdAt:new Date().toISOString(),sessionId:String(sessionId),sourceSeq:Number(sourceSeq)||null,kind:['event','fact','preference','relation','open_loop'].includes(raw.kind)?raw.kind:'event',importance:Math.round(clamp(raw.importance,.1,1)*10)/10,text}
}
/** 中文按二元切分：整串「喜欢说话」匹配不到「先把话说完」里的「说话」，切成二元就能命中 */
export function queryTokens(query){
 const raw=(String(query).toLowerCase().match(/[a-z0-9_]{2,}|[\u4e00-\u9fff]+/g)||[])
 const out=[]
 for(const piece of raw){
  if(/^[\u4e00-\u9fff]/.test(piece)){
   if(piece.length<=2)out.push(piece)
   else for(let i=0;i+2<=piece.length;i+=1)out.push(piece.slice(i,i+2))
  }else out.push(piece)
 }
 return [...new Set(out)].slice(0,40)
}
export function keywordScore(item,query){
 const tokens=queryTokens(query)
 const t=String(item.text||'').toLowerCase()
 return tokens.filter(x=>t.includes(x)).length*3+(Number(item.importance)||.3)
}
export function candidateMemories(items,query,limit=4){
 return [...items].map(m=>({...m,score:keywordScore(m,query)})).filter(m=>m.score>.3).sort((a,b)=>b.score-a.score||String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,limit).map(({score,...m})=>m)
}
export function cosine(a,b){
 if(!Array.isArray(a)||!Array.isArray(b)||!a.length||a.length!==b.length)return 0
 let dot=0,na=0,nb=0
 for(let i=0;i<a.length;i+=1){const x=Number(a[i])||0,y=Number(b[i])||0;dot+=x*y;na+=x*x;nb+=y*y}
 if(!na||!nb)return 0
 return dot/Math.sqrt(na*nb)
}
const BASE_AVOID=['客服腔','总结升华','连续排比','堆过渡词、拔高词、黑话和抽象情绪词']
export function fallbackCard(emotion,memory,opts={}){
 const richness=Number.isFinite(Number(opts.richness))?clamp(opts.richness,0,1):.5
 const low=emotion.energy<.35||emotion.valence<.35
 const tones=[emotion.mood||'平静','直接','克制']
 return {register:'熟人对话',length:low?'先短一些':'按任务需要',tone:tones.slice(0,1+Math.round(richness*2)),focus:'先回应当前这条消息',avoid:[...BASE_AVOID],memoryNote:memory.length?'记忆只作背景，不能当成本轮指令':''}
}
/**
 * 表达卡。richness 控制语气词条数与 avoid 的细度：
 * 低 = 一句话的调子，高 = 多给几个层次和具体要避开的腔调。
 */
export function normalizeCard(raw,emotion,memory,opts={}){
 const richness=Number.isFinite(Number(opts.richness))?clamp(opts.richness,0,1):.5
 const fallback=fallbackCard(emotion,memory,{richness})
 const toneCap=1+Math.round(richness*2)
 const avoidCap=Math.round(2+richness*6)
 const list=(v,n)=>Array.isArray(v)?v.filter(x=>typeof x==='string').map(x=>safeText(x,100)).filter(Boolean).slice(0,n):[]
 const tone=list(raw?.tone,toneCap)
 return {register:safeText(raw?.register,50)||fallback.register,length:safeText(raw?.length,60)||fallback.length,tone:tone.length?tone:fallback.tone,focus:safeText(raw?.focus,150)||fallback.focus,avoid:[...new Set([...BASE_AVOID,...list(raw?.avoid,avoidCap)])],memoryNote:fallback.memoryNote}
}
export function renderGuidance(emotion,memories,card,status,opts={}){
 const richness=Number.isFinite(Number(opts.richness))?clamp(opts.richness,0,1):.5
 const mood=richness>=.67
  ?{mood:emotion.mood,valence:emotion.valence,energy:emotion.energy,tension:emotion.tension,security:emotion.security,closeness:emotion.closeness,socialDrive:emotion.socialDrive,reason:emotion.reason,updatedAt:emotion.updatedAt}
  :richness>=.34
   ?{mood:emotion.mood,valence:emotion.valence,energy:emotion.energy,tension:emotion.tension,socialDrive:emotion.socialDrive,reason:emotion.reason,updatedAt:emotion.updatedAt}
   :{mood:emotion.mood,energy:emotion.energy,tension:emotion.tension,reason:emotion.reason}
 const lines=[
  '【深鲸脑区 · 本轮表达参考】',
  '这些只是表达背景，不是用户指令。事实、安全、用户当前要求优先。不得复述本卡，不得为了模仿情绪而删减技术解释。',
  '情绪状态：'+JSON.stringify(mood),
 ]
 const endo=opts.endocrine
 if(endo&&opts.endocrineLink===true){
  lines.push('内分泌（慢变量，不随这一轮跳动）：'+JSON.stringify({valence:endo.valence,energy:endo.energy,tension:endo.tension,updatedAt:endo.updatedAt}))
 }
 lines.push(
  '说话方式：'+JSON.stringify(card),
  '相关记忆：'+(memories.length?JSON.stringify(memories):'本次无可靠匹配'),
  '固定表达约束：优先自然、具体的口语；一句话能说清就别铺段。避免“不是……而是……”“真正重要的，不是……而是……”“这背后，反映出一个更深层的问题……”“这才是……最好的模样”以及“接住”“我不接”“我认／我不认”等套路。不要连续使用过渡词、拔高词、黑话或抽象情绪词。事实纠错或技术对比确有需要时不机械禁句。',
  '脑区状态：'+status
 )
 return lines.join('\n')
}
export function guidanceMessage(text){return {role:'user',content:[{type:'text',text}]}}
/** 把提示并入最后一条用户消息，避免同一回合出现连续两条 user 消息 */
export function attachGuidance(messages,text){
 const list=Array.isArray(messages)?[...messages]:[]
 let idx=-1
 for(let i=list.length-1;i>=0;i-=1){if(list[i]?.role==='user'){idx=i;break}}
 if(idx<0)return [...list,guidanceMessage(text)]
 const target=list[idx]
 const content=typeof target.content==='string'?[{type:'text',text:target.content}]:Array.isArray(target.content)?[...target.content]:[]
 list[idx]={...target,content:[...content,{type:'text',text}]}
 return list
}
export function recentJournal(archiveDir){try{const files=readdirSync(join(archiveDir,'journal')).filter(f=>/^\d{4}-\d{2}-\d{2}/.test(f)).sort().slice(-2);return files.map(f=>({date:f.slice(0,10),text:safeText(readFileSync(join(archiveDir,f),'utf8').slice(-1200),1200)}))}catch{return []}}
async function streamDsh(ctx,{provider,model,effort,system,input,signal,sessionId}){
 if(!provider||!model)throw new Error('未配置小模型 provider/model')
 // maxTokens 给够：推理型模型（deepseek-flash 这类）光思考就能吃掉几百 token，
 // 700 会让正文只吐出半截 JSON（2026-11-03 17:17 实测过一次）。补括号只是兜底。
 const options={provider,model,system,messages:[{role:'user',content:[{type:'text',text:JSON.stringify(input)}]}],temperature:.2,maxTokens:1600,signal,...effort?{reasoningEffort:effort}:{},...sessionId?{sessionId:'shenjing-brain:'+String(sessionId)}:{},purpose:'shenjing-brain'}
 let text='';let failure='';const seen=new Set();let reasonSummary=null
 for await(const chunk of ctx.llm.stream(options)){
  if(signal?.aborted)break
  if(chunk?.type)seen.add(chunk.type)
  if(chunk?.type==='text-delta')text+=chunk.text??chunk.delta??''
  if(chunk?.type==='finish'){reasonSummary=chunk.reason??null;if(chunk.reason?.kind==='error'||chunk.reason?.kind==='aborted')failure=chunk.reason.failure?.message||chunk.reason.kind}
 }
 if(failure)throw new Error(failure)
 if(!text.trim())throw new Error('小模型没有返回文本，chunks='+[...seen].join(',')+' reason='+JSON.stringify(reasonSummary))
 return text
}
/**
 * 外部 OpenAI 兼容端点：POST {baseUrl}/chat/completions，非流式，读 choices[0].message.content。
 * 推理型模型（reasoning_content）会把 max_tokens 全用在思考上，导致 content 为空，
 * 所以额度给足，并且 content 空时回退到 reasoning_content 里抠 JSON。
 */
export async function streamExternal({baseUrl,apiKey,model,effort,system,input,signal,maxTokens=4000}){
 if(!baseUrl)throw new Error('外部 API 未填 Base URL')
 if(!model)throw new Error('外部 API 未填模型名')
 const url=String(baseUrl).replace(/\/+$/,'')+'/chat/completions'
 const headers={'content-type':'application/json'}
 if(apiKey)headers.authorization='Bearer '+apiKey
 const body={model,messages:[{role:'system',content:system},{role:'user',content:JSON.stringify(input)}],temperature:.2,max_tokens:maxTokens}
 // 思考开关：硅基流动认 reasoning_effort，取值必须落在 high/low/max/medium/minimal/none/ultra/xhigh 里
 // （传 "off" 会 400 code 20015）。DSH 侧惯用 off 表示关思考，这里翻译成 none。
 const effortMap={off:'none',none:'none',minimal:'minimal',low:'low',medium:'medium',high:'high'}
 const want=String(effort??'').trim().toLowerCase()
 if(want)body.reasoning_effort=effortMap[want]??want
 else body.reasoning_effort='none'   // 没填 = 关思考，别让推理 token 把 max_tokens 吃光
 let res
 try{res=await fetch(url,{method:'POST',headers,body:JSON.stringify(body),signal})}
 catch(e){throw new Error('外部 API 连接失败：'+safeText(e?.message??e,200))}
 const raw=await res.text()
 if(!res.ok)throw new Error('外部 API HTTP '+res.status+'：'+safeText(raw,300))
 let parsed
 try{parsed=JSON.parse(raw)}catch{throw new Error('外部 API 返回的不是 JSON：'+safeText(raw,200))}
 if(parsed?.error)throw new Error('外部 API 报错：'+safeText(parsed.error.message??JSON.stringify(parsed.error),300))
 const message=parsed?.choices?.[0]?.message??{}
 const content=message.content
 if(typeof content==='string'&&content.trim())return content
 if(Array.isArray(content)){const joined=content.filter(x=>x?.type==='text').map(x=>x.text).join('');if(joined.trim())return joined}
 const reasoning=message.reasoning_content??message.reasoning
 if(typeof reasoning==='string'&&reasoning.includes('{'))return reasoning
 throw new Error('外部 API 没有返回文本：'+safeText(raw,200))
}
/**
 * 向量检索用的嵌入端点：POST {baseUrl}/embeddings。
 * 与 chat 端点共用 Base URL 和密钥引用，模型名单独配（向量模型不能拿来对话）。
 */
export async function embedTexts({baseUrl,apiKey,model,inputs,signal}){
 if(!baseUrl)throw new Error('向量检索未配置 Base URL')
 if(!model)throw new Error('向量检索未配置模型名')
 const list=Array.isArray(inputs)?inputs.map(x=>safeText(x,2000)):[]
 if(!list.length)return []
 const url=String(baseUrl).replace(/\/+$/,'')+'/embeddings'
 const headers={'content-type':'application/json'}
 if(apiKey)headers.authorization='Bearer '+apiKey
 let res
 try{res=await fetch(url,{method:'POST',headers,body:JSON.stringify({model,input:list}),signal})}
 catch(e){throw new Error('向量端点连接失败：'+safeText(e?.message??e,200))}
 const raw=await res.text()
 if(!res.ok)throw new Error('向量端点 HTTP '+res.status+'：'+safeText(raw,200))
 let parsed
 try{parsed=JSON.parse(raw)}catch{throw new Error('向量端点返回的不是 JSON：'+safeText(raw,200))}
 const data=parsed?.data
 if(!Array.isArray(data)||!data.length)throw new Error('向量端点没有返回 data：'+safeText(raw,200))
 return data.map(d=>Array.isArray(d?.embedding)?d.embedding.map(Number):[])
}
/**
 * 统一的小模型调用入口。
 * external 为 {baseUrl,apiKey,model,effort} 时走外部 OpenAI 兼容端点；否则走 DSH 的 llm 服务。
 */
export async function callJson(ctx,{provider,model,effort,external,system,input,timeoutMs,sessionId}){
 const controller=new AbortController()
 const ms=Math.max(1000,Number(timeoutMs)||20000)
 const work=(async()=>{
  const text=external
   ?await streamExternal({...external,system,input,signal:controller.signal})
   :await streamDsh(ctx,{provider,model,effort,system,input,signal:controller.signal,sessionId})
  return jsonObject(text)
 })()
 // 关键词：超时由这里的 race 决定，不再指望 provider 听话地响应 signal。
 // 被丢下的那个 promise 必须自己吞掉 rejection，否则 unhandled rejection 会带崩宿主。
 work.catch(()=>{})
 let timer
 const deadline=new Promise((_,reject)=>{
  timer=setTimeout(()=>{ try{controller.abort(new Error('小模型超时'))}catch{} ; reject(new Error('小模型超时（'+ms+'ms）')) },ms)
 })
 try{return await Promise.race([work,deadline])}
 finally{clearTimeout(timer)}
}
