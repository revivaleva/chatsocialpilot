import { initDb } from '../src/drivers/db';
import db from 'better-sqlite3';

initDb({ wal: true });

const database = db('storage/app.db');
const presets = database.prepare('SELECT id, name FROM presets WHERE name LIKE ? ORDER BY id').all('%メディア%');

console.log('=== X投稿（ローカルメディア使用）のプリセット ===\n');
presets.forEach((p: any) => {
  console.log(`ID: ${p.id}, 名前: ${p.name}`);
});

if (presets.length === 0) {
  console.log('メディア関連のプリセットが見つかりません');
  console.log('\nすべてのプリセット:');
  const all = database.prepare('SELECT id, name FROM presets ORDER BY id').all();
  all.forEach((p: any) => {
    console.log(`ID: ${p.id}, 名前: ${p.name}`);
  });
}
