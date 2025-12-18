#!/usr/bin/env tsx
/**
 * プロフィール変更タスクを新しく登録し直す
 * 既存のタスクを削除してから新規登録
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
 * グループ名からグループIDを取得
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

function main() {
  const groupName = process.argv[2] || 'X兵隊12/8作成、プロフィール未変更';

  if (!groupName) {
    console.error('使い方: tsx scripts/recreate-profile-tasks.ts [グループ名]');
    console.error('');
    console.error('例:');
    console.error('  tsx scripts/recreate-profile-tasks.ts "X兵隊12/8作成、プロフィール未変更"');
    process.exit(1);
  }

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

  // 既存のタスクを削除（プリセット18、同じグループ）
  const existingTasks = query<{ id: number; runId: string }>(
    `SELECT id, runId FROM tasks 
     WHERE preset_id = 18 
     AND group_id = ?
     AND status IN ('pending', 'failed', 'waiting_failed', 'stopped', 'waiting_stopped')`,
    [groupId]
  );

  console.log(`既存のタスク（削除対象）: ${existingTasks.length}件`);

  let deletedCount = 0;
  for (const task of existingTasks) {
    try {
      // タスクを削除
      run('DELETE FROM tasks WHERE id = ?', [task.id]);
      // タスク実行ログも削除
      run('DELETE FROM task_runs WHERE runId = ?', [task.runId]);
      deletedCount++;
    } catch (e: any) {
      console.error(`✗ タスク削除エラー ${task.runId}: ${e?.message || String(e)}`);
    }
  }

  console.log(`削除したタスク数: ${deletedCount}件\n`);

  // 新しいタスクを登録
  console.log('新しいタスクを登録します\n');

  const runIds: string[] = [];
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < containerNames.length; i++) {
    const containerId = containerNames[i];

    try {
      // プロフィールテンプレートを取得
      const profileTemplate = getRandomProfileTemplate();
      if (!profileTemplate) {
        console.error(`\nエラー: 未使用のプロフィールテンプレートが見つかりませんでした（${i + 1}/${containerNames.length}件目）`);
        errorCount++;
        break;
      }

      // プロフィール画像とヘッダ画像を取得
      const profileIcon = getRandomProfileIcon();
      const headerIcon = getRandomHeaderIcon();

      if (!profileIcon) {
        console.error(`\nエラー: 未使用のプロフィール画像が見つかりませんでした（${i + 1}/${containerNames.length}件目）`);
        errorCount++;
        break;
      }

      if (!headerIcon) {
        console.error(`\nエラー: 未使用のヘッダ画像が見つかりませんでした（${i + 1}/${containerNames.length}件目）`);
        errorCount++;
        break;
      }

      console.log(`タスク ${i + 1}/${containerNames.length}:`);
      console.log(`  コンテナID: ${containerId}`);
      console.log(`  アカウント名: ${profileTemplate.account_name}`);
      console.log(`  プロフ文: ${profileTemplate.profile_text.substring(0, 50)}...`);
      console.log(`  プロフィール画像: ${profileIcon.url}`);
      console.log(`  ヘッダ画像: ${headerIcon.url}`);

      // タスクを登録（プリセット18: プロフィール変更）
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
        groupId: groupId,
      });

      runIds.push(runId);
      successCount++;

      // プロフィールテンプレートの使用状況を更新
      const now = Date.now();
      run('UPDATE profile_templates SET used_at = ? WHERE id = ?', [now, profileTemplate.id]);

      // x_accountsテーブルのx_usernameを更新
      updateXAccountUsername(containerId, profileTemplate.account_name);

      console.log(`  ✓ タスク登録完了 (Run ID: ${runId})\n`);
    } catch (e: any) {
      console.error(`  ✗ エラー: ${e?.message || String(e)}\n`);
      errorCount++;
    }
  }

  console.log('='.repeat(80));
  console.log('登録完了');
  console.log('='.repeat(80));
  console.log(`登録したタスク数: ${successCount}件`);
  if (errorCount > 0) {
    console.log(`エラー: ${errorCount}件`);
  }
  console.log('');

  if (runIds.length > 0) {
    console.log('Run ID一覧（最初の10件）:');
    runIds.slice(0, 10).forEach((runId, i) => {
      console.log(`  ${i + 1}. ${runId}`);
    });
    if (runIds.length > 10) {
      console.log(`  ... 他 ${runIds.length - 10}件`);
    }
    console.log('');
  }
}

main();















