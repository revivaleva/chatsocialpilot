import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';
import { BrowserContext } from 'playwright';
import { openContext, openPage, safeClose } from '../drivers/browser';
import { run as dbRun } from '../drivers/db';
import { nowIso, sleep } from '../utils/time';
import { proposeSelectors, type HealingInput } from './healing';
import { getCandidates, recordSuccess, recordFailure, type LocatorCandidate } from './selectors';
import { siteCandidates, type LocatorCandidate as SiteLocatorCandidate } from './site_strategies';

type LocatorCandidate = { strategy: 'getByRole'|'getByLabel'|'getByText'|'css', locator: string };

function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

async function tryCandidate(page: any, c: LocatorCandidate, action: 'type'|'click', text?: string): Promise<boolean> {
  try {
    if (c.strategy === 'getByRole') {
      if (action === 'type') { const tb = page.getByRole(c.locator).first(); if (await tb.count()) { await tb.click(); await tb.fill(String(text)); return true; } }
      if (action === 'click') { const btn = page.getByRole(c.locator, { name: /.+/ }).first(); if (await btn.count()) { await btn.click(); return true; } }
    } else if (c.strategy === 'getByLabel') {
      const el = page.getByLabel(c.locator).first(); if (await el.count()) { if (action==='type'){ await el.click(); await el.fill(String(text)); } else { await el.click(); } return true; }
    } else if (c.strategy === 'getByText') {
      const el = page.getByText(new RegExp(c.locator, 'i')).first(); if (await el.count()) { if (action==='type'){ await el.click(); await page.keyboard.type(String(text)); } else { await el.click(); } return true; }
    } else if (c.strategy === 'css') {
      const el = await page.$(c.locator); if (el) { if (action==='type'){ await el.click(); await page.keyboard.type(String(text)); } else { await el.click(); } return true; }
    }
  } catch {}
  return false;
}

async function typeWithDbCandidates(page: any, site: string, text: string): Promise<boolean> {
  const cs = getCandidates(site, 'text_area', 20);
  for (const c of cs) {
    if (await tryCandidate(page, c, 'type', text)) { recordSuccess(site, 'text_area', c); return true; }
    else { recordFailure(site, 'text_area', c); }
  }
  return false;
}
async function clickWithDbCandidates(page: any, site: string): Promise<boolean> {
  const cs = getCandidates(site, 'post_button', 20);
  for (const c of cs) {
    if (await tryCandidate(page, c, 'click')) { recordSuccess(site, 'post_button', c); return true; }
    else { recordFailure(site, 'post_button', c); }
  }
  return false;
}

async function typeIntoEditor(page: any, text: string) {
  // 1) ARIA role= textbox
  try {
    const tb = page.getByRole('textbox').first();
    if (await tb.count()) { await tb.click(); await tb.fill(text); return true; }
  } catch {}
  // 2) contenteditable
  try {
    const ce = await page.$('[contenteditable="true"]');
    if (ce) { await ce.click(); await ce.type(text, { delay: 20 }); return true; }
  } catch {}
  // 3) textarea
  try {
    const ta = await page.$('textarea');
    if (ta) { await ta.click(); await page.keyboard.type(text, { delay: 15 }); return true; }
  } catch {}
  return false;
}

async function clickPostButton(page: any) {
  const names = [/post/i, /投稿/, /share/i, /send/i, /publish/i, /tweet/i, /ツイート/];
  // getByRole
  for (const n of names) {
    try {
      const btn = page.getByRole('button', { name: n }).first();
      if (await btn.count()) { await btn.click(); return true; }
    } catch {}
  }
  // getByText
  for (const n of names) {
    try {
      const el = page.getByText(n).first();
      if (await el.count()) { await el.click(); return true; }
    } catch {}
  }
  // CSS（最後の手段）
  try {
    const css = await page.$('button[type=submit], button.primary, [role=button]');
    if (css) { await css.click(); return true; }
  } catch {}
  return false;
}

function hostHash(u: string) {
  try { return new URL(u).host; } catch { return 'unknown-host'; }
}

async function collectHealingInput(page: any, url: string, intent: HealingInput['intent']): Promise<HealingInput> {
  let html = '';
  try { html = await page.content(); } catch {}
  let a11y = '';
  try { const snap = await page.accessibility.snapshot({ interestingOnly: false }); a11y = JSON.stringify(snap); } catch {}
  const max = 8000;
  return {
    url,
    htmlSnippet: html.slice(0, max),
    a11yTree: a11y.slice(0, max),
    intent
  };
}

