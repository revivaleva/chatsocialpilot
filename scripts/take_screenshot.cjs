#!/usr/bin/env node
/**
 * Request a screenshot from the given container via /internal/exec
 * Usage: node scripts/take_screenshot.cjs <containerId>
 */
const fetch = global.fetch || require('node-fetch');
const id = process.argv[2];
if (!id) {
  console.error('Usage: node scripts/take_screenshot.cjs <containerId>');
  process.exit(2);
}
const BASE = process.env.CONTAINER_EXPORT_HOST || 'http://127.0.0.1:3001';

async function main() {
  const res = await fetch(BASE + '/internal/exec', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contextId: id, command: 'eval', eval: 'null', options: { screenshot: true } }) });
  const text = await res.text();
  try { console.log(JSON.stringify(JSON.parse(text), null, 2)); } catch (e) { console.log(text); }
}

main().catch(e => { console.error(e); process.exit(1); });


