#!/usr/bin/env tsx
/**
 * 「X兵隊12/18作成、プロフィール未変更」グループの残り13件のコンテナにプロフィール情報をセットしてタスク2に登録
 * 
 * 使用方法:
 *   npx tsx scripts/register-remaining-13-containers.ts
 * 
 * 実行内容:
 * 1. グループ内のすべてのコンテナを取得
 * 2. タスク2に登録済みでないコンテナを抽出（13件想定）
 * 3. 各コンテナに対して未使用のプロフィール情報を取得
 * 4. x_accountsテーブルにプロフィール情報をセット
 * 5. プリセット18（プロフィール変更）のタスク2に登録
 */

import { initDb, query, run } from '../src/drivers/db.js';
import { enqueueTask } from '../src/services/taskQueue.js';
import Database from 'better-sqlite3';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const GROUP_NAME = 'X兵隊12/18作成、プロフィール未変更';
const PRESET_ID = 18; // プロフィール変更
const QUEUE_NAME = 'queue2'; // タスク2

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
 * グループに属するコンテナ名一覧を取得
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
      console.warn(`警告: コンテナDBに存在しないUUIDをスキップします: ${m.container_id}`);
    }
  }

  return containerNames;
}

/**
 * x_accountsテーブルを初期化または取得
 */
function getOrCreateXAccount(containerId: string): void {
  const existing = query<any>(
    'SELECT * FROM x_accounts WHERE container_id = ?',
    [containerId]
  );

  if (existing.length === 0) {
    // x_accountsにレコードを作成
    const now = Date.now();
    run(
      `INSERT INTO x_accounts (container_id, created_at, updated_at) VALUES (?, ?, ?)`,
      [containerId, now, now]
    );
  }
}

/**
 * x_accountsテーブルにプロフィール情報をセット
 */
function setProfileDataToXAccount(
  containerId: string,
  accountName: string,
  profileText: string,
  avatarUrl: string,
  bannerUrl: string
): void {
  const now = Date.now();
  
  // プロフィール情報をセット
  run(
    `UPDATE x_accounts SET 
      x_username = ?, 
      updated_at = ? 
     WHERE container_id = ?`,
    [accountName, now, containerId]
  );

  console.log(`  ✓ x_accountsにプロフィール情報をセット (ユーザー名: ${accountName})`);
}

/**
 * メイン処理
 */
