#!/usr/bin/env tsx
/**
 * CSVファイルからプロフィールテンプレートをインポートするスクリプト
 * 
 * 使用方法:
 *   npx tsx scripts/import-profile-templates.ts docs/beauty_accounts_1000.csv
 */

import 'dotenv/config';
import { initDb, run, query } from '../src/drivers/db';
import fs from 'node:fs';
import path from 'node:path';

interface ProfileTemplate {
  account_name: string;
  profile_text: string;
}

/**
 * CSVファイルを読み込んでパース
 */
function parseCSV(filePath: string): ProfileTemplate[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  
  if (lines.length === 0) {
    throw new Error('CSVファイルが空です');
  }

  // ヘッダー行をスキップ
  const header = lines[0];
  if (!header.includes('account_name') || !header.includes('profile')) {
    throw new Error('CSVファイルのヘッダーが不正です。account_name,profile が必要です');
  }

  const profiles: ProfileTemplate[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    // CSVパース（カンマ区切り、ただしプロフィール文内にカンマが含まれる可能性があるため注意）
    // 最初のカンマで分割（account_name,profile_text）
    const firstCommaIndex = line.indexOf(',');
    if (firstCommaIndex === -1) {
      console.warn(`⚠ [${i + 1}] 行のパースに失敗しました（カンマが見つかりません）: ${line.substring(0, 50)}...`);
      continue;
    }

    const account_name = line.substring(0, firstCommaIndex).trim();
    const profile_text = line.substring(firstCommaIndex + 1).trim();

    if (!account_name || !profile_text) {
      console.warn(`⚠ [${i + 1}] 行のパースに失敗しました（空の値）: ${line.substring(0, 50)}...`);
      continue;
    }

    profiles.push({ account_name, profile_text });
  }

  return profiles;
}

/**
 * 既存のプロフィールテンプレートをチェック
 */
function checkExisting(account_name: string, profile_text: string): boolean {
  const existing = query<{ id: number }>(
    'SELECT id FROM profile_templates WHERE account_name = ? AND profile_text = ?',
    [account_name, profile_text]
  );
  return existing.length > 0;
}

/**
 * プロフィールテンプレートを登録
 */
function insertProfileTemplate(data: ProfileTemplate): { success: boolean; message: string; skipped: boolean } {
  const now = Date.now();

  // 既存チェック
  if (checkExisting(data.account_name, data.profile_text)) {
    return {
      success: false,
      message: `既にprofile_templatesテーブルに存在します: ${data.account_name}`,
      skipped: true,
    };
  }

  try {
    run(
      `INSERT INTO profile_templates (account_name, profile_text, added_at, used_at)
       VALUES (?, ?, ?, NULL)`,
      [data.account_name, data.profile_text, now]
    );

    return {
      success: true,
      message: `✓ 追加成功: ${data.account_name}`,
      skipped: false,
    };
  } catch (e: any) {
    return {
      success: false,
      message: `❌ エラー: ${data.account_name} - ${e?.message || String(e)}`,
      skipped: false,
    };
  }
}

async function main() {
  // データベース初期化
  initDb({ wal: true });

  // ファイルパスを取得（引数から、またはデフォルト）
  const args = process.argv.slice(2);
  const filePath = args[0] || 'docs/beauty_accounts_1000.csv';

  if (!fs.existsSync(filePath)) {
    console.error(`❌ ファイルが見つかりません: ${filePath}`);
    process.exit(1);
  }

  console.log(`📄 ファイル読み込み中: ${filePath}\n`);

  // CSVファイルをパース
  let profiles: ProfileTemplate[];
  try {
    profiles = parseCSV(filePath);
    console.log(`✓ ${profiles.length}件のデータをパースしました\n`);
  } catch (e: any) {
    console.error(`❌ CSVパースエラー: ${e?.message || String(e)}`);
    process.exit(1);
  }

  // 統計情報
  let total = 0;
  let success = 0;
  let skipped = 0;
  let errors = 0;
  const errorDetails: string[] = [];

  // 各行を処理
  for (let i = 0; i < profiles.length; i++) {
    const profile = profiles[i];
    total++;
    
    process.stdout.write(`[${i + 1}/${profiles.length}] 処理中: ${profile.account_name}...\r`);
    const result = insertProfileTemplate(profile);

    if (result.success) {
      success++;
      console.log(`  ${result.message}`);
    } else {
      if (result.skipped) {
        skipped++;
        console.log(`  ⊘ ${result.message}`);
      } else {
        errors++;
        console.error(`  ${result.message}`);
        errorDetails.push(result.message);
      }
    }
  }

  // 結果サマリ
  console.log('\n' + '='.repeat(50));
  console.log('📊 処理結果サマリ');
  console.log('='.repeat(50));
  console.log(`総データ数: ${profiles.length}`);
  console.log(`処理対象: ${total}件`);
  console.log(`✓ 追加成功: ${success}件`);
  console.log(`⊘ スキップ（既存）: ${skipped}件`);
  console.log(`✗ エラー: ${errors}件`);
  console.log('='.repeat(50));

  if (errors > 0) {
    console.error('\n❌ エラー詳細:');
    errorDetails.forEach((detail, idx) => console.error(`  ${idx + 1}. ${detail}`));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('エラー:', e);
  process.exit(1);
});















