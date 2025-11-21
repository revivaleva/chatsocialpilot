#!/usr/bin/env tsx
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error('Usage: tsx scripts/test-export-and-open.ts <containerId>');
    process.exit(2);
  }

  const proxyUrl = process.env.OUR_SERVER_EXPORT_URL || 'http://localhost:5173/api/export/restore';
  const deleteUrl = process.env.OUR_SERVER_DELETE_URL || 'http://localhost:5173/api/export/delete';

  console.log('export request ->', proxyUrl, id);
  const r = await fetch(proxyUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
  let j: any = {};
  try { j = await r.json(); } catch (e) { console.error('invalid json response', e); process.exit(3); }
  if (!r.ok) { console.error('export failed', j); process.exit(4); }

  const exportedPath: string = j.path;
  const lastSessionId: string | null = j.lastSessionId || null;
  const token: string | null = j.token || null;
  console.log('export success', { exportedPath, lastSessionId, hasToken: !!token });

  // attempt to open with Playwright, with channel fallback
  const screenshotDir = path.resolve('shots');
  try { fs.mkdirSync(screenshotDir, { recursive: true }); } catch {}

  async function tryLaunch(userDataDir: string, opts?: any) {
    const launchOpts = Object.assign({ headless: false }, opts || {});
    console.log('launching playwright with', { userDataDir, launchOpts });
    return await chromium.launchPersistentContext(userDataDir, launchOpts);
  }

  let ctx = null;
  let screencap = null;
  try {
    try {
      ctx = await tryLaunch(exportedPath);
    } catch (e) {
      console.warn('default launch failed:', String(e));
      try { ctx = await tryLaunch(exportedPath, { channel: 'chrome' }); } catch (e2) { console.warn('chrome channel failed:', String(e2)); }
      if (!ctx) try { ctx = await tryLaunch(exportedPath, { channel: 'msedge' }); } catch (e3) { console.warn('msedge channel failed:', String(e3)); }
    }

    if (!ctx) { console.error('could not launch any playwright context'); process.exit(5); }

    const pages = ctx.pages();
    const page = pages[0] || await ctx.newPage();
    try {
      await page.goto('https://www.threads.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e) { console.warn('goto threads failed', String(e)); }
    screencap = path.join(screenshotDir, `restore-${id.replace(/-/g,'')}.png`);
    await page.screenshot({ path: screencap, fullPage: true });
    console.log('screenshot saved', screencap);
    await ctx.close();
  } catch (e) {
    console.error('playwright error', e);
    try { if (ctx) await ctx.close(); } catch {}
    process.exit(6);
  }

  // cleanup via our-server delete proxy
  try {
    const del = await fetch(deleteUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: exportedPath }) });
    const dj = await del.json().catch(()=>({}));
    console.log('delete response', del.status, dj);
  } catch (e) { console.warn('delete request failed', e); }

  console.log(JSON.stringify({ ok:true, path: exportedPath, lastSessionId, screenshot: screencap }, null, 2));
}

main().catch(e=>{ console.error('fatal', e); process.exit(99); });