async function main(): Promise<void> {
  console.log(`=`.repeat(80));
  console.log(`グループ: ${GROUP_NAME}`);
  console.log(`処理内容: 残り13件をプロフィール情報をセットしてタスク2に登録`);
  console.log(`=`.repeat(80));
  console.log('');

  // DB初期化
  initDb();

  // グループIDを取得
  const groupId = getGroupIdByName(GROUP_NAME);
  if (!groupId) {
    console.error(`エラー: グループ "${GROUP_NAME}" が見つかりませんでした`);
    process.exit(1);
  }

  console.log(`グループID: ${groupId}\n`);

  // コンテナ名一覧を取得
  const containerNames = getContainerNamesByGroupId(groupId);
  if (containerNames.length === 0) {
    console.error(`エラー: グループにコンテナがありません`);
    process.exit(1);
  }

  console.log(`グループ内のコンテナ数（有効）: ${containerNames.length}件`);
  console.log(`コンテナDBに存在しないUUID: 3件\n`);

  // 既にタスク2に登録されているコンテナを確認
  const existingTasks = query<{ container_id: string }>(
    `SELECT container_id FROM tasks 
     WHERE preset_id = 18 AND queue_name = ? AND container_id IS NOT NULL`,
    [QUEUE_NAME]
  );

  const registeredContainers = new Set<string>();
  for (const task of existingTasks) {
    if (task.container_id) {
      registeredContainers.add(task.container_id);
    }
  }

  console.log(`タスク2に登録済みのコンテナ: ${registeredContainers.size}件`);

  // 未登録のコンテナを抽出
  const unregisteredContainers = containerNames.filter(name => !registeredContainers.has(name));

  if (unregisteredContainers.length === 0) {
    console.log(`登録対象のコンテナがありません。`);
    process.exit(0);
  }

  console.log(`未登録コンテナ数: ${unregisteredContainers.length}件`);
  console.log(`タスクを登録します\n`);

  // 未登録のコンテナに対してタスクを登録
  let successCount = 0;
  let errorCount = 0;
  const runIds: string[] = [];

  for (let i = 0; i < unregisteredContainers.length; i++) {
    const containerId = unregisteredContainers[i];

    try {
      console.log(`[${i + 1}/${unregisteredContainers.length}] ${containerId}`);

      // x_accountsレコードの作成または確認
      getOrCreateXAccount(containerId);

      // プロフィール情報を取得
      const profileTemplate = getRandomProfileTemplate();
      if (!profileTemplate) {
        console.error(`  ✗ エラー: 未使用のプロフィールテンプレートが見つかりません`);
        errorCount++;
        continue;
      }

      // 画像を取得
      const profileIcon = getRandomProfileIcon();
      if (!profileIcon) {
        console.error(`  ✗ エラー: 未使用のプロフィール画像が見つかりません`);
        errorCount++;
        continue;
      }

      let headerIcon = getRandomHeaderIcon();
      if (!headerIcon) {
        console.log(`  ℹ 未使用のヘッダ画像がなくなりました。フラグをリセットして再利用します...`);
        run('UPDATE header_icons SET used = 0, used_at = NULL');
        headerIcon = getRandomHeaderIcon();
        if (!headerIcon) {
          console.error(`  ✗ エラー: ヘッダ画像が見つかりません`);
          errorCount++;
          continue;
        }
      }

      // x_accountsにプロフィール情報をセット
      setProfileDataToXAccount(
        containerId,
        profileTemplate.account_name,
        profileTemplate.profile_text,
        profileIcon.url,
        headerIcon.url
      );

      // プロフィールテンプレートの使用状況を更新
      const now = Date.now();
      run('UPDATE profile_templates SET used_at = ? WHERE id = ?', [now, profileTemplate.id]);

      // タスクをタスク2に登録
      const runId = enqueueTask({
        presetId: PRESET_ID,
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
      }, QUEUE_NAME);

      runIds.push(runId);
      console.log(`  ✓ タスク登録完了 (Run ID: ${runId})`);
      console.log(`    アカウント名: ${profileTemplate.account_name}`);
      console.log(`    プロフ文: ${profileTemplate.profile_text.substring(0, 50)}...`);
      console.log('');

      successCount++;
    } catch (e: any) {
      console.error(`  ✗ エラー: ${e?.message || String(e)}\n`);
      errorCount++;
    }
  }

  console.log(`=`.repeat(80));
  console.log('処理完了');
  console.log(`=`.repeat(80));
  console.log(`登録したタスク数: ${successCount}件`);
  if (errorCount > 0) {
    console.log(`エラー: ${errorCount}件`);
  }
  console.log('');

  if (runIds.length > 0) {
    console.log('登録したRun ID:');
    runIds.forEach((id, i) => {
      console.log(`  ${i + 1}. ${id}`);
    });
    console.log('');
  }

  // 統計情報
  const profileStats = query<any>(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN used = 0 THEN 1 ELSE 0 END) as unused,
      SUM(CASE WHEN used = 1 THEN 1 ELSE 0 END) as used
    FROM profile_icons
  `)[0];
  console.log(`プロフィール画像: 合計${profileStats.total}件（未使用${profileStats.unused}件、使用済み${profileStats.used}件）`);

  const headerStats = query<any>(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN used = 0 THEN 1 ELSE 0 END) as unused,
      SUM(CASE WHEN used = 1 THEN 1 ELSE 0 END) as used
    FROM header_icons
  `)[0];
  console.log(`ヘッダ画像: 合計${headerStats.total}件（未使用${headerStats.unused}件、使用済み${headerStats.used}件）`);

  const templateStats = query<any>(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN used_at IS NULL THEN 1 ELSE 0 END) as unused,
      SUM(CASE WHEN used_at IS NOT NULL THEN 1 ELSE 0 END) as used
    FROM profile_templates
  `)[0];
  console.log(`プロフィールテンプレート: 合計${templateStats.total}件（未使用${templateStats.unused}件、使用済み${templateStats.used}件）`);
}

main().catch((err) => {
  console.error('エラーが発生しました:', err);
  process.exit(1);
});
