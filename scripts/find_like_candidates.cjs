#!/usr/bin/env node
const fetch = global.fetch || require('node-fetch');
const id = process.argv[2];
if (!id) {
  console.error('Usage: node scripts/find_like_candidates.cjs <containerId>');
  process.exit(2);
}
const BASE = process.env.CONTAINER_EXPORT_HOST || 'http://127.0.0.1:3001';
async function main() {
  const js = `(function(){ const p = document.querySelector('article'); if(!p) return {found:false}; const buttons = Array.from(p.querySelectorAll('button')); return buttons.map(b=>({tag:b.tagName, ariaLabel:b.getAttribute('aria-label'), ariaPressed:b.getAttribute('aria-pressed'), dataTestId:b.getAttribute('data-testid'), classes: b.className, outer: b.outerHTML.slice(0,400)})); })()`;
  const res = await fetch(BASE + '/internal/exec', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contextId: id, command: 'eval', eval: js }) });
  const text = await res.text();
  try { console.log(JSON.stringify(JSON.parse(text), null, 2)); } catch (e) { console.log(text); }
}
main().catch(e=>{ console.error(e); process.exit(1); });


