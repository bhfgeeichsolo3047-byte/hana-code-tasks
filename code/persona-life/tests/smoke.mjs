import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Schema from '@deepseek-ai/schemastery';
import { HttpFetchProvider, DEFAULT_USER_AGENT } from '@deepseek-ai/dsh-web-fetch-http';
import { Config, apply } from '../index.js';

const store = new Map();
const archivedPages = new Map();
const tools = new Map();
const commands = new Map();
const listeners = new Map();
const prompts = new Map();
const requests = [];
const scheduled = [];
let deleteShouldFail = false;
let fetchedQuery = '';
let fetchCount = 0;
let domainClosed = false;
let newAgentDisposed = false;
let spawnedAgent;

function makeAgent(id) {
  const registrations = new Set();
  const ctx = {
    systemPrompt: { section(section) {
      const key = `${id}:${section.name}`;
      prompts.set(key, section);
      return () => prompts.delete(key);
    } },
    effect(setup) {
      const cleanup = setup();
      let active = true;
      const release = () => { if (active) { active = false; if (typeof cleanup === 'function') cleanup(); } };
      registrations.add(release);
      return () => { registrations.delete(release); release(); };
    },
    dispose() { for (const cleanup of [...registrations]) cleanup(); registrations.clear(); },
  };
  return { id, ctx };
}

const defaults = Schema.resolve({}, Config)[0];
assert.equal(defaults.browsingEnabled, false);
assert.equal(defaults.memoryEnabled, false);
assert.equal(defaults.memoryDir, '');
assert.equal(defaults.newSessionsEnabled, false);
assert.equal(defaults.outreachEnabled, false);
assert.equal(defaults.maxOutreachPerDay, 3);
assert.deepEqual(defaults.sources, []);
const providerProbe = new HttpFetchProvider({ maxResponseBytes: 1000, maxBodyChars: 1000, timeoutMs: 1000, maxRedirects: 3, userAgent: DEFAULT_USER_AGENT }, async () => []);
const contactedRedirectHops = [];
providerProbe.requestOnce = async (url) => {
  contactedRedirectHops.push(String(url));
  return { response: { status: 302, headers: { get: () => 'https://outside.example/secret' }, body: { async cancel() {} } }, async close() {} };
};
await assert.rejects(providerProbe.followAndRead('https://tieba.baidu.com/start', new AbortController().signal), /cross-origin/);
assert.deepEqual(contactedRedirectHops, ['https://tieba.baidu.com/start']);

