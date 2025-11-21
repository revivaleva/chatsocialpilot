#!/usr/bin/env node
/**
 * Read containers from the app SQLite DB and print JSON.
 * Usage: node scripts/read_containers.cjs
 *
 * Notes:
 * - On Windows the DB is expected at: %APPDATA%/container-browser/data.db
 * - On macOS/Linux it will try XDG/~/Library/Application Support fallback.
 * - Requires `better-sqlite3` installed in project or globally.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

function guessDbPath() {
  const appData = process.env.APPDATA || (process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support')
    : process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'));
  const candidates = [
    path.join(appData, 'container-browser', 'data.db'),
    path.join(process.cwd(), 'storage', 'app.db'),
    path.join(process.cwd(), 'storage', 'data.db')
  ];
  return candidates.find((p) => fs.existsSync(p));
}

const dbPath = guessDbPath();
if (!dbPath) {
  console.error('data.db not found. Checked common locations. If your app stores DB elsewhere, provide path.');
  process.exit(2);
}

try {
  const Database = require('better-sqlite3');
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare('SELECT id, name, userDataDir, partition, lastSessionId FROM containers ORDER BY rowid DESC').all();
  console.log(JSON.stringify({ ok: true, dbPath, containers: rows }, null, 2));
  process.exit(0);
} catch (e) {
  console.error('Failed to open or query DB:', e.message);
  process.exit(3);
}


