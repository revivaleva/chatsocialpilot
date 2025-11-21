#!/usr/bin/env node
/**
 * POST /internal/export-restored with given container id
 * Usage: node scripts/post_export_restored.cjs <containerId>
 */
const fetch = global.fetch || require('node-fetch');
const id = process.argv[2];
const ensureAuthArg = process.argv[3]; // optional 'noauth' to disable ensureAuth
if (!id) {
  console.error('Usage: node scripts/post_export_restored.cjs <containerId> [noauth]');
  process.exit(2);
}
const BASE = process.env.CONTAINER_EXPORT_HOST || 'http://127.0.0.1:3001';
async function main() {
  const url = BASE + '/internal/export-restored';
  const ensureAuth = ensureAuthArg === 'noauth' ? false : true;
  const body = { id, ensureAuth, returnToken: false };
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