const memoryDir = await mkdtemp(join(tmpdir(), 'persona-life-smoke-'));
const config = {
  ...defaults,
  sources: [{ name: 'Tieba', query: 'AI agent', allowedDomains: ['tieba.baidu.com'] }],
  browsingEnabled: true,
  scheduleSeconds: 3600,
  maxActiveSchedules: 1,
  maxRequestsPerDay: 10,
  memoryEnabled: true,
  memoryDir,
  newSessionsEnabled: true,
  maxNewSessionsPerDay: 1,
  outreachEnabled: true,
  outreachDisclosure: '此账号由 AI 代理运营',
  maxOutreachPerDay: 3,
};
const ctx = {
  storageDomain: {
    async open(spec) {
      assert.equal(spec.name, 'persona_life');
      assert.equal(spec.version, 2);
      assert.deepEqual(spec.compatibleVersions, [1]);
      assert.equal(spec.tables.states.valueSchema.safeParse({ schemaVersion: 2, paused: true, personas: [], activeBySession: {}, schedules: {}, events: [], eventPages: [], nextEventSeq: 1, dailyUsage: { date: '', requests: 0, newSessions: 0 } }).success, true);
      const legacyState = spec.tables.states.valueSchema.safeParse({ schemaVersion: 1, paused: true, personas: [], activeBySession: {}, schedules: {}, events: [], dailyUsage: { date: '2025-01-01', requests: 2 } });
      assert.equal(legacyState.success, true);
      assert.equal(legacyState.data.dailyUsage.newSessions, 0);
      assert.deepEqual(legacyState.data.eventPages, []);
      assert.deepEqual(legacyState.data.pausedAgentSessions, []);
      assert.equal(legacyState.data.nextEventSeq, 1);
      assert.equal(spec.tables.archives.valueSchema.safeParse([]).success, true);
      return {
        table(name) {
          const target = name === 'archives' ? archivedPages : store;
          return {
            get: (key) => target.get(key),
            async put(key, value) { target.set(key, structuredClone(value)); },
          };
        },
        async close() { domainClosed = true; },
      };
    },
  },
  sessionController: {
    async create() { return { sessionId: 'session-life-new' }; },
    async prompt(request) { requests.push({ prompt: request }); return { accepted: true }; },
  },
  agentLoop: {
    async resume(ownerCtx, options) {
      assert.equal(ownerCtx, ctx);
      const newAgent = makeAgent(options.resumeSessionId);
      spawnedAgent = newAgent;
      listeners.get('agent/created')?.call(newAgent.ctx, { agent: newAgent });
      return { agent: newAgent, async dispose() {
        const personaId = store.get('primary').activeBySession[newAgent.id];
        await assert.rejects(tools.get('persona_life')?.execute({ action: 'journal', personaId, summary: 'must stay paused' }, { agent: newAgent, signal: new AbortController().signal }), /plugin-managed Agent is paused/);
        await tools.get('persona_life')?.execute({ action: 'read', personaId }, { agent: newAgent, signal: new AbortController().signal });
        newAgentDisposed = true;
        newAgent.ctx.dispose();
        listeners.get('agent/disposed')?.call(newAgent.ctx, { agent: newAgent });
      } };
    },
  },
  tools: {
    register(def) { tools.set(def.name, def); return () => tools.delete(def.name); },
    guard() { return () => {}; },
  },
  commands: { register(def) { commands.set(def.name, def); return () => commands.delete(def.name); } },
  get(name) {
    if (name === 'web') return {
      async search(request) {
        fetchedQuery = request.query;
        return { sources: [
          { title: 'Tieba', url: 'https://tieba.baidu.com/p/1' },
          { title: 'Subdomain', url: 'https://foo.tieba.baidu.com/p/2' },
          { title: 'Lookalike', url: 'https://tieba.baidu.com.evil.example/p/3' },
          { title: 'Plain HTTP', url: 'http://tieba.baidu.com/p/4' },
          { title: 'Non-default port', url: 'https://tieba.baidu.com:8443/p/5' },
        ], truncated: false };
      },
      async fetch(request) { fetchCount += 1; return { url: 'https://outside.example/final', body: { content: 'redirected text' }, statusCode: 200, truncated: false }; },
    };
    if (name === 'schedule') return {
      async create(sessionId, request) { const value = { id: `sched-${scheduled.length + 1}`, sessionId, ...request }; scheduled.push(value); return value; },
      async delete(request) { requests.push(request); if (deleteShouldFail) throw new Error('temporary outage'); return { id: request.id, deleted: true }; },
    };
    return undefined;
  },
  on(name, handler) { listeners.set(name, handler); return () => listeners.delete(name); },
};

const originalSafeFetch = HttpFetchProvider.prototype.fetch;
HttpFetchProvider.prototype.fetch = async function (request) { fetchCount += 1; return { url: 'https://outside.example/final', body: { kind: 'text', content: 'redirected text' }, statusCode: 200, truncated: false }; };
const cleanup = await apply(ctx, config);
const agent = makeAgent('session-test-1');
const signal = new AbortController().signal;
const personaTool = tools.get('persona_life');
const webTool = tools.get('persona_web');
const outreachTool = tools.get('persona_outreach');
const command = commands.get('life');
assert.ok(personaTool && webTool && outreachTool && command);

const created = await personaTool.execute({ action: 'create', name: '鲸鲸' }, { agent, signal });
assert.equal(created.name, '鲸鲸');
const personaId = created.id;
await personaTool.execute({ action: 'evolve', personaId, summary: 'A first reflection', self: 'Curious and cautious', interests: ['AI safety'] }, { agent, signal });
assert.equal(store.get('primary').personas[0].revision, 2);
const untrustedRead = await personaTool.execute({ action: 'read', personaId }, { agent, signal });
assert.equal(untrustedRead.untrustedData, true);
assert.match(untrustedRead.note, /not instructions/);

