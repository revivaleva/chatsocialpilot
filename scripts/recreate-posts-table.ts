import Database from 'better-sqlite3';
import path from 'node:path';

const dbPath = path.resolve('storage', 'app.db');
const db = new Database(dbPath);

try {
  console.log('=== 既存のpostsテーブルを削除 ===');
  db.exec('DROP TABLE IF EXISTS posts');
  console.log('削除完了\n');

  console.log('=== 新しいpostsテーブルを作成 ===');
  db.exec(`
    CREATE TABLE IF NOT EXISTS posts(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT, 
      platform TEXT, 
      account TEXT, 
      text_hash TEXT, 
      url TEXT, 
      result TEXT, 
      evidence TEXT,
      content TEXT,
      like_count INTEGER,
      rewritten_content TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_url ON posts(url);
    CREATE INDEX IF NOT EXISTS idx_posts_platform ON posts(platform);
    CREATE INDEX IF NOT EXISTS idx_posts_ts ON posts(ts);
  `);
  console.log('作成完了\n');

  // テーブル構造を確認
  const tableInfo = db.prepare("PRAGMA table_info(posts)").all();
  console.log('=== 新しいテーブル構造 ===');
  console.log(JSON.stringify(tableInfo, null, 2));
  console.log('\n');

  // インデックスを確認
  const indexes = db.prepare(`
    SELECT name, sql 
    FROM sqlite_master 
    WHERE type='index' AND tbl_name='posts'
  `).all();
  console.log('=== インデックス ===');
  console.log(JSON.stringify(indexes, null, 2));
  console.log('\n');

  console.log('=== 完了 ===');
} catch (e: any) {
  console.error('エラー:', String(e?.message || e));
  process.exit(1);
} finally {
  db.close();
}

