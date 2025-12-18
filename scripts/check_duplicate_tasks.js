// 重複タスクを確認するスクリプト
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dbPath = path.resolve('storage', 'app.db');

if (!fs.existsSync(dbPath)) {
  console.error('Database not found:', dbPath);
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });

console.log('=== 重複タスクの確認 ===\n');

try {
  // 同じコンテナ、同じプリセット、同じステータス（pending）のタスクを検出
  const duplicates = db.prepare(`
    SELECT 
      container_id,
      preset_id,
      status,
      COUNT(*) as count,
      GROUP_CONCAT(id) as ids,
      GROUP_CONCAT(runId) as runIds,
      MIN(created_at) as oldest_created_at,
      MAX(created_at) as newest_created_at
    FROM tasks
    WHERE status = 'pending'
      AND container_id IS NOT NULL
      AND container_id != ''
    GROUP BY container_id, preset_id, status
    HAVING COUNT(*) > 1
    ORDER BY count DESC, container_id, preset_id
  `).all();

  if (duplicates.length === 0) {
    console.log('重複タスクは見つかりませんでした。');
  } else {
    console.log(`重複タスクが見つかりました: ${duplicates.length}件のグループ\n`);
    
    let totalDuplicates = 0;
    duplicates.forEach((dup, index) => {
      const ids = dup.ids.split(',').map(id => Number(id.trim()));
      const runIds = dup.runIds.split(',');
      const keepId = ids[0]; // 最も古いタスクを保持
      const deleteIds = ids.slice(1); // 残りを削除対象
      
      totalDuplicates += deleteIds.length;
      
      console.log(`グループ ${index + 1}:`);
      console.log(`  コンテナID: ${dup.container_id}`);
      console.log(`  プリセットID: ${dup.preset_id}`);
      console.log(`  ステータス: ${dup.status}`);
      console.log(`  重複数: ${dup.count}件`);
      console.log(`  保持するタスク: ID=${keepId}, runId=${runIds[0]}`);
      console.log(`  削除対象タスク: ${deleteIds.length}件`);
      deleteIds.forEach((id, i) => {
        console.log(`    - ID=${id}, runId=${runIds[i + 1]}`);
      });
      console.log('');
    });
    
    console.log(`\n合計削除対象: ${totalDuplicates}件`);
    console.log(`\n削除を実行するには、--delete オプションを指定してください。`);
    console.log(`例: node scripts/check_duplicate_tasks.js --delete`);
  }
} catch (e) {
  console.error('Error:', e.message);
  console.error(e.stack);
} finally {
  db.close();
}

// --delete オプションが指定されている場合、重複タスクを削除
if (process.argv.includes('--delete')) {
  console.log('\n=== 重複タスクの削除を実行します ===\n');
  const dbWrite = new Database(dbPath);
  
  try {
    dbWrite.transaction(() => {
      const duplicates = dbWrite.prepare(`
        SELECT 
          container_id,
          preset_id,
          status,
          GROUP_CONCAT(id) as ids,
          MIN(created_at) as oldest_created_at
        FROM tasks
        WHERE status = 'pending'
          AND container_id IS NOT NULL
          AND container_id != ''
        GROUP BY container_id, preset_id, status
        HAVING COUNT(*) > 1
      `).all();

      let deletedCount = 0;
      
      duplicates.forEach(dup => {
        const ids = dup.ids.split(',').map(id => Number(id.trim()));
        const keepId = ids[0]; // 最も古いタスクを保持
        const deleteIds = ids.slice(1); // 残りを削除対象
        
        deleteIds.forEach(id => {
          const result = dbWrite.prepare('DELETE FROM tasks WHERE id = ?').run(id);
          if (result.changes > 0) {
            deletedCount++;
            console.log(`削除: ID=${id} (コンテナ=${dup.container_id}, プリセット=${dup.preset_id})`);
          }
        });
      });
      
      console.log(`\n削除完了: ${deletedCount}件のタスクを削除しました。`);
    })();
  } catch (e) {
    console.error('削除エラー:', e.message);
    console.error(e.stack);
  } finally {
    dbWrite.close();
  }
}

