import Database from 'better-sqlite3';
import path from 'node:path';

const dbPath = path.resolve('storage', 'app.db');
const db = new Database(dbPath);

try {
  console.log('=== 既存のpostsテーブルを削除 ===');
  db.exec('DROP TABLE IF EXISTS posts');
  console.log('削除完了\n');

  console.log('=== 新しいpostsテーブルを作成（日時・フラグ追加版） ===');
  db.exec(`
    CREATE TABLE IF NOT EXISTS posts(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT UNIQUE NOT NULL,
      content TEXT,
      like_count INTEGER,
      rewritten_content TEXT,
      created_at INTEGER NOT NULL,
      used_at INTEGER,
      used INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_posts_url ON posts(url);
    CREATE INDEX IF NOT EXISTS idx_posts_used ON posts(used);
    CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at);
    CREATE INDEX IF NOT EXISTS idx_posts_used_at ON posts(used_at);
  `);
  console.log('作成完了\n');

  // テーブル構造を確認
  const tableInfo = db.prepare("PRAGMA table_info(posts)").all();
  console.log('=== 新しいテーブル構造 ===');
  console.log(JSON.stringify(tableInfo, null, 2));
  console.log('\n');

  // インデックスと制約を確認
  const indexes = db.prepare(`
    SELECT name, sql, type
    FROM sqlite_master 
    WHERE type='index' AND tbl_name='posts'
  `).all();
  console.log('=== インデックス ===');
  console.log(JSON.stringify(indexes, null, 2));
  console.log('\n');

  // UNIQUE制約の確認
  const tableSql = db.prepare(`
    SELECT sql
    FROM sqlite_master 
    WHERE type='table' AND name='posts'
  `).get() as { sql: string } | undefined;
  
  if (tableSql) {
    console.log('=== テーブル定義 ===');
    console.log(tableSql.sql);
    console.log('\n');
    
    if (tableSql.sql.includes('UNIQUE') || tableSql.sql.includes('url TEXT UNIQUE')) {
      console.log('✓ URLカラムにUNIQUE制約が設定されています');
    }
  }

  console.log('\n=== 完了 ===');
} catch (e: any) {
  console.error('エラー:', String(e?.message || e));
  process.exit(1);
} finally {
  db.close();
}

