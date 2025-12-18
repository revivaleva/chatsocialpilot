import { initDb, run } from '../src/drivers/db';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// CSVファイルからダブルクォート囲みのデータを読み込む
function parseQuotedCsv(csvContent: string): string[] {
  const posts: string[] = [];
  const lines = csvContent.split('\n');
  
  let currentPost = '';
  let inQuotes = false;
  
  for (let i = 1; i < lines.length; i++) { // ヘッダー行をスキップ
    const line = lines[i];
    
    if (!inQuotes) {
      if (line.startsWith('"')) {
        // 新しい投稿の開始
        if (line.endsWith('"') && !line.endsWith('""')) {
          // 1行で完結
          posts.push(line.slice(1, -1).replace(/""/g, '"'));
        } else {
          // 複数行にまたがる
          currentPost = line.slice(1);
          inQuotes = true;
        }
      }
    } else {
      if (line.endsWith('"') && !line.endsWith('""')) {
        // 投稿の終了
        currentPost += '\n' + line.slice(0, -1);
        posts.push(currentPost.replace(/""/g, '"'));
        currentPost = '';
        inQuotes = false;
      } else {
        // 投稿の継続
        currentPost += '\n' + line;
      }
    }
  }
  
  return posts.filter(p => p.trim().length > 0);
}

async function main() {
  initDb({ wal: true });
  
  const csvPath = path.join(__dirname, '../docs/beauty_posts_1000_quoted.csv');
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const posts = parseQuotedCsv(csvContent);
  
  const now = Date.now();
  let success = 0;
  let errors = 0;
  
  console.log(`開始: ${posts.length}件の投稿を追加します...`);
  
  for (const rewrittenContent of posts) {
    try {
      run(
        `INSERT INTO post_library (
          content,
          rewritten_content,
          used,
          like_count,
          source_url,
          download_status,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          '',                    // content: 空文字列
          rewrittenContent,      // rewritten_content: リライト後の文章
          0,                     // used: 未使用
          null,                  // like_count: NULL
          null,                  // source_url: NULL
          'success',             // download_status: 'success' (メディア無しだが成功状態)
          now,                   // created_at
          now                    // updated_at
        ]
      );
      success++;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`エラー: ${message}`);
      errors++;
    }
  }
  
  console.log(`完了: 成功 ${success}件, エラー ${errors}件`);
}

main().catch(console.error);
