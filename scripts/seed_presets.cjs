#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const fetch = global.fetch || require('node-fetch');

function loadPattern(p) {
  const txt = fs.readFileSync(path.resolve(p), 'utf8');
  return JSON.parse(txt);
}

async function postPreset(port, name, desc, steps) {
  const url = `http://localhost:${port}/api/presets`;
  const body = { name, description: desc, steps };
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const txt = await res.text();
  try { return JSON.parse(txt); } catch { return { raw: txt }; }
}

async function main() {
  const single = loadPattern('patterns/sample_single_like.json');
  const scan = loadPattern('patterns/sample_scan_like.json');
  const port = process.env.DASHBOARD_PORT || 5173;
  console.log('Posting presets to dashboard port', port);
  try {
    const r1 = await postPreset(port, single.name || 'single_like', single.description || '', single.steps || []);
    console.log('Created preset response:', r1);
  } catch (e) { console.error('err create single', e); }
  try {
    const r2 = await postPreset(port, scan.name || 'scan_like', scan.description || '', scan.steps || []);
    console.log('Created preset response:', r2);
  } catch (e) { console.error('err create scan', e); }
}

main().catch(e => { console.error(e); process.exit(1); });


