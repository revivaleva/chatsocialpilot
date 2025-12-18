import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.resolve('storage', 'app.db');

try {
  const db = new Database(DB_PATH, { readonly: false });
  
  // Bannedグループを取得
  const groupRow = db.prepare('SELECT id FROM container_groups WHERE name = ?').get('Banned') as { id: string } | undefined;
  
  if (!groupRow) {
    console.log(JSON.stringify({ ok: false, error: 'Bannedグループが見つかりません' }, null, 2));
    process.exit(1);
  }
  
  const groupId = groupRow.id;
  
  // グループに属するコンテナを取得
  const containerRows = db.prepare('SELECT container_id FROM container_group_members WHERE group_id = ?').all(groupId) as Array<{ container_id: string }>;
  const containerIds = containerRows.map(r => r.container_id);
  
  console.log(`Bannedグループのコンテナ数: ${containerIds.length}件\n`);
  
  // 削除前の件数を確認
  const placeholders = containerIds.map(() => '?').join(',');
  const beforeCount = (db.prepare(`
    SELECT COUNT(*) as count FROM x_accounts 
    WHERE container_id IN (${placeholders})
  `).get(...containerIds) as { count: number })?.count || 0;
  
  console.log(`削除前のXアカウント数: ${beforeCount}件`);
  
  if (beforeCount === 0) {
    console.log('\n削除するアカウントがありません。');
    console.log(JSON.stringify({ ok: true, deleted: 0, message: 'Bannedグループのxアカウントデータはすでに削除されています' }, null, 2));
    process.exit(0);
  }
  
  // トランザクション開始
  let deletedCount = 0;
  db.transaction(() => {
    for (const containerId of containerIds) {
      const result = db.prepare('DELETE FROM x_accounts WHERE container_id = ?').run(containerId);
      deletedCount += result.changes || 0;
    }
  })();
  
  console.log(`削除件数: ${deletedCount}件\n`);
  
  // 削除後の件数を確認
  const afterCount = (db.prepare(`
    SELECT COUNT(*) as count FROM x_accounts 
    WHERE container_id IN (${placeholders})
  `).get(...containerIds) as { count: number })?.count || 0;
  
  console.log(`削除後のXアカウント数: ${afterCount}件`);
  
  console.log(JSON.stringify({
    ok: true,
    groupName: 'Banned',
    containerCount: containerIds.length,
    beforeCount,
    deleted: deletedCount,
    afterCount
  }, null, 2));
  
  db.close();
} catch (e: any) {
  console.error(JSON.stringify({ ok: false, error: String(e?.message || e) }, null, 2));
  process.exit(1);
}











