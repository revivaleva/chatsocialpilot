import Database from 'better-sqlite3';
import path from 'node:path';

const dbPath = path.resolve('storage', 'app.db');
const db = new Database(dbPath);

try {
  console.log('=== 既存のpostsテーブルを削除 ===');
  db.exec('DROP TABLE IF EXISTS posts');
  console.log('削除完了\n');

  console.log('=== 新しいpostsテーブルを作成（不要カラム削除版） ===');
  db.exec(`
    CREATE TABLE IF NOT EXISTS posts(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT UNIQUE NOT NULL,
      content TEXT,
      like_count INTEGER,
      rewritten_content TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_posts_url ON posts(url);
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

  // UNIQUE制約の確認（sqlite_masterから）
  const tableSql = db.prepare(`
    SELECT sql
    FROM sqlite_master 
    WHERE type='table' AND name='posts'
  `).get() as { sql: string } | undefined;
  
  if (tableSql) {
    console.log('=== テーブル定義（UNIQUE制約確認） ===');
    console.log(tableSql.sql);
    console.log('\n');
    
    // UNIQUE制約が含まれているか確認
    if (tableSql.sql.includes('UNIQUE') || tableSql.sql.includes('url TEXT UNIQUE')) {
      console.log('✓ URLカラムにUNIQUE制約が設定されています');
    } else {
      console.log('✗ URLカラムにUNIQUE制約が設定されていません');
    }
  }

  console.log('\n=== 完了 ===');
} catch (e: any) {
  console.error('エラー:', String(e?.message || e));
  process.exit(1);
} finally {
  db.close();
}

