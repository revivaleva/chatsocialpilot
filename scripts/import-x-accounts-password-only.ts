/**
 * Xアカウントのログイン情報リストからx_accountsテーブルにデータを追加するスクリプト（パスワードのみ版）
 * 
 * データ形式: XID:パスワード:2FAコード:メールアドレス: Access Email at ...
 * 
 * 使用方法:
 *   npx tsx scripts/import-x-accounts-password-only.ts <データファイルパス>
 * 
 * 例:
 *   npx tsx scripts/import-x-accounts-password-only.ts accounts.txt
 */

import { initDb, run, query } from '../src/drivers/db';
import fs from 'node:fs';
import path from 'node:path';

interface XAccountData {
  xId: string;          // parts[0] - コンテナIDとして使用
  xPassword: string;   // parts[1]
  twofaCode: string;   // parts[2]
  email: string;       // parts[3]
}

function parseAccountLine(line: string): XAccountData | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return null; // 空行またはコメント行をスキップ
  }

  const parts = trimmed.split(':');
  // 最低4つのフィールドが必要（XID:パスワード:2FAコード:メールアドレス）
  // 5つ目以降は無視（" Access Email at https://..."など）
  if (parts.length < 4) {
    console.warn(`⚠ 行の形式が不正です（最低4つのフィールドが必要）: ${trimmed.substring(0, 50)}...`);
    return null;
  }

  return {
    xId: parts[0],
    xPassword: parts[1],
    twofaCode: parts[2] || '',
    email: parts[3] || '',
  };
}

function checkExistingAccount(containerId: string): boolean {
  const existing = query<{ id: number }>(
    'SELECT id FROM x_accounts WHERE container_id = ?',
    [containerId]
  );
  return existing && existing.length > 0;
}

function insertXAccount(data: XAccountData): { success: boolean; message: string } {
  const now = Date.now();

  // 既存チェック
  if (checkExistingAccount(data.xId)) {
    return {
      success: false,
      message: `既に存在します: ${data.xId}`,
    };
  }

  try {
    run(
      `INSERT INTO x_accounts (
        container_id, x_password, twofa_code, email,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        data.xId,
        data.xPassword,
        data.twofaCode || null,
        data.email || null,
        now,
        now,
      ]
    );

    return {
      success: true,
      message: `追加成功: ${data.xId}`,
    };
  } catch (e: any) {
    return {
      success: false,
      message: `エラー: ${data.xId} - ${e?.message || String(e)}`,
    };
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('❌ データファイルパスを指定してください');
    console.error('');
    console.error('使用方法:');
    console.error('  npx tsx scripts/import-x-accounts-password-only.ts <データファイルパス>');
    console.error('');
    console.error('データ形式（1行1アカウント、コロン区切り）:');
    console.error('  XID:パスワード:2FAコード:メールアドレス: Access Email at ...');
    console.error('');
    console.error('例:');
    console.error('  lisaf4vw8tm:o31q9dAgU:2BYX2OTIS35RHSCY:AftonPerkins570@outlook.com: Access Email at ...');
    process.exit(1);
  }

  const filePath = path.resolve(args[0]);
  if (!fs.existsSync(filePath)) {
    console.error(`❌ ファイルが見つかりません: ${filePath}`);
    process.exit(1);
  }

  // データベース初期化
  initDb({ wal: true });

  // ファイル読み込み
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  console.log(`📄 ファイル読み込み完了: ${lines.length}行`);
  console.log('');

  // 統計情報
  let total = 0;
  let success = 0;
  let skipped = 0;
  let errors = 0;

  // 各行を処理
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const data = parseAccountLine(line);

    if (!data) {
      continue; // 空行またはコメント行をスキップ
    }

    total++;
    const result = insertXAccount(data);

    if (result.success) {
      success++;
      console.log(`✓ [${i + 1}] ${result.message}`);
    } else {
      if (result.message.includes('既に存在します')) {
        skipped++;
        console.log(`⊘ [${i + 1}] ${result.message}`);
      } else {
        errors++;
        console.error(`✗ [${i + 1}] ${result.message}`);
      }
    }
  }

  // 結果サマリ
  console.log('');
  console.log('='.repeat(50));
  console.log('📊 処理結果サマリ');
  console.log('='.repeat(50));
  console.log(`総行数: ${lines.length}`);
  console.log(`処理対象: ${total}件`);
  console.log(`✓ 追加成功: ${success}件`);
  console.log(`⊘ スキップ（既存）: ${skipped}件`);
  console.log(`✗ エラー: ${errors}件`);
  console.log('='.repeat(50));

  if (errors > 0) {
    process.exit(1);
  }
}

main();

