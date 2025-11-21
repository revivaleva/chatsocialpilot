import fs from 'node:fs';
import path from 'node:path';
import { initDb, run, query } from '../src/drivers/db';

function ensureDirs() {
  if (!fs.existsSync('logs')) fs.mkdirSync('logs', { recursive: true });
}

function insertProfile(alias: string, p: string, browser = 'chromium') {
  const now = Date.now();
  run('INSERT OR IGNORE INTO profiles(alias,path,browser,discovered_at,notes) VALUES(?,?,?,?,?)', [alias, p, browser, now, 'discovered']);
  console.log(`seeded profile ${alias} -> ${p}`);
}

async function main() {
  ensureDirs();
  initDb({ wal: true });

  const up = process.env.USERPROFILE || process.env.HOME || '';
  const candidates = [
    path.join(up, 'AppData', 'Local', 'Google', 'Chrome', 'User Data'),
    path.join(up, 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data'),
    path.join(up, 'AppData', 'Local', 'ms-playwright', 'chromium'),
    path.join('C:', 'Profiles'),
  ];

  for (const p of candidates) {
    try {
      if (!p) continue;
      if (fs.existsSync(p)) {
        // list subdirs
        const subs = fs.readdirSync(p, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => path.join(p, d.name));
        if (subs.length === 0) subs.push(p);
        for (const s of subs) {
          const alias = path.basename(s).replace(/\s+/g, '_').toLowerCase();
          insertProfile(alias, s, 'chromium');
        }
      }
    } catch (e) { console.warn('scan err', p, e); }
  }

  // show inserted
  const rows = query<any>('SELECT id,alias,path,browser,discovered_at FROM profiles ORDER BY discovered_at DESC LIMIT 50', []);
  console.log('profiles:', rows.length);
  rows.forEach(r => console.log(r.alias, r.path));
}

main().catch(e => { console.error(e); process.exit(1); });




