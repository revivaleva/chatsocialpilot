import fs from 'fs';
import path from 'path';
import { run as dbRun, query as dbQuery } from '../drivers/db';
import { logger } from '../utils/logger';

export async function scanContainers(baseDir: string) {
  const out: Array<any> = [];
  try {
    if (!fs.existsSync(baseDir)) return out;
    const items = fs.readdirSync(baseDir, { withFileTypes: true }).filter(d => d.isDirectory() && d.name.startsWith('container-'));
    for (const it of items) {
      const dir = path.join(baseDir, it.name);
      const pref = path.join(dir, 'Preferences');
      let name = it.name;
      let source: 'preferences'|'dirname' = 'dirname';
      try {
        if (fs.existsSync(pref)) {
          const txt = fs.readFileSync(pref, 'utf8');
          const j = JSON.parse(txt);
          const keys = ['profile.name','custom_profile.name','user.name','name','profileName'];
          for (const k of keys) {
            const parts = k.split('.');
            let cur: any = j;
            for (const p of parts) { if (cur && Object.prototype.hasOwnProperty.call(cur,p)) cur = cur[p]; else { cur = undefined; break; } }
            if (cur) { name = String(cur); source = 'preferences'; break; }
          }
        }
      } catch (e) { /* ignore parse errors */ }
      const stat = fs.statSync(dir);
      out.push({ id: it.name, name, dir, mtime: stat.mtimeMs, source });
    }
  } catch (e:any) { logger.event('profiles.scan.err', { err: String(e), baseDir }, 'error'); }
  return out;
}

export async function findCompanionDbs(rootDir: string) {
  const out: Array<any> = [];
  try {
    if (!fs.existsSync(rootDir)) return out;
    const walk = (d:string, depth = 0) => {
      if (depth > 2) return;
      const items = fs.readdirSync(d, { withFileTypes: true });
      for (const it of items) {
        const p = path.join(d, it.name);
        if (it.isDirectory()) walk(p, depth+1);
        else if (it.isFile()) {
          if (/\.sqlite$|\.db$|\.json$/i.test(it.name)) out.push({ path: p, type: path.extname(it.name).replace(/\./,'') });
        }
      }
    };
    walk(rootDir, 0);
  } catch (e:any) { logger.event('profiles.finddb.err', { err: String(e), rootDir }, 'error'); }
  return out;
}

export async function inspectDbSchema(dbPath: string) {
  const out: any = { tables: [] };
  try {
    if (!fs.existsSync(dbPath)) return out;
    if (/\.json$/i.test(dbPath)) {
      const txt = fs.readFileSync(dbPath, 'utf8');
      try { const j = JSON.parse(txt); out.sample = Array.isArray(j) ? j.slice(0,3) : j; } catch {}
      return out;
    }
    // sqlite inspection
    try {
      const rows = dbQuery<any>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'", []);
      out.tables = rows.map(r=>r.name);
    } catch (e) { logger.event('profiles.inspect.err', { err: String(e), dbPath }, 'warn'); }
  } catch (e:any) { logger.event('profiles.inspect.err', { err: String(e), dbPath }, 'error'); }
  return out;
}

export function importAccounts(items: Array<{ name: string; dir: string }>) {
  const cfgPath = path.resolve('config', 'accounts.json');
  let cfg: any = {};
  try {
    if (fs.existsSync(cfgPath)) cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8') || '{}');
  } catch (e) { cfg = {}; }
  cfg.accounts = cfg.accounts || [];
  const added: string[] = [];
  const skipped: string[] = [];
  for (const it of items) {
    if (cfg.accounts.some((a:any)=>a.name === it.name)) { skipped.push(it.name); continue; }
    cfg.accounts.push({ name: it.name, profileUserDataDir: it.dir });
    added.push(it.name);
  }
  try { fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8'); } catch (e) { logger.event('profiles.import.err', { err: String(e) }, 'error'); }
  return { added, skipped };
}



