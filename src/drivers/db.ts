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
  ,
  {
    name: 'm0010_post_library',
    sql: `
    CREATE TABLE IF NOT EXISTS post_library (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      used INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_post_library_used ON post_library(used);

    CREATE TABLE IF NOT EXISTS post_media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      type TEXT,
      path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(post_id) REFERENCES post_library(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_post_media_post_id ON post_media(post_id);

    ALTER TABLE presets ADD COLUMN use_post_library INTEGER DEFAULT 0;
    `
  }
  ,
  {
    name: 'm0011_profile_icons',
    sql: `
    CREATE TABLE IF NOT EXISTS profile_icons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id TEXT UNIQUE NOT NULL,
      url TEXT NOT NULL,
      used INTEGER DEFAULT 0,
      used_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_profile_icons_file_id ON profile_icons(file_id);
    CREATE INDEX IF NOT EXISTS idx_profile_icons_used ON profile_icons(used);
    `
  }
  ,
  {
    name: 'm0012_header_icons',
    sql: `
    CREATE TABLE IF NOT EXISTS header_icons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id TEXT UNIQUE NOT NULL,
      url TEXT NOT NULL,
      used INTEGER DEFAULT 0,
      used_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_header_icons_file_id ON header_icons(file_id);
    CREATE INDEX IF NOT EXISTS idx_header_icons_used ON header_icons(used);
    `
  }
  ,
  {
    name: 'm0013_x_accounts',
    sql: `
    CREATE TABLE IF NOT EXISTS x_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      container_id TEXT NOT NULL UNIQUE,
      email TEXT,
      email_password TEXT,
      x_password TEXT,
      follower_count INTEGER,
      following_count INTEGER,
      x_username TEXT,
      x_user_id TEXT,
      last_synced_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_x_accounts_container_id ON x_accounts(container_id);
    CREATE INDEX IF NOT EXISTS idx_x_accounts_email ON x_accounts(email);
    `
  }
  ,
  {
    name: 'm0014_email_accounts',
    sql: `
    CREATE TABLE IF NOT EXISTS email_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email_password TEXT NOT NULL UNIQUE,
      added_at INTEGER NOT NULL,
      used_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_email_accounts_used_at ON email_accounts(used_at);
    `
  }
  ,
  {
    name: 'm0015_x_accounts_auth_fields',
    sql: `
    ALTER TABLE x_accounts ADD COLUMN twofa_code TEXT;
    ALTER TABLE x_accounts ADD COLUMN auth_token TEXT;
    ALTER TABLE x_accounts ADD COLUMN ct0 TEXT;
    `
  }
  ,
  {
    name: 'm0016_profile_templates',
    sql: `
    CREATE TABLE IF NOT EXISTS profile_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_name TEXT NOT NULL,
      profile_text TEXT NOT NULL,
      added_at INTEGER NOT NULL,
      used_at INTEGER,
      UNIQUE(account_name, profile_text)
    );
    CREATE INDEX IF NOT EXISTS idx_profile_templates_used_at ON profile_templates(used_at);
    `
  }
  ,
  {
    name: 'm0017_proxies',
    sql: `
    CREATE TABLE IF NOT EXISTS proxies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proxy_info TEXT NOT NULL UNIQUE,
      added_at INTEGER NOT NULL
    );
    `
  }
  ,
  {
    name: 'm0018_x_accounts_proxy',
    sql: `
    ALTER TABLE x_accounts ADD COLUMN proxy_id INTEGER;
    CREATE INDEX IF NOT EXISTS idx_x_accounts_proxy_id ON x_accounts(proxy_id);
    `
  }
  ,
  {
    name: 'm0019_proxies_remove_used_count',
    sql: `
    -- used_countカラムを削除するため、テーブルを再作成
    CREATE TABLE IF NOT EXISTS proxies_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proxy_info TEXT NOT NULL UNIQUE,
      added_at INTEGER NOT NULL
    );
    INSERT INTO proxies_new (id, proxy_info, added_at)
    SELECT id, proxy_info, added_at FROM proxies;
    DROP TABLE proxies;
    ALTER TABLE proxies_new RENAME TO proxies;
    `
  }
  ,
  {
    name: 'm0020_tasks_queue_name',
    sql: `
    ALTER TABLE tasks ADD COLUMN queue_name TEXT DEFAULT 'default';
    CREATE INDEX IF NOT EXISTS idx_tasks_queue_name ON tasks(queue_name);
    `
  }
  ,
  {
    name: 'm0021_posts_enhancement',
    sql: `-- このマイグレーションは applyMigration 関数内で特別処理される`
  }
  ,
  {
    name: 'm0022_posts_add_media',
    sql: `
    ALTER TABLE posts ADD COLUMN media TEXT;
    `
  }
  ,
  {
    name: 'm0023_post_library_threads_media',
    sql: `
    ALTER TABLE post_library ADD COLUMN media_paths TEXT;
    ALTER TABLE post_library ADD COLUMN source_url TEXT;
    ALTER TABLE post_library ADD COLUMN account_id TEXT;
    ALTER TABLE post_library ADD COLUMN post_id_threads TEXT;
    ALTER TABLE post_library ADD COLUMN download_status TEXT DEFAULT 'pending';
    ALTER TABLE post_library ADD COLUMN downloaded_at INTEGER;
    ALTER TABLE post_library ADD COLUMN media_count INTEGER DEFAULT 0;
    CREATE INDEX IF NOT EXISTS idx_post_library_source_url ON post_library(source_url);
    CREATE INDEX IF NOT EXISTS idx_post_library_status ON post_library(download_status);
    `
  }
  ,
  {
    name: 'm0024_post_library_unify_posts',
    sql: `
    -- post_library に posts の新形式データ用カラムを追加
    ALTER TABLE post_library ADD COLUMN like_count INTEGER;
    ALTER TABLE post_library ADD COLUMN rewritten_content TEXT;
    ALTER TABLE post_library ADD COLUMN used_at INTEGER;
    
    -- posts テーブルの新形式データ（content, like_count, rewritten_content, media, created_at, used_at, used があるレコード）を post_library に移行
    INSERT INTO post_library (content, used, source_url, like_count, rewritten_content, media_paths, created_at, updated_at, used_at)
    SELECT 
      content,
      COALESCE(used, 0),
      url,
      like_count,
      rewritten_content,
      media,
      COALESCE(created_at, CAST(strftime('%s', 'now') AS INTEGER) * 1000),
      COALESCE(created_at, CAST(strftime('%s', 'now') AS INTEGER) * 1000),
      used_at
    FROM posts
    WHERE content IS NOT NULL AND content != '' AND url IS NOT NULL;
    
    -- posts テーブルを削除
    DROP TABLE IF EXISTS posts;
    `
  }
  ,
  {
    name: 'm0025_x_accounts_email_changed_at',
    sql: `
    ALTER TABLE x_accounts ADD COLUMN email_changed_at INTEGER;
    `
  }
  ,
  {
    name: 'm0026_account_status_events',
    sql: `
    CREATE TABLE IF NOT EXISTS account_status_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      container_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_account_status_events_container_id ON account_status_events(container_id);
    CREATE INDEX IF NOT EXISTS idx_account_status_events_event_type ON account_status_events(event_type);
    CREATE INDEX IF NOT EXISTS idx_account_status_events_created_at ON account_status_events(created_at);
    `
  }
  ,
  {
    name: 'm0027_x_accounts_profile_fields',
    sql: `
    ALTER TABLE x_accounts ADD COLUMN profile_name TEXT;
    ALTER TABLE x_accounts ADD COLUMN profile_bio TEXT;
    ALTER TABLE x_accounts ADD COLUMN profile_location TEXT;
    ALTER TABLE x_accounts ADD COLUMN profile_website TEXT;
    ALTER TABLE x_accounts ADD COLUMN profile_avatar_image_path TEXT;
    ALTER TABLE x_accounts ADD COLUMN profile_banner_image_path TEXT;
    `
  }
  ,
  {
    name: 'm0021_x_accounts_totp_secret',
    sql: `
    ALTER TABLE x_accounts ADD COLUMN totp_secret TEXT;
    `
  }
  ,
  {
    name: 'm0027_x_accounts_notes',
    sql: `
    ALTER TABLE x_accounts ADD COLUMN notes TEXT;
    `
  }
  ,
  {
    name: 'm0028_x_accounts_group_move_info',
    sql: `
    ALTER TABLE x_accounts ADD COLUMN last_group_name TEXT;
    ALTER TABLE x_accounts ADD COLUMN last_group_moved_at INTEGER;
    `
  },
  {
    name: 'm0029_rolex_reservations',
    sql: `
    CREATE TABLE IF NOT EXISTS rolex_reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      container_id TEXT,
      email TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      reservation_date TEXT,
      notes TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rolex_reservations_email ON rolex_reservations(email);
    CREATE INDEX IF NOT EXISTS idx_rolex_reservations_status ON rolex_reservations(status);

    CREATE TABLE IF NOT EXISTS rolex_emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT,
      used_count INTEGER DEFAULT 0,
      last_used_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rolex_emails_email ON rolex_emails(email);
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
    -- postsテーブルは廃止されました（post_libraryに統一）
    -- CREATE TABLE IF NOT EXISTS posts(
    --   id INTEGER PRIMARY KEY AUTOINCREMENT,
    --   ts TEXT, platform TEXT, account TEXT, text_hash TEXT, url TEXT, result TEXT, evidence TEXT
    -- );
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

/**
 * トランザクション内で関数を実行（同期・非同期両対応）
 * BEGIN IMMEDIATEを使用して排他ロックを取得（競合を防ぐ）
 */
export function transaction<T>(fn: () => T | Promise<T>): T | Promise<T> {
  if (!db) {
    ensureDbReady();
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    // Promiseの場合は非同期処理として扱う
    if (result instanceof Promise) {
      return result
        .then((value) => {
          db.exec('COMMIT');
          return value;
        })
        .catch((e) => {
          db.exec('ROLLBACK');
          throw e;
        });
    } else {
      // 同期処理の場合
      db.exec('COMMIT');
      return result;
    }
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
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