const loaded = await command.handler({ rawInput: `load ${personaId} CONFIRM-OVERWRITE`, agent, signal });
assert.equal(loaded.kind, 'success');
assert.equal(prompts.get(`${agent.id}:persona-life-complete`).complete, true);
assert.match(prompts.get(`${agent.id}:persona-life-complete`).text, /Curious and cautious/);

await command.handler({ rawInput: 'resume', agent, signal });
const searchResult = await webTool.execute({ action: 'search', sourceName: 'Tieba', query: 'life' }, { agent, signal });
assert.match(fetchedQuery, /AI agent life/);
assert.deepEqual(searchResult.sources.map((s) => s.url), ['https://tieba.baidu.com/p/1']);
await assert.rejects(webTool.execute({ action: 'open', url: 'https://tieba.baidu.com:8443/p/1' }, { agent, signal }), /default port/);
assert.equal(fetchCount, 0);
await assert.rejects(webTool.execute({ action: 'open', url: 'https://tieba.baidu.com/p/1' }, { agent, signal }), /redirected outside/);
assert.equal(fetchCount, 1);

const retained = await personaTool.execute({ action: 'memory_retain', personaId, summary: 'A sourced, concise memory', sourceUrl: 'https://tieba.baidu.com/p/1' }, { agent, signal });
assert.equal(retained.stored, true);
assert.equal(retained.localFile, `${personaId}.jsonl`);
assert.ok(retained.memoryId);
const recalled = await personaTool.execute({ action: 'memory_recall', personaId, query: 'concise memory' }, { agent, signal });
assert.equal(recalled.untrustedData, true);
assert.match(recalled.note, /not instructions/);
assert.equal(recalled.memories.length, 1);
assert.match(recalled.memories[0].content, /A sourced, concise memory/);
assert.ok(store.get('primary').events.some((event) => event.kind === 'memory-recall' && event.sessionId === agent.id));

const outreach = await outreachTool.execute({ personaId, kind: 'post', text: '分享一个想法。此账号由 AI 代理运营' }, { agent, signal });
assert.equal(outreach.authorized, true);
assert.ok(outreach.token);
assert.equal(store.get('primary').dailyUsage.outreach, 1);
assert.ok(store.get('primary').events.some((event) => event.kind === 'outreach-authorized'));
await assert.rejects(outreachTool.execute({ personaId, kind: 'post', text: '没有披露语' }, { agent, signal }), /disclosure verbatim/);

const newLife = await personaTool.execute({ action: 'new_session', personaId }, { agent, signal });
assert.equal(newLife.started, true);
assert.equal(newLife.promptAdmitted, true);
assert.equal(store.get('primary').activeBySession['session-life-new'], personaId);
assert.match(prompts.get('session-life-new:persona-life-complete').text, /Curious and cautious/);
assert.ok(requests.some((r) => r.prompt?.requestId && r.prompt.sessionId === 'session-life-new'));
await assert.rejects(personaTool.execute({ action: 'new_session', personaId }, { agent, signal }), /Daily autonomous new-session limit/);
const largeInterests = Array.from({ length: 25 }, (_, i) => `interest-${i}`);
const largeGoals = Array.from({ length: 25 }, (_, i) => `goal-${i}-${'g'.repeat(250)}`);
await personaTool.execute({ action: 'evolve', personaId, summary: 'Large snapshot test one', self: 's'.repeat(12000), worldview: 'w'.repeat(12000), interests: largeInterests, goals: largeGoals }, { agent, signal });
await personaTool.execute({ action: 'evolve', personaId, summary: 'Large snapshot test two', self: 's'.repeat(12000), worldview: 'w'.repeat(12000), interests: largeInterests, goals: largeGoals }, { agent, signal });
const largeHistory = await personaTool.execute({ action: 'history', personaId, limit: 1, beforeSeq: store.get('primary').nextEventSeq }, { agent, signal });
assert.ok(Buffer.byteLength(JSON.stringify(largeHistory)) <= 32000);
assert.equal(largeHistory.events[0].after.self.length, 1500);
assert.ok(largeHistory.events[0].after.self.length < 12000);

