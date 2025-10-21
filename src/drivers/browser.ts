import { chromium, BrowserContext, Page, LaunchOptions } from 'playwright';
import { logger } from '../utils/logger';

export type BrowserOpts = { userDataDir: string; headless: boolean; proxy?: string | null; };

export async function openContext(opts: BrowserOpts): Promise<BrowserContext> {
  const args: string[] = ['--disable-dev-shm-usage', '--no-sandbox'];
  const launch: LaunchOptions = { headless: opts.headless, args };
  if (opts.proxy) launch.proxy = { server: opts.proxy };
  const ctx = await chromium.launchPersistentContext(opts.userDataDir, launch);
  logger.info(`Browser context opened: ${opts.userDataDir} (headless=${opts.headless})`);
  return ctx;
}

export async function safeClose(ctx?: BrowserContext) {
  try { if (ctx) await ctx.close(); } catch { logger.warn('close context failed'); }
}

export async function openPage(ctx: BrowserContext, url: string): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return page;
}


