import { chromium, BrowserContext, Page, LaunchOptions } from 'playwright';
import { logger } from '../utils/logger';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export type BrowserOpts = { userDataDir: string; headless: boolean; proxy?: string | null; };

const ctxMap = new Map<string, BrowserContext>();

type CtxRec = { ctx: BrowserContext; }

export function getContextById(contextId: string): CtxRec | undefined {
  const ctx = ctxMap.get(contextId);
  if (!ctx) return undefined;
  return { ctx };
}

export async function openContext(opts: BrowserOpts): Promise<BrowserContext> {
  const args: string[] = ['--disable-dev-shm-usage', '--no-sandbox'];
  const launch: LaunchOptions = { headless: opts.headless, args };
  if (opts.proxy) launch.proxy = { server: opts.proxy };
  const ctx = await chromium.launchPersistentContext(opts.userDataDir, launch);
  logger.info(`Browser context opened: ${opts.userDataDir} (headless=${opts.headless})`);
  return ctx;
}

export async function openWithProfile(opts: { profilePath: string; url?: string; headless?: boolean; }) {
  const profilePath = opts.profilePath;
  // validate the profile path contains expected Chromium files
  if (!profilePath || !fs.existsSync(profilePath)) {
    throw new Error(`profilePath does not exist: ${String(profilePath)}`);
  }
  const hasLocalState = fs.existsSync(path.join(profilePath, 'Local State'));
  const hasPrefsRoot = fs.existsSync(path.join(profilePath, 'Preferences'));
  const hasPrefsDefault = fs.existsSync(path.join(profilePath, 'Default', 'Preferences'));
  if (!hasLocalState && !hasPrefsRoot && !hasPrefsDefault) {
    throw new Error(`profilePath missing Preferences/Local State: ${profilePath}`);
  }

  const ctx = await openContext({ userDataDir: profilePath, headless: !!opts.headless });
  // register context by profilePath so callers can refer to it
  const contextId = profilePath;
  ctxMap.set(contextId, ctx);
  const pages = await ctx.pages();
  if (opts.url) {
    const page = pages[0] || await ctx.newPage();
    await page.goto(opts.url, { waitUntil: 'domcontentloaded' });
  }
  // collect some diagnostics
  let pagesCount = 0;
  let firstUrl = '';
  try {
    const pgs = await ctx.pages();
    pagesCount = Array.isArray(pgs) ? pgs.length : 0;
    if (pgs && pgs[0]) firstUrl = pgs[0].url ? pgs[0].url() : '';
  } catch (e) { /* ignore */ }

  return { context: ctx, contextId, profilePath, url: opts.url || '', pagesCount, firstUrl };
}

export async function navigateInContext(contextId: string, url: string) {
  const ctx = ctxMap.get(contextId);
  if (!ctx) throw new Error(`context not found: ${contextId}`);
  const pages = await ctx.pages();
  const page = pages[0] || await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return { url: page.url() };
}

export async function clickInContext(contextId: string, selector: string) {
  const rec = getContextById(contextId);
  if (!rec) throw new Error(`context not found: ${contextId}`);
  const pages = await rec.ctx.pages();
  const page = pages[0] || await rec.ctx.newPage();
  await page.waitForSelector(selector, { timeout: 15000 });
  await page.click(selector);
  return { ok: true };
}

export async function setCookiesInContext(contextId: string, cookies: Array<{ name: string; value: string; domain?: string; path?: string; httpOnly?: boolean; secure?: boolean; sameSite?: string }>) {
  const rec = getContextById(contextId);
  if (!rec) throw new Error(`context not found: ${contextId}`);
  const ctx = rec.ctx;
  const pwCookies = cookies.map(c => ({ name: c.name, value: c.value, domain: c.domain, path: c.path || '/', httpOnly: !!c.httpOnly, secure: !!c.secure, sameSite: (c.sameSite || 'Lax') }));
  // Playwright requires URLs or domain; ensure domain is provided
  await ctx.addCookies(pwCookies as any);
  return { ok: true, added: pwCookies.map(p=>p.name) };
}

export async function typeInContext(contextId: string, selector: string, text: string, opts?: { clear?: boolean }) {
  const rec = getContextById(contextId);
  if (!rec) throw new Error(`context not found: ${contextId}`);
  const pages = await rec.ctx.pages();
  const page = pages[0] || await rec.ctx.newPage();
  await page.waitForSelector(selector, { timeout: 15000 });
  if (opts?.clear) await page.fill(selector, '');
  await page.type(selector, text, { delay: 10 });
  return { ok: true };
}

export async function safeClose(ctx?: BrowserContext) {
  try { if (ctx) await ctx.close(); } catch { logger.warn('close context failed'); }
}

export async function closeContextById(contextId: string) {
  if (!contextId) return false;
  const rec = ctxMap.get(contextId);
  if (!rec) return false;
  await safeClose(rec.ctx);
  ctxMap.delete(contextId);
  return true;
}

export async function openPage(ctx: BrowserContext, url: string): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return page;
}


