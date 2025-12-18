import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.resolve('storage', 'app.db');

try {
  const db = new Database(DB_PATH, { readonly: false });
  
  // グループ名でグループIDを取得
  const groupRows = db.prepare('SELECT id FROM container_groups WHERE name = ?').all('Banned') as Array<{ id: string }>;
  
  if (!groupRows || groupRows.length === 0) {
    console.log(JSON.stringify({ ok: false, error: 'グループ "Banned" が見つかりません' }, null, 2));
    process.exit(1);
  }
  
  const groupId = groupRows[0].id;
  console.log(`グループID: ${groupId}`);
  
  // そのグループに属するコンテナIDを取得
  const memberRows = db.prepare('SELECT container_id FROM container_group_members WHERE group_id = ?').all(groupId) as Array<{ container_id: string }>;
  const containerIds = memberRows.map(r => r.container_id);
  
  console.log(`コンテナ数: ${containerIds.length}`);
  if (containerIds.length === 0) {
    console.log(JSON.stringify({ ok: true, removed: 0, message: 'グループ "Banned" にはコンテナが登録されていません' }, null, 2));
    process.exit(0);
  }
  
  // 削除前の件数を確認
  const beforeCounts: Record<string, number> = {};
  for (const containerId of containerIds) {
    const count = (db.prepare('SELECT COUNT(*) as count FROM x_accounts WHERE container_id = ?').get(containerId) as { count: number })?.count || 0;
    if (count > 0) {
      beforeCounts[containerId] = count;
    }
  }
  
  const totalBefore = Object.values(beforeCounts).reduce((sum, count) => sum + count, 0);
  console.log(`削除前のXアカウント数: ${totalBefore}`);
  
  if (totalBefore === 0) {
    console.log(JSON.stringify({ ok: true, removed: 0, message: '削除するXアカウントデータがありません' }, null, 2));
    process.exit(0);
  }
  
  // コンテナIDに紐づくx_accountsを削除
  let deletedCount = 0;
  for (const containerId of containerIds) {
    const result = db.prepare('DELETE FROM x_accounts WHERE container_id = ?').run(containerId);
    deletedCount += result.changes || 0;
  }
  
  console.log(JSON.stringify({
    ok: true,
    removed: deletedCount,
    groupName: 'Banned',
    containerCount: containerIds.length,
    details: beforeCounts
  }, null, 2));
  
  db.close();
} catch (e: any) {
  console.error(JSON.stringify({ ok: false, error: String(e?.message || e) }, null, 2));
  process.exit(1);
}

