import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { logger, logErr } from '../utils/logger';

const DB_PATH = path.resolve('storage', 'app.db');
const SNAP_DIR = path.resolve('storage', 'snapshots');

const FORBIDDEN_DDL = [/ATTACH\s/i, /PRAGMA\s+(?!(journal_mode|synchronous))/i, /DROP\s+TABLE\s+IF\s+EXISTS\s+.+;/i];

let db: Database.Database;

function ensureDirs() {
  if (!fs.existsSync(path.dirname(DB_PATH))) fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  if (!fs.existsSync(SNAP_DIR)) fs.mkdirSync(SNAP_DIR, { recursive: true });
}

export function initDb(opts: { wal: boolean } = { wal: true }) {
  ensureDirs();
  db = new Database(DB_PATH);
  if (opts.wal) db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS runs(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT, type TEXT, account TEXT, status TEXT, notes TEXT, screenshot_path TEXT
    );
    CREATE TABLE IF NOT EXISTS posts(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT, platform TEXT, account TEXT, text_hash TEXT, url TEXT, result TEXT, evidence TEXT
    );
    CREATE TABLE IF NOT EXISTS selectors(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_hash TEXT, key TEXT, locator_json TEXT, success_rate REAL, updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS generations(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT, persona TEXT, prompt TEXT, output TEXT, model TEXT, tokens INTEGER, quality_score REAL
    );
    CREATE TABLE IF NOT EXISTS kv(
      k TEXT PRIMARY KEY, v TEXT
    );
    CREATE TABLE IF NOT EXISTS schema_versions(
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, note TEXT
    );
    `);
  logger.info(`DB initialized at ${DB_PATH}`);
}

export function query<T = unknown>(sql: string, params: any[] = []): T[] {
  return db.prepare(sql).all(params) as T[];
}

export function run(sql: string, params: any[] = []): Database.RunResult {
  return db.prepare(sql).run(params);
}

function isDangerousDDL(sql: string) {
  return FORBIDDEN_DDL.some((re) => re.test(sql));
}

function snapshotDb(note = 'ddl') {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(SNAP_DIR, `snap-${ts}-${note}.db`);
  fs.copyFileSync(DB_PATH, dest);
  logger.warn(`DB snapshot created: ${dest}`);
  return dest;
}

export function execDDL(sql: string, note = 'ddl') {
  if (isDangerousDDL(sql)) throw new Error('Forbidden DDL detected by policy.');
  const snap = snapshotDb(note);
  try {
    db.exec(sql);
    run('INSERT INTO schema_versions(ts, note) VALUES (?, ?)', [new Date().toISOString(), note]);
    return { ok: true, snapshot: snap };
  } catch (e) {
    logErr(e, 'execDDL');
    fs.copyFileSync(snap, DB_PATH);
    throw e;
  }
}


