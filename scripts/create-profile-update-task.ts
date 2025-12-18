#!/usr/bin/env tsx
/**
 * グループのコンテナにプロフィール画像とヘッダ画像を設定するタスクを登録
 * 
 * 使用方法:
 *   tsx scripts/create-profile-update-task.ts <グループ名> [コンテナ数]
 */

import { initDb, query, run } from '../src/drivers/db.js';
import { enqueueTask } from '../src/services/taskQueue.js';
import { execSync } from 'child_process';

interface ProfileIcon {
  id: number;
  file_id: string;
  url: string;
}

interface HeaderIcon {
  id: number;
  file_id: string;
  url: string;
}

/**
 * 未使用のプロフィール画像をランダムに取得（使用済みマーク付き）
 */
function getRandomProfileIcon(): ProfileIcon | null {
  const icons = query<ProfileIcon>(
    'SELECT id, file_id, url FROM profile_icons WHERE used = 0 ORDER BY RANDOM() LIMIT 1'
  );

  if (icons.length === 0) {
    return null;
  }

  const icon = icons[0];
  const now = Date.now();
  run('UPDATE profile_icons SET used = 1, used_at = ? WHERE id = ?', [now, icon.id]);

  return icon;
}

/**
 * 未使用のヘッダ画像をランダムに取得（使用済みマーク付き）
 */
function getRandomHeaderIcon(): HeaderIcon | null {
  const icons = query<HeaderIcon>(
    'SELECT id, file_id, url FROM header_icons WHERE used = 0 ORDER BY RANDOM() LIMIT 1'
  );

  if (icons.length === 0) {
    return null;
  }

  const icon = icons[0];
  const now = Date.now();
  run('UPDATE header_icons SET used = 1, used_at = ? WHERE id = ?', [now, icon.id]);

  return icon;
}

/**
 * グループ名からグループIDを取得（同名グループが複数ある場合はコンテナ数が多い方を優先）
 */
function getGroupIdByName(groupName: string): string | null {
  const groups = query<{ id: string; name: string }>(
    'SELECT id, name FROM container_groups WHERE name = ?',
    [groupName]
  );

  if (groups.length === 0) {
    return null;
  }

  // 同名グループが1つだけの場合はそのまま返す
  if (groups.length === 1) {
    return groups[0].id;
  }

  // 同名グループが複数ある場合、コンテナ数が多い方を選択
  let bestGroup = groups[0];
  let maxContainerCount = 0;

  for (const group of groups) {
    const containerCount = query<{ count: number }>(
      'SELECT COUNT(*) as count FROM container_group_members WHERE group_id = ?',
      [group.id]
    )[0]?.count || 0;

    if (containerCount > maxContainerCount) {
      maxContainerCount = containerCount;
      bestGroup = group;
    }
  }

  return bestGroup.id;
}

/**
 * グループに属するコンテナID一覧を取得
 */
function getContainerIdsByGroupId(groupId: string): string[] {
  const members = query<{ container_id: string }>(
    'SELECT container_id FROM container_group_members WHERE group_id = ?',
    [groupId]
  );

  return members.map(m => m.container_id);
}

/**
 * メイン処理
 */
async function main(): Promise<void> {
  const groupName = process.argv[2];
  const countArg = process.argv[3];
  const taskCount = countArg ? parseInt(countArg, 10) : 1;

  if (!groupName) {
    console.error('使い方: tsx scripts/create-profile-update-task.ts <グループ名> [タスク数]');
    console.error('');
    console.error('例:');
    console.error('  tsx scripts/create-profile-update-task.ts "X兵隊12/5作成"');
    console.error('  tsx scripts/create-profile-update-task.ts "X兵隊12/5作成" 5');
    process.exit(1);
  }

  // DB初期化
  initDb();

  // グループIDを取得
  const groupId = getGroupIdByName(groupName);
  if (!groupId) {
    console.error(`エラー: グループ "${groupName}" が見つかりませんでした`);
    process.exit(1);
  }

  console.log(`グループ: ${groupName} (ID: ${groupId})\n`);

  // コンテナID一覧を取得
  const containerIds = getContainerIdsByGroupId(groupId);
  if (containerIds.length === 0) {
    console.error(`エラー: グループ "${groupName}" にコンテナがありません`);
    process.exit(1);
  }

  console.log(`グループ内のコンテナ数: ${containerIds.length}件`);
  console.log(`登録するタスク数: ${taskCount}件\n`);

  if (taskCount > containerIds.length) {
    console.error(`エラー: タスク数(${taskCount})がコンテナ数(${containerIds.length})を超えています`);
    process.exit(1);
  }

  // タスク登録
  const runIds: string[] = [];
  for (let i = 0; i < taskCount; i++) {
    const containerId = containerIds[i];

    // プロフィール画像とヘッダ画像を取得
    const profileIcon = getRandomProfileIcon();
    const headerIcon = getRandomHeaderIcon();

    if (!profileIcon) {
      console.error(`エラー: 未使用のプロフィール画像が見つかりませんでした`);
      process.exit(1);
    }

    if (!headerIcon) {
      console.error(`エラー: 未使用のヘッダ画像が見つかりませんでした`);
      process.exit(1);
    }

    console.log(`タスク ${i + 1}/${taskCount}:`);
    console.log(`  コンテナID: ${containerId}`);
    console.log(`  プロフィール画像: ${profileIcon.url}`);
    console.log(`  ヘッダ画像: ${headerIcon.url}`);

    // タスクを登録（プリセット18: プロフィール変更）
    const runId = enqueueTask({
      presetId: 18,
      containerId: containerId,
      overrides: {
        // name, bio, location, website は未指定（変更しない）
        avatar_image_path: profileIcon.url,
        banner_image_path: headerIcon.url,
      },
      waitMinutes: 10,
    });

    runIds.push(runId);
    console.log(`  ✓ タスク登録完了 (Run ID: ${runId})\n`);
  }

  console.log('='.repeat(80));
  console.log('登録完了');
  console.log('='.repeat(80));
  console.log(`登録したタスク数: ${runIds.length}件\n`);

  console.log('Run ID一覧:');
  runIds.forEach((runId, i) => {
    console.log(`  ${i + 1}. ${runId}`);
  });

  console.log('\n統計情報:');
  
  // プロフィール画像統計
  const profileStats = query(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN used = 0 THEN 1 ELSE 0 END) as unused,
      SUM(CASE WHEN used = 1 THEN 1 ELSE 0 END) as used
    FROM profile_icons
  `)[0] as any;
  console.log(`プロフィール画像: 合計${profileStats.total}件（未使用${profileStats.unused}件、使用済み${profileStats.used}件）`);

  // ヘッダ画像統計
  const headerStats = query(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN used = 0 THEN 1 ELSE 0 END) as unused,
      SUM(CASE WHEN used = 1 THEN 1 ELSE 0 END) as used
    FROM header_icons
  `)[0] as any;
  console.log(`ヘッダ画像: 合計${headerStats.total}件（未使用${headerStats.unused}件、使用済み${headerStats.used}件）`);
}

main().catch((err) => {
  console.error('エラーが発生しました:', err);
  process.exit(1);
});
