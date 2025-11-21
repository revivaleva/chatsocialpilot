import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

async function tryKeytarGet(service: string, account: string) {
  try {
    // dynamic import to avoid failing if not installed
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const keytar = require('keytar');
    return await keytar.getPassword(service, account);
  } catch (e) {
    return null;
  }
}

function defaultCbDir() {
  const appdata = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appdata, 'container-browser');
}

function defaultContainerDb() {
  return process.env.DEFAULT_CB_DB || path.join(defaultCbDir(), 'data.db');
}

async function decryptTokenEnc(encPath: string) {
  const raw = fs.readFileSync(encPath);
  const iv = raw.slice(0, 12);
  const tag = raw.slice(12, 28);
  const enc = raw.slice(28);
  const seed = (process.env.COMPUTERNAME || os.hostname() || 'local') + '::container-browser';
  const key = crypto.createHash('sha256').update(seed, 'utf8').digest();
  const dec = crypto.createDecipheriv('aes-256-gcm', key, iv);
  dec.setAuthTag(tag);
  const out = Buffer.concat([dec.update(enc), dec.final()]);
  return out.toString('utf8');
}

function maskToken(t: string) {
  if (!t) return '';
  if (t.length <= 12) return t.replace(/.(?=.{4})/g, '*');
  return t.slice(0,6) + '...' + t.slice(-4);
}

