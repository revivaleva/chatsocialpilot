#!/usr/bin/env tsx
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import child_process from 'node:child_process';
import util from 'node:util';
const exec = util.promisify(child_process.exec);

async function runCmd(cmd: string) {
  try {
    const { stdout, stderr } = await exec(cmd, { windowsHide: true });
    return { stdout: String(stdout || '').trim(), stderr: String(stderr || '').trim(), code: 0 };
  } catch (e: any) {
    return { stdout: String(e.stdout || '').trim(), stderr: String(e.stderr || e.message || '').trim(), code: e.code || 1 };
  }
}

function listExportsDir() {
  const base = path.join(os.tmpdir(), 'container-browser-exports');
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base).map(d => path.join(base, d)).filter(p => fs.existsSync(p));
}

function exists(p: string){ try { return fs.existsSync(p); } catch { return false; } }

async function checkProfile(p: string) {
  console.log('\n=== CHECK PROFILE: %s ===', p);
  console.log('exists:', exists(p));
  const prefsRoot = path.join(p, 'Preferences');
  const prefsDefault = path.join(p, 'Default', 'Preferences');
  const localState = path.join(p, 'Local State');
  const cookiesFile = path.join(p, 'Network', 'Cookies');
  console.log('Local State:', exists(localState));
  console.log('Preferences (root):', exists(prefsRoot));
  console.log('Preferences (Default):', exists(prefsDefault));
  console.log('Cookies file exists:', exists(cookiesFile));

  // Check for LOCK files in LevelDB dirs
  const leveldbDirs = ['IndexedDB', 'Local Storage', 'File System', 'Service Worker'].map(d=>path.join(p, d));
  for (const d of leveldbDirs) {
    if (!exists(d)) continue;
    const hasLock = fs.readdirSync(d).some(f => /LOCK|CURRENT|MANIFEST/.test(f));
    console.log('Dir:', path.basename(d), 'hasDBfiles:', hasLock);
  }

  // Check for processes with commandline containing this path (Windows via PowerShell)
  try {
    const safe = p.replace(/'/g, "''");
    const cmd = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -like '*${safe}*' } | Select-Object ProcessId,CommandLine | ConvertTo-Json`;
    const r = await runCmd(`powershell -NoProfile -Command "${cmd}"`);
    console.log('Processes referencing path (PowerShell):', r.stdout || '(none)');
  } catch (e) { console.log('process-check err', String(e)); }

  // Playwright open tests
  try {
    console.log('Playwright open tests (headless:false, channels fallback)');
    const { chromium } = await import('playwright');
    const tryLaunch = async (opts: any) => {
      try {
        const ctx = await chromium.launchPersistentContext(p, opts);
        const pages = await ctx.pages();
        const page = pages[0] || await ctx.newPage();
        const url = page.url ? await page.url() : undefined;
        console.log(' -> launched, pages:', pages.length, 'firstUrl:', url);
        try { await page.goto('https://www.threads.com/', { waitUntil: 'domcontentloaded', timeout: 20000 }); } catch(e){ console.log('goto warning', String(e.message||e)); }
        const shot = path.join(process.cwd(),'shots', 'diag-'+path.basename(p)+'.png');
        try { await page.screenshot({ path: shot, fullPage: false }); console.log('screenshot:', shot); } catch(e){ console.log('screenshot failed', String(e)); }
        await ctx.close();
        return true;
      } catch (e) { console.log('launch failed:', String(e.message||e)); return false; }
    };

    let ok = await tryLaunch({ headless:false });
    if (!ok) ok = await tryLaunch({ headless:false, channel:'chrome' });
    if (!ok) ok = await tryLaunch({ headless:false, channel:'msedge' });
    console.log('Playwright open final result:', ok);
  } catch (e) { console.log('playwright test error', String(e)); }

  // Permissions / owner check
  try {
    const r = await runCmd(`Get-Acl -Path '${p}' | Select-Object -Property Owner | ConvertTo-Json`);
    console.log('Owner info (Get-Acl):', r.stdout || r.stderr || '(none)');
  } catch (e) { console.log('owner check err', String(e)); }

  // Path length check
  try { console.log('Path length:', p.length); } catch {}

  console.log('=== END PROFILE ===\n');
}

async function main() {
  const args = process.argv.slice(2);
  let targets: string[] = [];
  if (args.length > 0) targets = args;
  else targets = listExportsDir();
  if (!targets || targets.length === 0) { console.error('no targets'); process.exit(2); }
  for (const t of targets) {
    await checkProfile(t);
  }
}

main().catch(e=>{ console.error('fatal', e); process.exit(99); });


