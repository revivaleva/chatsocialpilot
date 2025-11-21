#!/usr/bin/env node
/**
 * POST /internal/export-restored/close with given container id
 * Usage: node scripts/post_close.cjs <containerId> [timeoutMs]
 */
const fetch = global.fetch || require('node-fetch');
const id = process.argv[2];
const timeoutMs = process.argv[3] ? Number(process.argv[3]) : undefined;
if (!id) {
  console.error('Usage: node scripts/post_close.cjs <containerId> [timeoutMs]');
  process.exit(2);
}
const BASE = process.env.CONTAINER_EXPORT_HOST || 'http://127.0.0.1:3001';
async function main() {
  const url = BASE + '/internal/export-restored/close';
  const body = { id };
  if (typeof timeoutMs === 'number') body.timeoutMs = timeoutMs;
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const text = await res.text();
    try {
      console.log(JSON.stringify(JSON.parse(text), null, 2));
    } catch (e) {
      console.log(text);
    }
    process.exit(res.ok ? 0 : 1);
  } catch (e) {
    console.error('Request failed:', e.message);
    process.exit(3);
  }
}
main();


