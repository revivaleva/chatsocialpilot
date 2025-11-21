import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { logger, logErr } from '../utils/logger';

const DB_PATH = path.resolve('storage', 'app.db');
const SNAP_DIR = path.resolve('storage', 'snapshots');

const FORBIDDEN_DDL = [/ATTACH\s/i, /PRAGMA\s+(?!(journal_mode|synchronous))/i, /DROP\s+TABLE\s+IF\s+EXISTS\s+.+;/i];

let db: Database.Database;

type Migration = { name: string; sql: string };
const MIGRATIONS: Migration[] = [
  {
    name: 'm0001_profiles_and_playbooks',
    sql: `
    CREATE TABLE IF NOT EXISTS profiles (
      id INTEGER PRIMARY KEY,
      alias TEXT UNIQUE,
      path TEXT NOT NULL,
      browser TEXT,
      discovered_at INTEGER NOT NULL,
      last_used_at INTEGER,
      notes TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_profiles_path ON profiles(path);

    CREATE TABLE IF NOT EXISTS scrape_playbooks (
      id INTEGER PRIMARY KEY,
      host TEXT NOT NULL,
      action TEXT NOT NULL,
      selectors_json TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      confidence REAL NOT NULL DEFAULT 0.5,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_playbooks_host_action ON scrape_playbooks(host, action);
    `
  }
  ,
  {
    name: 'm0002_capabilities_and_rag',
    sql: `
    CREATE TABLE IF NOT EXISTS capabilities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE,
      title TEXT,
      description TEXT,
      params_json TEXT,
      preconds_json TEXT,
      effect_tags TEXT,
      risk_score REAL DEFAULT 0.0,
      enabled INTEGER DEFAULT 1,
      version INTEGER DEFAULT 1,
      updated_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_capabilities_key ON capabilities(key);

    CREATE TABLE IF NOT EXISTS capability_examples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      capability_key TEXT,
      user_utterance TEXT,
      expected_args_json TEXT,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS capability_embeddings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      capability_key TEXT,
      title TEXT,
      text TEXT,
      embedding_json TEXT,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS kb_docs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT,
      scope TEXT,
      title TEXT,
      content TEXT,
      embedding_json TEXT,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS run_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      capability_key TEXT,
      args_json TEXT,
      outcome TEXT,
      latency_ms INTEGER,
      reward REAL,
      error_msg TEXT,
      created_at INTEGER
    );
    `
  }
  ,
  {
    name: 'm0003_presets_and_jobs',
    sql: `
    CREATE TABLE IF NOT EXISTS presets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      steps_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_presets_name ON presets(name);

    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      preset_id INTEGER NOT NULL,
      account_name TEXT,
      schedule TEXT,
      enabled INTEGER DEFAULT 1,
      last_run_at INTEGER,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS job_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER,
      preset_id INTEGER,
      step_index INTEGER,
      step_json TEXT,
      ok INTEGER,
      result_json TEXT,
      error_text TEXT,
      elapsed_ms INTEGER,
      created_at INTEGER
    );
    `
  }
  ,
  {
    name: 'm0004_tasks_and_runs',
    sql: `
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      runId TEXT UNIQUE,
      preset_id INTEGER,
      container_id TEXT,
      overrides_json TEXT,
      scheduled_at INTEGER,
      status TEXT DEFAULT 'pending',
      created_at INTEGER,
      updated_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

    CREATE TABLE IF NOT EXISTS task_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      runId TEXT,
      task_id INTEGER,
      started_at INTEGER,
      ended_at INTEGER,
      status TEXT,
      result_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_task_runs_runId ON task_runs(runId);
    `
  }
  ,
  {
    name: 'm0005_chat_feedback',
    sql: `
    CREATE TABLE IF NOT EXISTS chat_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      role TEXT NOT NULL,
      feedback TEXT NOT NULL,
      reason TEXT,
      created_at INTEGER NOT NULL
    );
    `
  }
  ,
  {
    name: 'm0006_chat_messages',
    sql: `
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      meta_json TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created ON chat_messages(session_id, created_at);
    `
  }
  ,
  {
    name: 'm0007_container_groups',
    sql: `
    CREATE TABLE IF NOT EXISTS container_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      color TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS container_group_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      container_id TEXT NOT NULL,
      group_id TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      UNIQUE(container_id)
    );
    CREATE INDEX IF NOT EXISTS idx_cgm_container ON container_group_members(container_id);
    CREATE INDEX IF NOT EXISTS idx_cgm_group ON container_group_members(group_id);
    `
  }
  ,
  {
    name: 'm0008_tasks_group_meta',
    sql: `
    ALTER TABLE tasks ADD COLUMN group_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_tasks_group_id ON tasks(group_id);
    `
  }
  ,
  {
    name: 'm0009_tasks_wait_minutes',
    sql: `
    ALTER TABLE tasks ADD COLUMN wait_minutes INTEGER DEFAULT 10;
    CREATE INDEX IF NOT EXISTS idx_tasks_wait ON tasks(wait_minutes);
    `
  }
];

function ensureMigrationsTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      name TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);
}
function hasMigration(name: string): boolean {
  const row = db.prepare(`SELECT 1 FROM migrations WHERE name=?`).get(name);
  return !!row;
}
function applyMigration(m: Migration) {
  db.exec('BEGIN');
  try {
    db.exec(m.sql);
    db.prepare(`INSERT INTO migrations(name, applied_at) VALUES(?,?)`).run(m.name, Date.now());
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
export function ensureSchema() {
  ensureMigrationsTable();
  for (const m of MIGRATIONS) {
    if (!hasMigration(m.name)) applyMigration(m);
  }
}

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
    CREATE TABLE IF NOT EXISTS memory (
      k TEXT PRIMARY KEY, v TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'fact', scope TEXT NOT NULL DEFAULT 'global', updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memory_updated_at ON memory(updated_at);
    `);
  logger.info(`DB initialized at ${DB_PATH}`);
  // ensure migrations
  try { ensureSchema(); } catch (e) { logErr(e, 'ensureSchema'); }
}

function ensureDbReady() {
  if (!db) {
    initDb();
  }
}

export function memSet(k: string, v: any, type = 'fact', scope = 'global') {
  if (!db) {
    ensureDbReady();
  }
  const now = Date.now();
  const s = JSON.stringify(v);
  return db.prepare('INSERT INTO memory(k,v,type,scope,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, type=excluded.type, scope=excluded.scope, updated_at=excluded.updated_at').run(k, s, type, scope, now);
}

export function memGet(k: string) {
  if (!db) {
    ensureDbReady();
  }
  const row = db.prepare('SELECT v FROM memory WHERE k = ?').get(k);
  if (!row) return null;
  try { return JSON.parse(row.v); } catch { return row.v; }
}

export function memList(prefix = '') {
  const rows = db.prepare('SELECT k,v,type,scope,updated_at FROM memory WHERE k LIKE ? ORDER BY updated_at DESC').all(prefix + '%');
  return rows.map((r: any) => ({ k: r.k, v: (() => { try { return JSON.parse(r.v); } catch { return r.v; } })(), type: r.type, scope: r.scope, updated_at: r.updated_at }));
}

export function memDeletePrefix(prefix: string) {
  const info = db.prepare('DELETE FROM memory WHERE k LIKE ?').run(prefix + '%');
  return info.changes || 0;
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


