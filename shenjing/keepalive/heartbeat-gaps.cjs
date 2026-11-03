#!/usr/bin/env node
'use strict';
const fs = require('fs');
const file = '/root/.dsh/shenjing-life/logs/heartbeat.jsonl';
if (!fs.existsSync(file)) { console.error('No heartbeat log yet: ' + file); process.exit(1); }
const rows = fs.readFileSync(file, 'utf8').trim().split(/\n+/).filter(Boolean).map(line => {
  try { return JSON.parse(line); } catch { return null; }
}).filter(Boolean).sort((a,b) => a.epochMs - b.epochMs);
if (!rows.length) { console.log('No valid heartbeat records.'); process.exit(0); }
let max = null;
for (let i = 1; i < rows.length; i++) {
  const gapSeconds = Math.round((rows[i].epochMs - rows[i-1].epochMs) / 1000);
  if (gapSeconds > 90 && (!max || gapSeconds > max.gapSeconds)) {
    max = { from: rows[i-1].at, to: rows[i].at, gapSeconds };
  }
}
console.log(JSON.stringify({ records: rows.length, first: rows[0].at, last: rows.at(-1).at, longestGapOver90s: max }, null, 2));