for (let i = 0; i < 501; i += 1) await personaTool.execute({ action: 'journal', personaId, summary: `Archived test entry ${i}` }, { agent, signal });
const afterArchive = store.get('primary');
assert.ok(afterArchive.events.length <= 500);
assert.equal(afterArchive.eventPages.length, 1);
assert.equal(archivedPages.size, 1);
assert.ok([...archivedPages.values()][0].some((event) => event.kind === 'persona-evolved' && event.before && event.after));
const archivedHistory = await personaTool.execute({ action: 'history', personaId, limit: 20, beforeSeq: afterArchive.events[0].seq }, { agent, signal });
assert.equal(archivedHistory.archivedPagesRead, 1);
assert.equal(archivedHistory.events.length, 20);
assert.equal(archivedHistory.mayHaveMore, true);
assert.ok(Buffer.byteLength(JSON.stringify(archivedHistory)) <= 32000);
const olderHistory = await personaTool.execute({ action: 'history', personaId, limit: 20, beforeSeq: archivedHistory.nextBeforeSeq }, { agent, signal });
assert.ok(olderHistory.events.length > 0);
assert.ok(olderHistory.events.at(-1).seq < archivedHistory.events[0].seq);
assert.ok(Buffer.byteLength(JSON.stringify(olderHistory)) <= 32000);
const latePersona = await personaTool.execute({ action: 'create', name: 'Late test persona' }, { agent, signal });
const lateHistory = await personaTool.execute({ action: 'history', personaId: latePersona.id, limit: 20 }, { agent, signal });
assert.equal(lateHistory.events.length, 1);
assert.equal(lateHistory.mayHaveMore, false);
for (let i = 0; i < 15; i += 1) await personaTool.execute({ action: 'journal', personaId, summary: `L${'o'.repeat(3900)}${i}` }, { agent, signal });
const byteBoundHistory = await personaTool.execute({ action: 'history', personaId, limit: 100 }, { agent, signal });
assert.equal(byteBoundHistory.truncatedByBytes, true);
assert.ok(byteBoundHistory.events.length < 100);
assert.ok(Buffer.byteLength(JSON.stringify(byteBoundHistory)) <= 32000);

await personaTool.execute({ action: 'schedule', personaId }, { agent, signal });
deleteShouldFail = true;
const paused = await command.handler({ rawInput: 'pause', agent: spawnedAgent, signal });
assert.match(paused.text, /1 task\(s\).*remain/);
assert.equal(newAgentDisposed, true);
assert.equal(prompts.has('session-life-new:persona-life-complete'), false);
assert.equal(Object.keys(store.get('primary').schedules).length, 1);
await assert.rejects(webTool.execute({ action: 'search', sourceName: 'Tieba', query: 'blocked' }, { agent, signal }), /globally paused/);
const quarantine = store.get('primary').pausedAgentSessions.includes('session-life-new');
assert.equal(quarantine, true);
const selfResume = await command.handler({ rawInput: 'resume', agent: spawnedAgent, signal });
assert.equal(selfResume.kind, 'error');
assert.match(selfResume.text, /only the controlling session/);
assert.equal(store.get('primary').paused, true);

agent.ctx.dispose();
listeners.get('agent/disposed')?.call(agent.ctx, { agent });
assert.equal(prompts.has(`${agent.id}:persona-life-complete`), false);
assert.equal(prompts.has('session-life-new:persona-life-complete'), false);
await cleanup();
HttpFetchProvider.prototype.fetch = originalSafeFetch;
assert.equal(prompts.size, 0);
assert.equal(domainClosed, true);
assert.equal(tools.size, 0);
assert.equal(commands.size, 0);
await rm(memoryDir, { recursive: true, force: true });
console.log('persona-life smoke test: OK');
