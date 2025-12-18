import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.resolve('storage', 'app.db');

try {
  const db = new Database(DB_PATH, { readonly: false });
  
  // 1. Bannedグループを取得
  console.log('=== Bannedグループとロックメール未変更グループのXアカウントデータ削除 ===\n');
  console.log('1. グループを検索中...\n');
  
  const bannedGroup = db.prepare('SELECT id, name FROM container_groups WHERE name = ?').get('Banned') as { id: string; name: string } | undefined;
  
  if (!bannedGroup) {
    console.log('⚠️  Bannedグループが見つかりません');
  } else {
    console.log(`   ✓ Bannedグループ: "${bannedGroup.name}" (ID: ${bannedGroup.id})`);
  }
  
  // 2. ロックメール未変更グループを取得
  const lockedGroup = db.prepare(`SELECT id, name FROM container_groups WHERE name LIKE '%ロックメール未変更%' LIMIT 1`).get() as { id: string; name: string } | undefined;
  
  if (!lockedGroup) {
    console.log('⚠️  ロックメール未変更グループが見つかりません');
  } else {
    console.log(`   ✓ ロックメール未変更グループ: "${lockedGroup.name}" (ID: ${lockedGroup.id})`);
  }
  
  if (!bannedGroup && !lockedGroup) {
    console.log('\n❌ 対象グループが見つかりませんでした');
    console.log(JSON.stringify({ ok: false, error: '対象グループが見つかりません' }, null, 2));
    process.exit(1);
  }
  
  console.log('');
  
  // 3. 各グループに属するコンテナIDを取得（重複を除去）
  const allContainerIds = new Set<string>();
  const groupInfo: Array<{ name: string; id: string; containerIds: string[] }> = [];
  
  if (bannedGroup) {
    const containerRows = db.prepare('SELECT container_id FROM container_group_members WHERE group_id = ?').all(bannedGroup.id) as Array<{ container_id: string }>;
    const containerIds = containerRows.map(r => r.container_id);
    containerIds.forEach(id => allContainerIds.add(id));
    groupInfo.push({ name: bannedGroup.name, id: bannedGroup.id, containerIds });
    console.log(`2. Bannedグループのコンテナ数: ${containerIds.length}件`);
  }
  
  if (lockedGroup) {
    const containerRows = db.prepare('SELECT container_id FROM container_group_members WHERE group_id = ?').all(lockedGroup.id) as Array<{ container_id: string }>;
    const containerIds = containerRows.map(r => r.container_id);
    containerIds.forEach(id => allContainerIds.add(id));
    groupInfo.push({ name: lockedGroup.name, id: lockedGroup.id, containerIds });
    console.log(`3. ロックメール未変更グループのコンテナ数: ${containerIds.length}件`);
  }
  
  const uniqueContainerIds = Array.from(allContainerIds);
  console.log(`\n   合計ユニークコンテナ数: ${uniqueContainerIds.length}件\n`);
  
  if (uniqueContainerIds.length === 0) {
    console.log('削除するコンテナがありません。');
    console.log(JSON.stringify({ ok: true, deleted: 0, message: '対象グループにコンテナが登録されていません' }, null, 2));
    process.exit(0);
  }
  
  // 4. 削除前の件数を確認
  const placeholders = uniqueContainerIds.map(() => '?').join(',');
  const beforeCount = (db.prepare(`
    SELECT COUNT(*) as count FROM x_accounts 
    WHERE container_id IN (${placeholders})
  `).get(...uniqueContainerIds) as { count: number })?.count || 0;
  
  console.log(`4. 削除前のXアカウント数: ${beforeCount}件`);
  
  if (beforeCount === 0) {
    console.log('\n削除するアカウントがありません。');
    console.log(JSON.stringify({ 
      ok: true, 
      deleted: 0, 
      message: '対象グループのxアカウントデータはすでに削除されています',
      groups: groupInfo.map(g => ({ name: g.name, containerCount: g.containerIds.length }))
    }, null, 2));
    process.exit(0);
  }
  
  // 5. トランザクションで削除実行
  console.log('\n5. 削除を実行中...');
  let deletedCount = 0;
  db.transaction(() => {
    for (const containerId of uniqueContainerIds) {
      const result = db.prepare('DELETE FROM x_accounts WHERE container_id = ?').run(containerId);
      deletedCount += result.changes || 0;
    }
  })();
  
  console.log(`   削除件数: ${deletedCount}件\n`);
  
  // 6. 削除後の件数を確認
  const afterCount = (db.prepare(`
    SELECT COUNT(*) as count FROM x_accounts 
    WHERE container_id IN (${placeholders})
  `).get(...uniqueContainerIds) as { count: number })?.count || 0;
  
  console.log(`6. 削除後のXアカウント数: ${afterCount}件`);
  
  // 7. 結果をJSON形式で出力
  const result = {
    ok: true,
    groups: groupInfo.map(g => ({
      name: g.name,
      id: g.id,
      containerCount: g.containerIds.length
    })),
    totalContainerCount: uniqueContainerIds.length,
    beforeCount,
    deleted: deletedCount,
    afterCount
  };
  
  console.log('\n=== 削除完了 ===');
  console.log(JSON.stringify(result, null, 2));
  
  db.close();
} catch (e: any) {
  console.error('\n❌ エラーが発生しました:');
  console.error(JSON.stringify({ ok: false, error: String(e?.message || e) }, null, 2));
  process.exit(1);
}



