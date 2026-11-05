import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initStore,writeJson,readJson,messageText,jsonObject,initialEmotion,normalizeEmotion,updateEndocrine,ENDOCRINE_BASELINE,normalizeMemory,mergeMemory,newerState,memoryKey,candidateMemories,keywordScore,cosine,normalizeCard,renderGuidance,guidanceMessage,callJson,embedTexts } from './lib/core.mjs'
const home=mkdtempSync(join(tmpdir(),'shenjing-brain-'));initStore(home)
const file=join(home,'state.json');writeJson(file,{ok:true});assert.deepEqual(readJson(file,{}),{ok:true})
assert.equal(messageText({type:'user/message',data:{content:[{type:'text',text:'你好'}]}}),'你好')
assert.deepEqual(jsonObject('\`\`\`json\n{"a":1}\n\`\`\`'),{a:1})
const base=initialEmotion()
const emo=normalizeEmotion({mood:'低落',energy:.2,tension:9},base);assert.equal(emo.tension,1);assert.equal(emo.energy,.2)
// 敏感度：0 时几乎不动，1 时完全采纳
const still=normalizeEmotion({mood:'亢奋',energy:1},base,{sensitivity:0});assert.equal(still.energy,base.energy)
const full=normalizeEmotion({mood:'亢奋',energy:1},base,{sensitivity:1});assert.equal(full.energy,1)
const half=normalizeEmotion({mood:'亢奋',energy:1},base,{sensitivity:.5});assert.ok(Math.abs(half.energy-(base.energy+1)/2)<1e-9)
// 内分泌：联动时朝情绪走，不联动时回基线
const hot=updateEndocrine({...ENDOCRINE_BASELINE,energy:.2},{valence:.9,energy:.9,tension:.1},{sensitivity:1,linked:true})
assert.ok(hot.energy>.2);assert.equal(hot.source,'emotion')
const cool=updateEndocrine({valence:.9,energy:.9,tension:.1},{valence:.1,energy:.1,tension:.9},{sensitivity:1,linked:false})
assert.ok(cool.energy<.9);assert.equal(cool.source,'baseline')
const m=normalizeMemory({save:true,kind:'preference',importance:.8,text:'喜欢先把话说完'},'s1',7);assert.equal(m.sourceSeq,7)
assert.equal(normalizeMemory({save:true,text:'  '},'s1',1),null)
assert.equal(candidateMemories([m],'喜欢说话',1).length,1)
assert.ok(keywordScore(m,'喜欢说话')>keywordScore(m,'完全无关的词'))
assert.equal(cosine([1,0],[1,0]),1);assert.equal(cosine([1,0],[0,1]),0);assert.equal(cosine([1],[1,2]),0)
const card=normalizeCard({},emo,[m]);const text=renderGuidance(emo,[m],card,'test');assert.ok(text.includes('不是……而是……'));assert.equal(guidanceMessage(text).role,'user')
// 丰富度：低档只给 mood/energy/tension，高档给全六维；内分泌行只在联动时出现
const lean=renderGuidance(emo,[m],normalizeCard({},emo,[m],{richness:0}),'t',{richness:0,endocrine:hot,endocrineLink:false})
const rich=renderGuidance(emo,[m],normalizeCard({},emo,[m],{richness:1}),'t',{richness:1,endocrine:hot,endocrineLink:true})
assert.ok(!lean.includes('socialDrive'));assert.ok(rich.includes('socialDrive'))
assert.ok(!lean.includes('内分泌（慢变量'));assert.ok(rich.includes('内分泌（慢变量'))
assert.ok(normalizeCard({tone:['a','b','c','d']},emo,[],{richness:0}).tone.length<=1)
const ctx={llm:{stream:async function*(){yield {type:'text-delta',text:'{"save":false}'};yield {type:'finish',reason:{kind:'stop'}}}}}
assert.deepEqual(await callJson(ctx,{provider:'p',model:'m',system:'s',input:{},timeoutMs:1000,sessionId:'s'}),{save:false})
await assert.rejects(()=>callJson(ctx,{provider:'',model:'',system:'s',input:{},timeoutMs:1000,sessionId:'s'}),/未配置/)
await assert.rejects(()=>embedTexts({baseUrl:'',model:'x',inputs:['a']}),/未配置 Base URL/)
// ── 超时：provider 无视 signal 也必须按时 reject（关键词：尺子不能靠 provider 配合）
const hung=async function*(){ await new Promise(()=>{}); yield{type:'finish',reason:{kind:'stop'}} }
const hungCtx={llm:{stream:hung}}
const t0=Date.now()
await assert.rejects(()=>callJson(hungCtx,{provider:'p',model:'m',system:'s',input:{},timeoutMs:1000,sessionId:'s'}),/小模型超时/)
assert.ok(Date.now()-t0<2500,'卡死的流必须被 race 掐断')
assert.equal(mergeMemory([m],m,10),null,'同一条记忆不许存两遍')
const m2=normalizeMemory({save:true,kind:'event',importance:.5,text:'另一条完全不同的记忆内容'},'s1',9)
assert.equal(mergeMemory([m],m2,10).length,2,'不同记忆要并进去')
assert.equal(newerState({updatedAt:'2026-01-02T00:00:00Z'},{updatedAt:'2026-01-01T00:00:00Z'}).updatedAt,'2026-01-02T00:00:00Z','盘上更新就用盘上的')
assert.equal(newerState({updatedAt:'2026-01-01T00:00:00Z'},{updatedAt:'2026-01-02T00:00:00Z'}).updatedAt,'2026-01-02T00:00:00Z','手里更新就留手里的')
assert.equal(newerState({updatedAt:'坏时间'},{updatedAt:'2026-01-02T00:00:00Z'}).updatedAt,'2026-01-02T00:00:00Z','时间解析不了时不许把好状态顶掉')
// 截断的 JSON 要能补，不能整段丢掉（17:17 那次 maxTokens 被思考吃掉，情绪白丢一轮）
assert.deepEqual(jsonObject('{"mood":"测试落定","valence":0.64,"energy'),{mood:'测试落定',valence:0.64})
assert.deepEqual(jsonObject('{"a":1,"b":"半截'),{a:1})
// 18:46 那次是"有右括号但字符串没闭合"（Unterminated string）——只判断有没有右括号救不了
const cut = jsonObject('{"register":"熟人","tone":["平静","自然"],"avoid":["客服腔"')
assert.equal(cut.register,'熟人'); assert.deepEqual(cut.tone,['平静','自然'])
assert.deepEqual(cut.avoid,['客服腔'],'已经写完的那半截要保住，不能整段丢')
console.log('shenjing-brain selfcheck: 37 assertions passed（接口层另测：无 pending 会话也给脑区段、组装不阻塞、队列不死）')
