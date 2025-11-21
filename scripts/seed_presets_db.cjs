#!/usr/bin/env node
/**
 * Seed presets directly into storage/app.db from patterns/*.json
 * Usage: node scripts/seed_presets_db.cjs
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.resolve('storage', 'app.db');
if (!fs.existsSync(dbPath)) {
  console.error('DB not found at', dbPath);
  process.exit(2);
}

function loadPattern(p) {
  const txt = fs.readFileSync(path.resolve(p), 'utf8');
  return JSON.parse(txt);
}

const patterns = [
  'patterns/sample_single_like.json',
  'patterns/sample_scan_like.json'
].map(p => ({ path: p, obj: loadPattern(p) }));

const db = new Database(dbPath);
try {
  const insert = db.prepare('INSERT INTO presets(name,description,steps_json,created_at,updated_at) VALUES(?,?,?,?,?)');
  for (const pat of patterns) {
    const name = pat.obj.name || path.basename(pat.path);
    const desc = pat.obj.description || '';
    const steps = JSON.stringify(pat.obj.steps || pat.obj.steps || []);
    const now = Date.now();
    const info = insert.run(name, desc, steps, now, now);
    console.log('Inserted preset id=', info.lastInsertRowid, 'name=', name);
  }
  console.log('Done seeding presets.');
} catch (e) {
  console.error('DB insert failed', String(e));
  process.exit(3);
} finally {
  db.close();
}


