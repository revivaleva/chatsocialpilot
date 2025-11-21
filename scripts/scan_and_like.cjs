#!/usr/bin/env node
/**
 * Scan account page and like the first unliked post.
 * Usage: node scripts/scan_and_like.cjs <containerId> <accountUrl> [maxScrolls=6]
 */
const fetch = global.fetch || require('node-fetch');
const id = process.argv[2];
const accountUrl = process.argv[3];
const maxScrolls = Number(process.argv[4] || 6);
if (!id || !accountUrl) {
  console.error('Usage: node scripts/scan_and_like.cjs <containerId> <accountUrl> [maxScrolls]');
  process.exit(2);
}
const BASE = process.env.CONTAINER_EXPORT_HOST || 'http://127.0.0.1:3001';

async function postJson(path, body) {
  const res = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  try { return { status: res.status, ok: res.ok, body: JSON.parse(text) }; } catch (e) { return { status: res.status, ok: res.ok, body: text }; }
}

async function navigate() {
  return await postJson('/internal/exec', { contextId: id, command: 'navigate', url: accountUrl, options: { waitForSelector: "main[role='main']", timeoutMs: 20000 } });
}

async function findUnlikedButton() {
  const script = `(function(){ const btn = document.querySelector('article button[data-testid="like"]'); if(!btn) return {found:false}; /* compute a short selector */ try { const a = btn.closest('article'); const all = Array.from(document.querySelectorAll('article')); const idx = all.indexOf(a); const sel = idx>=0 ? 'article:nth-of-type(' + (idx+1) + ') button[data-testid=\"like\"]' : null; return {found:true, selector: sel || 'button[data-testid=\"like\"]'} } catch(e){ return {found:true, selector:'button[data-testid=\"like\"]'} } })()`;
  return await postJson('/internal/exec', { contextId: id, command: 'eval', eval: script }, {});
}

async function clickSelector(selector) {
  if (!selector) return { ok: false, body: { error: 'no selector' } };
  if (selector.startsWith('xpath:')) {
    const xp = selector.slice(6);
    return await postJson('/internal/exec', { contextId: id, command: 'eval', eval: `const el=document.evaluate(${JSON.stringify(xp)}, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue; if(el){ el.click(); true } else { false }` });
  } else {
    return await postJson('/internal/exec', { contextId: id, command: 'click', selector });
  }
}

async function scrollDown() {
  return await postJson('/internal/exec', { contextId: id, command: 'eval', eval: 'window.scrollBy(0,800); true' });
}

async function run() {
  console.log('Navigate to account:', accountUrl);
  const nav = await navigate();
  console.log('navigate:', nav && nav.body ? nav.body : nav);
  for (let i = 0; i < maxScrolls; i++) {
    console.log('Searching for unliked button, attempt', i+1);
    const f = await findUnlikedButton();
    if (f && f.body && f.body.result && f.body.result.found) {
      const selector = f.body.result.selector;
      console.log('Found unliked selector:', selector);
      const click = await clickSelector(selector);
      console.log('click result:', click);
      // verify that unlike exists
      const verify = await postJson('/internal/exec', { contextId: id, command: 'eval', eval: `!!document.querySelector('article button[data-testid="unlike"]')` });
      console.log('verify unlike present:', verify);
      return;
    }
    console.log('Not found, scrolling...');
    await scrollDown();
    await new Promise(r => setTimeout(r, 2000));
  }
  console.log('No unliked post found after', maxScrolls, 'scrolls');
}

run().catch(e=>{ console.error('error', e); process.exit(1); });


