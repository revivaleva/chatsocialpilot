#!/usr/bin/env node
const fetch = global.fetch || require('node-fetch');
const id = process.argv[2];
if (!id) {
  console.error('Usage: node scripts/dump_page_snippet.cjs <containerId>');
  process.exit(2);
}
const BASE = process.env.CONTAINER_EXPORT_HOST || 'http://127.0.0.1:3001';
async function main() {
  const js = `({ title: document.title, bodySnippet: (document.body && document.body.innerText || '').slice(0,1000) })`;
  const res = await fetch(BASE + '/internal/exec', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contextId: id, command: 'eval', eval: js }) });
  const text = await res.text();
  try { console.log(JSON.stringify(JSON.parse(text), null, 2)); } catch (e) { console.log(text); }
}
main().catch(e=>{ console.error(e); process.exit(1); });


