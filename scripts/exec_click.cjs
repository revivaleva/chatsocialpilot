#!/usr/bin/env node
const fetch = global.fetch || require('node-fetch');
const id = process.argv[2];
const selector = process.argv[3];
if (!id || !selector) { console.error('Usage: node scripts/exec_click.cjs <containerId> <selector>'); process.exit(2); }
const BASE = process.env.CONTAINER_EXPORT_HOST || 'http://127.0.0.1:3001';
async function main() {
  // choose click or eval based on xpath prefix
  if (selector.startsWith('xpath:')) {
    const xp = selector.slice(6);
    const body = { contextId: id, command: 'eval', eval: `const el=document.evaluate(${JSON.stringify(xp)}, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue; if(el){ el.click(); true } else { false }` };
    const res = await fetch(BASE + '/internal/exec', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(body) });
    console.log(await res.text());
  } else {
    const body = { contextId: id, command: 'click', selector };
    const res = await fetch(BASE + '/internal/exec', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(body) });
    console.log(await res.text());
  }
}
main().catch(e=>{ console.error(e); process.exit(1); });


