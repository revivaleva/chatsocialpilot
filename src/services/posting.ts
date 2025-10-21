import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BrowserContext } from 'playwright';
import { openContext, openPage, safeClose } from '../drivers/browser';
import { run as dbRun } from '../drivers/db';
import { nowIso } from '../utils/time';

export async function postOnce(opts: {
  userDataDir: string;
  headless: boolean;
  url: string;
  content: string;
}) {
  const hash = crypto.createHash('sha256').update(opts.content).digest('hex').slice(0, 16);
  const shotsDir = path.resolve('shots');
  if (!fs.existsSync(shotsDir)) fs.mkdirSync(shotsDir, { recursive: true });
  const shotPath = path.join(shotsDir, `post-${Date.now()}.png`);

  let ctx: BrowserContext | undefined;
  try {
    ctx = await openContext({ userDataDir: opts.userDataDir, headless: opts.headless });
    const page = await openPage(ctx, opts.url);
    try { await page.waitForLoadState('domcontentloaded', { timeout: 5000 }); } catch {}

    try {
      await page.screenshot({ path: shotPath, fullPage: true });
    } catch (e) {
      try { await page.screenshot({ path: shotPath, fullPage: false }); }
      catch (e2) { const buf = await page.screenshot({ type: 'png', fullPage: false }); fs.writeFileSync(shotPath, buf); }
    }

    dbRun(
      'INSERT INTO posts(ts, platform, account, text_hash, url, result, evidence) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [nowIso(), 'threads', 'demo', hash, opts.url, 'OK', shotPath]
    );
  } finally {
    await safeClose(ctx);
  }
}