async function main() {
  const id = process.argv[2];
  if (!id) { console.error('Usage: tsx scripts/restore-container.ts <containerId>'); process.exit(2); }

  // 1) obtain token: try keytar then fallback to token.enc
  const SERVICE_NAME = 'container-browser';
  const ACCOUNT_NAME = 'container-browser-token';
  let token: string | null = null;
  try {
    token = await tryKeytarGet(SERVICE_NAME, ACCOUNT_NAME);
    if (token) console.log('token: keytar OK (masked)', maskToken(token));
  } catch (e) {}

  const encPath = path.join(defaultCbDir(), 'token.enc');
  if (!token && fs.existsSync(encPath)) {
    try {
      token = await decryptTokenEnc(encPath);
      console.log('token: decrypted fallback (masked)', maskToken(token));
    } catch (e:any) {
      console.error('decrypt token.enc failed', e?.message||e);
    }
  }

  if (!token) {
    console.error('no token available via keytar or token.enc');
    process.exit(3);
  }

  // 2) call auth.validate
  const BASE = process.env.AUTH_API_BASE || 'https://2y8hntw0r3.execute-api.ap-northeast-1.amazonaws.com/prod';
  const url = `${BASE.replace(/\/$/, '')}/auth/validate`;
  const device_id = `csp-${Date.now()}`;
  let setCookieHeaders: string[] = [];
  try {
    const resp = await fetch(url, { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type':'application/json' }, body: JSON.stringify({ device_id, device_info: { name: 'chatsocialpilot-restore', hostname: os.hostname() } }) });
    if (!resp.ok) {
      console.error('auth.validate failed', resp.status, await resp.text());
      process.exit(4);
    }
    // fetch headers
    const sc = resp.headers.get('set-cookie');
    if (sc) setCookieHeaders = [sc];
    // Node fetch may not expose multiple set-cookie easily; try rawHeaders if available
    // some runtimes expose getSetCookie; try to collect all
    // fallback: nothing
    console.log('auth.validate ok, set-cookie present=', !!sc);
  } catch (e:any) {
    console.error('auth.validate request failed', e?.message||e);
    process.exit(5);
  }

  // 3) determine profile path for container id
  const dbPath = defaultContainerDb();
  if (!fs.existsSync(dbPath)) { console.error('container db not found', dbPath); process.exit(6); }
  const db = new Database(dbPath, { readonly: true });
  const row = db.prepare('SELECT id,name,userDataDir,partition,lastSessionId FROM containers WHERE id=?').get(id);
  if (!row) { console.error('container id not found in db', id); process.exit(7); }
  const profileCandidates: string[] = [];
  if (row.userDataDir && String(row.userDataDir).trim()) profileCandidates.push(String(row.userDataDir).trim());
  if (row.partition) {
    const base = String(row.partition).replace(/^persist:/, '');
    profileCandidates.push(path.join(defaultCbDir(), 'Partitions', base));
    profileCandidates.push(path.join(defaultCbDir(), 'profiles', base));
  }
  // find existing
  let profilePath: string | null = null;
  for (const p of profileCandidates) {
    if (fs.existsSync(p)) { profilePath = p; break; }
  }
  if (!profilePath) { console.error('no existing profile path found; attempted:', profileCandidates); process.exit(8); }
  console.log('using profilePath=', profilePath);

  // import browser helper (dynamic import for ESM)
  const mod = await import('../src/drivers/browser');
  const { openWithProfile } = mod;
  const out: any = await openWithProfile({ profilePath, url: 'about:blank', headless: false });
  const ctx = out.context as any; // BrowserContext

  // 4) assemble cookies to inject
  const cookiesToAdd: any[] = [];
  if (setCookieHeaders.length > 0) {
    for (const h of setCookieHeaders) {
      // simple parse: name=value; Path=/; Domain=...; HttpOnly; Secure; SameSite=Lax
      const parts = h.split(';').map(s=>s.trim());
      const [nv, ...attrs] = parts;
      const eq = nv.indexOf('=');
      if (eq < 0) continue;
      const name = nv.slice(0,eq);
      const value = nv.slice(eq+1);
      const cookie: any = { name, value, path: '/', domain: 'www.threads.com', httpOnly: false, secure: true };
      for (const a of attrs) {
        const [ka, va] = a.split('=');
        if (!ka) continue;
        const k = ka.toLowerCase();
        if (k === 'domain') cookie.domain = (va||'').replace(/^\./,'');
        if (k === 'path') cookie.path = va || '/';
        if (k === 'httponly') cookie.httpOnly = true;
        if (k === 'secure') cookie.secure = true;
        if (k === 'samesite') cookie.sameSite = (va||'Lax');
      }
      cookiesToAdd.push(cookie);
    }
  } else {
    // fallback: inject session cookie using token
    cookiesToAdd.push({ name: 'session', value: token, domain: 'www.threads.com', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' });
  }

  // add cookies into context
  try {
    // Playwright expects cookies with url or domain; ensure domain present
    const pwCookies = cookiesToAdd.map(c => ({ name: c.name, value: c.value, domain: c.domain, path: c.path || '/', httpOnly: !!c.httpOnly, secure: !!c.secure, sameSite: (c.sameSite || 'Lax') }));
    await ctx.addCookies(pwCookies);
    console.log('cookies injected:', pwCookies.map(c=>c.name));
  } catch (e:any) {
    console.error('inject cookies failed', e?.message||e);
    process.exit(9);
  }

  // 5) restore tabs from lastSessionId
  const lastSessionId = row.lastSessionId;
  if (!lastSessionId) { console.log('no lastSessionId; done'); process.exit(0); }
  const tabs = db.prepare('SELECT url,tabIndex FROM tabs WHERE sessionId = ? ORDER BY tabIndex, id').all(lastSessionId);
  if (!tabs || !tabs.length) { console.log('no tabs for lastSessionId'); process.exit(0); }
  // group by tabIndex and pick first non-about:blank URL
  const byIndex = new Map();
  for (const t of tabs) {
    const idx = t.tabIndex || 0;
    if (!byIndex.has(idx)) byIndex.set(idx, []);
    byIndex.get(idx).push(t.url);
  }
  const restored: string[] = [];
  const failed: string[] = [];
  for (const [idx, urls] of byIndex.entries()) {
    const candidate = urls.find((u:string)=>u && !u.startsWith('about:blank')) || urls[0];
    try {
      const page = await ctx.newPage();
      await page.goto(candidate, { waitUntil: 'domcontentloaded' });
      restored.push(candidate);
    } catch (e:any) {
      failed.push(candidate);
    }
  }

  console.log(JSON.stringify({ ok:true, profilePath, restored, failed }, null, 2));
  process.exit(0);
}

main().catch(e=>{ console.error('restore failed', e?.message||e); process.exit(10); });