export async function postOnce(opts: {
  userDataDir: string;
  headless: boolean;
  url: string;        // data:, about:blank, https:// いずれも可
  content: string;
}) {
  const shotsDir = path.resolve('shots');
  ensureDir(shotsDir);
  const ts = Date.now();
  const shotPath = path.join(shotsDir, `post-${ts}.png`);

  const textHash = crypto.createHash('sha256').update(opts.content).digest('hex').slice(0, 16);
  let ctx: BrowserContext | undefined;
  let result: 'OK' | 'FAIL' = 'FAIL';
  let evidence = '';

  try {
    ctx = await openContext({ userDataDir: opts.userDataDir, headless: opts.headless });
    const page = await openPage(ctx, opts.url);
    try { await page.waitForLoadState('domcontentloaded', { timeout: 8000 }); } catch {}

    const site = hostHash(opts.url);
    const startUrl = page.url();
    // 入力: DB候補 → サイト固有 → 汎用ヒューリスティック
    let typed = await typeWithDbCandidates(page, site, opts.content);
    if (!typed) {
      // apply site candidates
      const { text_area } = siteCandidates(site);
      for (const c of text_area) {
        if (await tryCandidate(page, c as any, 'type', opts.content)) { recordSuccess(site, 'text_area', c as any); typed = true; break; }
        else { recordFailure(site, 'text_area', c as any); }
      }
    }
    if (!typed) typed = await typeIntoEditor(page, opts.content);
    // スクリーンショット（入力後）
    try { await page.screenshot({ path: shotPath, fullPage: true }); evidence = shotPath; } catch { evidence = shotPath; }

    // 送信: DB候補 → サイト固有 → 汎用ヒューリスティック
    let clicked = await clickWithDbCandidates(page, site);
    if (!clicked && typed) {
      const { post_button } = siteCandidates(site);
      for (const c of post_button) {
        if (await tryCandidate(page, c as any, 'click')) { recordSuccess(site, 'post_button', c as any); clicked = true; break; }
        else { recordFailure(site, 'post_button', c as any); }
      }
    }
    if (!clicked && typed) {
      clicked = await clickPostButton(page);
      if (!clicked) { await sleep(800); clicked = await clickPostButton(page); }
    }

    // 送信後の確認（簡易）
    if (clicked) {
      // 成功検知: URL変化・トースト・エディタ空などを検査
      const detectPosted = async (page:any, startUrl:string, typedText:string, timeoutMs=8000): Promise<boolean> => {
        try { const alert = page.getByRole('alert').first(); await alert.waitFor({ timeout: 2000 }); return true; } catch {}
        if (page.url() !== startUrl) return true;
        try {
          const ce = await page.$('[contenteditable="true"]');
          if (ce) { const txt = await ce.evaluate((el:any)=>el.textContent?.trim()||''); if (txt.length < 2) return true; }
        } catch {}
        try { await page.waitForLoadState('networkidle', { timeout: 1500 }); } catch {}
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) { if (page.url() !== startUrl) return true; await page.waitForTimeout(300); }
        return false;
      };
      const ok = await detectPosted(page, startUrl, opts.content, 8000);
      if (ok) { result = 'OK'; }
      else { result = 'FAIL'; }
    } else {
      // 自己修復の呼び出し
      const input = await collectHealingInput(page, opts.url, typed ? 'post_button' : 'text_area');
      try {
        const heal = await proposeSelectors({
          dbDriver: 'sqlite', queueDriver: 'memory', storageDriver: 'fs', scheduler: 'internal',
          headless: opts.headless, maxConcurrentBrowsers: 1, cpuTargetUpperPercent: 70,
          sqlite: { busyRetry: [50,100,200], wal: true },
          models: {
            nlu: 'gpt-5-nano',
            vision_primary: 'gpt-4o-mini',
            text_reasoning_primary: 'gpt-5-mini',
            healing: { primary: 'gpt-5-nano', vision_fallback: 'gpt-4o-mini', text_fallback: 'gpt-5-mini' }
          },
          routing: { confidenceFloor: 0.75, healingMaxHtmlBytesForNano: 10000, retryBeforeFallback: 2, useVisionIfScreenshot: true }
        } as any, input);

        const site = hostHash(opts.url);
        const key = typed ? 'post_button' : 'text_area';
        const now = new Date().toISOString();
        const locJson = JSON.stringify(heal?.candidates ?? []);
        dbRun('INSERT INTO selectors(site_hash, key, locator_json, success_rate, updated_at) VALUES (?, ?, ?, ?, ?)',
          [site, key, locJson, 0, now]);
      } catch {}
      result = 'FAIL';
    }

  } finally {
    try {
      // 最終スクショ（送信後 or 失敗後）
      if (ctx) {
        const p = await ctx.pages();
        if (p?.[0]) {
          try { await p[0].screenshot({ path: shotPath, fullPage: false }); evidence = shotPath; } catch {}
        }
      }
    } catch {}
    await safeClose(ctx);
  }

  // DB記録
  dbRun(
    'INSERT INTO posts(ts, platform, account, text_hash, url, result, evidence) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [nowIso(), 'threads', 'demo', textHash, opts.url, result, evidence]
  );
}
