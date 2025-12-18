import { initDb, query, run } from '../src/drivers/db';

async function main() {
  initDb({ wal: true });
  
  console.log('=== 存在しないコンテナのグループメンバーレコードを削除 ===\n');
  
  // コンテナAPIから実際に存在するコンテナIDのリストを取得
  console.log('コンテナAPIからコンテナリストを取得中...\n');
  
  let existingContainerIds = new Set<string>();
  try {
    const response = await fetch('http://localhost:5174/api/containers');
    if (response.ok) {
      const data = await response.json();
      if (data.items && Array.isArray(data.items)) {
        data.items.forEach((c: any) => {
          if (c.id) {
            existingContainerIds.add(c.id);
          }
        });
      }
    }
  } catch (e) {
    console.error('コンテナAPIから情報を取得できませんでした:', e);
    process.exit(1);
  }
  
  console.log(`✓ 存在するコンテナ数: ${existingContainerIds.size}件\n`);
  
  // 全グループメンバーを取得
  const allMembers = query<{id: number, group_id: string, container_id: string}>(
    'SELECT id, group_id, container_id FROM container_group_members'
  );
  
  console.log(`全グループメンバー数: ${allMembers.length}件\n`);
  
  // 存在しないコンテナのレコードを特定
  const missingContainers: Array<{id: number, group_id: string, container_id: string, group_name: string}> = [];
  
  for (const member of allMembers) {
    if (!existingContainerIds.has(member.container_id)) {
      // グループ名を取得
      const groups = query<{id: string, name: string}>(
        'SELECT id, name FROM container_groups WHERE id = ?',
        [member.group_id]
      );
      const groupName = groups.length > 0 ? groups[0].name : '不明';
      
      missingContainers.push({
        id: member.id,
        group_id: member.group_id,
        container_id: member.container_id,
        group_name: groupName,
      });
    }
  }
  
  if (missingContainers.length === 0) {
    console.log('✓ 存在しないコンテナのレコードはありませんでした\n');
    process.exit(0);
  }
  
  // グループごとに集計
  const byGroup: Record<string, Array<{id: number, container_id: string}>> = {};
  missingContainers.forEach(m => {
    if (!byGroup[m.group_name]) {
      byGroup[m.group_name] = [];
    }
    byGroup[m.group_name].push({ id: m.id, container_id: m.container_id });
  });
  
  console.log(`✗ 存在しないコンテナのレコード: ${missingContainers.length}件\n`);
  console.log('グループ別の内訳:');
  Object.keys(byGroup).forEach(groupName => {
    console.log(`  ${groupName}: ${byGroup[groupName].length}件`);
    byGroup[groupName].forEach(m => {
      console.log(`    - ${m.container_id}`);
    });
  });
  console.log('');
  
  // 削除を実行
  console.log('削除を実行します...\n');
  
  let deletedCount = 0;
  for (const member of missingContainers) {
    run(
      'DELETE FROM container_group_members WHERE id = ?',
      [member.id]
    );
    deletedCount++;
  }
  
  console.log(`✓ ${deletedCount}件のレコードを削除しました\n`);
  
  // 削除後の確認
  const remainingMembers = query<{count: number}>(
    'SELECT COUNT(*) as count FROM container_group_members'
  )[0];
  
  console.log(`削除後のグループメンバー数: ${remainingMembers.count}件\n`);
  
  process.exit(0);
}

main().catch((e) => {
  console.error('エラーが発生しました:', e);
  process.exit(1);
});

