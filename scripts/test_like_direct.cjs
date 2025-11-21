#!/usr/bin/env node
/**
 * Test script: navigate to a URL in a container and click the like button if not already liked.
 * Usage: node scripts/test_like_direct.cjs <containerId> <url>
 */
const fetch = global.fetch || require('node-fetch');
const containerId = process.argv[2];
const targetUrl = process.argv[3];
if (!containerId || !targetUrl) {
  console.error('Usage: node scripts/test_like_direct.cjs <containerId> <url>');
  process.exit(2);
}
const BASE = process.env.CONTAINER_EXPORT_HOST || 'http://127.0.0.1:3001';

async function postJson(path, body) {
  const res = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  try { return { status: res.status, ok: res.ok, body: JSON.parse(text) }; } catch (e) { return { status: res.status, ok: res.ok, body: text }; }
}

async function navigate() {
  return await postJson('/internal/exec', { contextId: containerId, command: 'navigate', url: targetUrl, options: { waitForSelector: "main[role='main']", timeoutMs: 20000 } });
}

async function evalLikeState() {
  const script = `(function(){ const selCandidates=['div[data-testid="like"] button','button[aria-label*="Like"]','xpath://div[contains(@data-testid,"like")]']; for(const s of selCandidates){ try{ if(s.startsWith('xpath:')){ const xp = document.evaluate(s.slice(6), document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue; if(xp){ const pressed = xp.getAttribute('aria-pressed'); return { liked: pressed==='true', selector: s }; } } else { const el = document.querySelector(s); if(el){ const pressed = el.getAttribute('aria-pressed'); return { liked: pressed==='true', selector: s }; } } } catch(e){} } return { liked: null, selector: null }; })()`;
  return await postJson('/internal/exec', { contextId: containerId, command: 'eval', eval: script }, { });
}

async function clickSelector(selector) {
  // if selector is xpath:..., use eval to click; else use click command
  if (!selector) return { ok: false, body: { error: 'no selector' } };
  if (selector.startsWith('xpath:')) {
    const xpClick = `const el = document.evaluate(${JSON.stringify(selector.slice(6))}, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue; if(el){ el.click(); true } else { false }`;
    return await postJson('/internal/exec', { contextId: containerId, command: 'eval', eval: xpClick });
  } else {
    return await postJson('/internal/exec', { contextId: containerId, command: 'click', selector });
  }
}

async function run() {
  console.log('Navigating to', targetUrl);
  const nav = await navigate();
  console.log('navigate:', nav);
  if (!nav.ok) {
    console.error('navigate failed');
    return;
  }
  console.log('Checking like state...');
  const stateResp = await evalLikeState();
  console.log('like eval:', stateResp);
  const liked = stateResp && stateResp.body && stateResp.body.liked;
  const selector = stateResp && stateResp.body && stateResp.body.selector;
  if (liked === true) {
    console.log('Already liked; nothing to do.');
    return;
  }
  if (liked === null) {
    console.log('Could not determine like state; aborting.');
    return;
  }
  console.log('Attempting to click like using selector:', selector);
  const clickResp = await clickSelector(selector);
  console.log('click response:', clickResp);
  console.log('Waiting 3s then re-checking...');
  await new Promise(r => setTimeout(r, 3000));
  const check2 = await evalLikeState();
  console.log('post-click like eval:', check2);
}

run().catch(e => { console.error('error', e); process.exit(1); });


