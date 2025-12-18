#!/usr/bin/env tsx
/**
 * グループから1件のコンテナを選んでプロフィール変更タスクをタスク1に登録
 * 
 * 使用方法:
 *   tsx scripts/create-single-profile-task-to-task1.ts <グループ名>
 * 
 * 例:
 *   tsx scripts/create-single-profile-task-to-task1.ts "X兵隊12/17作成、プロフィール未変更"
 */

import { initDb, query, run } from '../src/drivers/db.js';
import { enqueueTask } from '../src/services/taskQueue.js';
import Database from 'better-sqlite3';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

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

interface ProfileTemplate {
  id: number;
  account_name: string;
  profile_text: string;
}

/**
 * 未使用のプロフィールテンプレートをランダムに取得
 */
function getRandomProfileTemplate(): ProfileTemplate | null {
  const templates = query<ProfileTemplate>(
    'SELECT id, account_name, profile_text FROM profile_templates WHERE used_at IS NULL ORDER BY RANDOM() LIMIT 1'
  );

  if (templates.length === 0) {
    return null;
  }

  return templates[0];
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

  if (groups.length === 1) {
    return groups[0].id;
  }

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
 * コンテナDBからコンテナ情報を取得
 */
function getContainersFromDb(): Array<{ id: string; name: string }> {
  const dbPath = process.env.DEFAULT_CB_DB || path.join(
    os.platform() === 'win32' 
      ? (process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'))
      : path.join(os.homedir(), '.config'),
    'container-browser',
    'data.db'
  );
  
  if (!fs.existsSync(dbPath)) {
    return [];
  }
  
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare(`
    SELECT id, name
    FROM containers ORDER BY updatedAt DESC
  `).all();
  
  return rows.map((r: any) => ({ id: r.id, name: r.name || r.id }));
}

/**
 * グループに属するコンテナ名一覧を取得（UUIDからコンテナ名に変換）
 */
function getContainerNamesByGroupId(groupId: string): string[] {
  const members = query<{ container_id: string }>(
    'SELECT container_id FROM container_group_members WHERE group_id = ?',
    [groupId]
  );

  const containers = getContainersFromDb();
  const containerMap = new Map<string, string>();
  for (const c of containers) {
    containerMap.set(c.id, c.name);
  }

  const containerNames: string[] = [];
  for (const m of members) {
    const containerName = containerMap.get(m.container_id);
    if (containerName) {
      containerNames.push(containerName);
    } else {
      // UUIDが見つからない場合は無視（コンテナDBに存在しないため実行不可）
      console.warn(`警告: コンテナDBに存在しないUUIDをスキップします: ${m.container_id}`);
    }
  }

  return containerNames;
}

/**
 * x_accountsテーブルのx_usernameを更新
 */
function updateXAccountUsername(containerId: string, username: string): void {
  const now = Date.now();
  run(
    'UPDATE x_accounts SET x_username = ?, updated_at = ? WHERE container_id = ?',
    [username, now, containerId]
  );
}

/**
 * メイン処理
 */
async function main(): Promise<void> {
  const groupName = process.argv[2];

  if (!groupName) {
    console.error('使い方: tsx scripts/create-single-profile-task-to-task1.ts <グループ名>');
    console.error('');
    console.error('例:');
    console.error('  tsx scripts/create-single-profile-task-to-task1.ts "X兵隊12/17作成、プロフィール未変更"');
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

  // コンテナ名一覧を取得（UUIDからコンテナ名に変換）
  const containerNames = getContainerNamesByGroupId(groupId);
  if (containerNames.length === 0) {
    console.error(`エラー: グループ "${groupName}" にコンテナがありません`);
    process.exit(1);
  }

  console.log(`グループ内のコンテナ数: ${containerNames.length}件`);

  // 既にタスクが登録されているコンテナを確認（プリセット18、すべてのステータス、タスク1のみ）
  const existingTasks = query<{ container_id: string }>(
    `SELECT container_id FROM tasks 
     WHERE preset_id = 18 AND container_id IS NOT NULL 
     AND (queue_name = 'default' OR queue_name = 'タスク1')`
  );

  const registeredContainers = new Set<string>();
  for (const task of existingTasks) {
    if (task.container_id) {
      registeredContainers.add(task.container_id);
      // UUIDの場合はコンテナ名に変換して追加
      const containers = getContainersFromDb();
      const uuidToName = new Map<string, string>();
      for (const c of containers) {
        uuidToName.set(c.id, c.name);
      }
      const containerName = uuidToName.get(task.container_id);
      if (containerName) {
        registeredContainers.add(containerName);
      }
    }
  }

  // 未登録のコンテナを抽出
  const unregisteredContainers = containerNames.filter(name => !registeredContainers.has(name));

  if (unregisteredContainers.length === 0) {
    console.log('すべてのコンテナにタスク1のプロフィール変更タスクが登録済みです。');
    process.exit(0);
  }

  console.log(`未登録コンテナ数: ${unregisteredContainers.length}件`);
  console.log(`1件のタスクをタスク1に登録します\n`);

  // 最初の1件のコンテナに対してタスクを登録
  const containerId = unregisteredContainers[0];

  try {
    // プロフィールテンプレートを取得
    const profileTemplate = getRandomProfileTemplate();
    if (!profileTemplate) {
      console.error('エラー: 未使用のプロフィールテンプレートが見つかりませんでした');
      process.exit(1);
    }

    // プロフィール画像とヘッダ画像を取得
    const profileIcon = getRandomProfileIcon();
    if (!profileIcon) {
      console.error('エラー: 未使用のプロフィール画像が見つかりませんでした');
      process.exit(1);
    }

    let headerIcon = getRandomHeaderIcon();
    
    // 未使用のヘッダ画像がなくなった場合、フラグをリセットして再利用
    if (!headerIcon) {
      console.log('未使用のヘッダ画像がなくなりました。フラグをリセットして再利用します...');
      run('UPDATE header_icons SET used = 0, used_at = NULL');
      console.log('ヘッダ画像のフラグをリセットしました。');
      
      // リセット後に再度取得
      headerIcon = getRandomHeaderIcon();
      if (!headerIcon) {
        console.error('エラー: ヘッダ画像が見つかりませんでした');
        process.exit(1);
      }
    }

    console.log('タスク登録情報:');
    console.log(`  コンテナID: ${containerId}`);
    console.log(`  アカウント名: ${profileTemplate.account_name}`);
    console.log(`  プロフ文: ${profileTemplate.profile_text.substring(0, 50)}...`);
    console.log(`  プロフィール画像: ${profileIcon.url}`);
    console.log(`  ヘッダ画像: ${headerIcon.url}`);

    // タスクを登録（プリセット18: プロフィール変更、タスク1: queue_name = 'default'）
    const runId = enqueueTask({
      presetId: 18,
      containerId: containerId,
      overrides: {
        name: profileTemplate.account_name,
        bio: profileTemplate.profile_text,
        location: '',
        website: '',
        avatar_image_path: profileIcon.url,
        banner_image_path: headerIcon.url,
      },
      waitMinutes: 10,
    }, 'default'); // タスク1に登録

    // プロフィールテンプレートの使用状況を更新
    const now = Date.now();
    run('UPDATE profile_templates SET used_at = ? WHERE id = ?', [now, profileTemplate.id]);

    // x_accountsテーブルのx_usernameを更新
    updateXAccountUsername(containerId, profileTemplate.account_name);

    console.log(`\n✓ タスク登録完了 (Run ID: ${runId})`);
    console.log(`  キュー: タスク1 (default)`);
  } catch (e: any) {
    console.error(`✗ エラー: ${e?.message || String(e)}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('エラーが発生しました:', err);
  process.exit(1);
});
