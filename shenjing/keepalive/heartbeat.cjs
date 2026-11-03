#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const home = '/root/.dsh/shenjing-life';
const out = path.join(home, 'heartbeat.json');
const log = path.join(home, 'logs', 'heartbeat.jsonl');
fs.mkdirSync(path.dirname(log), { recursive: true });
function tick() {
  const now = new Date().toISOString();
  const state = { at: now, epochMs: Date.now(), pid: process.pid, monotonicSeconds: Math.floor(process.uptime()) };
  const tmp = out + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(state) + '\n');
    fs.renameSync(tmp, out);
    fs.appendFileSync(log, JSON.stringify(state) + '\n');
  } catch (e) {
    console.error(now + ' heartbeat failed: ' + e.message);
  }
}
tick();
// Keep one referenced timer so Node cannot exit before the next tick.
setInterval(tick, 60000);
