#!/usr/bin/env node
/**
 * Read presets from storage DB and print JSON.
 * Usage: node scripts/read_presets.cjs
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dbPath = path.resolve('storage', 'app.db');
if (!fs.existsSync(dbPath)) {
  console.error('DB not found at', dbPath);
  process.exit(2);
}
const db = new Database(dbPath, { readonly: true });
try {
  const rows = db.prepare('SELECT id, name, description, steps_json, created_at, updated_at FROM presets ORDER BY id DESC').all();
  console.log(JSON.stringify({ ok: true, count: rows.length, items: rows }, null, 2));
} catch (e) {
  console.error('Query error', String(e));
  process.exit(3);
}


