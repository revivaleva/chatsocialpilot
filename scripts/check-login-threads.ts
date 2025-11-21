#!/usr/bin/env tsx
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';

async function main() {
  const profilePath = process.argv[2];
  if (!profilePath) {
    console.error('Usage: tsx scripts/check-login-threads.ts <profilePath>');
    process.exit(2);
  }
  if (!fs.existsSync(profilePath)) { console.error('profilePath not found:', profilePath); process.exit(3); }

  const outDir = path.resolve('shots');
  try { fs.mkdirSync(outDir, { recursive: true }); } catch {}
  const screenshot = path.join(outDir, `login-check-${path.basename(profilePath)}.png`);

  const ctx = await chromium.launchPersistentContext(profilePath, { headless: false });
  try {
    const pages = ctx.pages();
    const page = pages[0] || await ctx.newPage();
    // goto Threads homepage to ensure site loads and cookies applied
    try { await page.goto('https://www.threads.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch (e) {
      // ignore navigation errors
    }
    // capture screenshot
    await page.screenshot({ path: screenshot, fullPage: false });

    // gather cookies for common domains
    const domains = ['https://www.threads.com', 'https://threads.com', 'https://www.instagram.com', 'https://instagram.com', 'https://www.facebook.com', 'https://facebook.com', 'https://www.x.com', 'https://x.com'];
    const allCookies = await ctx.cookies();
    const cookiesByDomain: Record<string, any[]> = {};
    for (const d of domains) cookiesByDomain[d] = allCookies.filter(c => (c.domain && d.includes(c.domain)) || (c.url && c.url.includes(new URL(d).hostname)));

    // simple DOM heuristics to detect logged-in state on Threads (Japanese/English fallbacks)
    const indicators = await page.evaluate(() => {
      const texts = document.body.innerText || '';
      const hasProfile = !!document.querySelector('a[href^="/@"]') || /プロフィールを編集|Profile|Log out|ログアウト/.test(texts);
      const hasAvatar = !!document.querySelector('img[alt]') && !!document.querySelector('img[alt]').getAttribute('src');
      return { hasProfile, hasAvatar };
    });

    // output
    const result = { ok: true, profilePath, screenshot, cookiesByDomain, indicators, timestamp: Date.now() };
    console.log(JSON.stringify(result, null, 2));
  } finally {
    try { await ctx.close(); } catch {}
  }
}

main().catch(e=>{ console.error({ ok:false, error: String(e) }); process.exit(99); });


