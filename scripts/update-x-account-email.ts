/**
 * Xアカウントのメールアドレスとパスワードを更新するスクリプト
 * 
 * データ形式: email:password container_id
 * 
 * 使用方法:
 *   npx tsx scripts/update-x-account-email.ts
 * 
 * または、データを引数で指定:
 *   npx tsx scripts/update-x-account-email.ts "<データ行1>" "<データ行2>" ...
 */

import { initDb, run, query } from '../src/drivers/db';

interface EmailData {
  email: string;
  password: string;
  containerId: string;
}

function parseEmailLine(line: string): EmailData | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }

  // スペースまたはタブで分割
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) {
    console.warn(`⚠ 行の形式が不正です（email:password と container_id が必要）: ${trimmed.substring(0, 50)}...`);
    return null;
  }

  const emailPassword = parts[0];
  const containerId = parts[1];

  // email:password を分割
  const emailParts = emailPassword.split(':');
  if (emailParts.length < 2) {
    console.warn(`⚠ メールアドレスとパスワードの形式が不正です（email:password が必要）: ${emailPassword}`);
    return null;
  }

  return {
    email: emailParts[0],
    password: emailParts.slice(1).join(':'), // パスワードにコロンが含まれる場合に対応
    containerId: containerId,
  };
}

function checkXAccountExists(containerId: string): boolean {
  const existing = query<{ id: number }>(
    'SELECT id FROM x_accounts WHERE container_id = ?',
    [containerId]
  );
  return existing && existing.length > 0;
}

function updateXAccountEmail(data: EmailData): { success: boolean; message: string } {
  // アカウントの存在確認
  if (!checkXAccountExists(data.containerId)) {
    return {
      success: false,
      message: `❌ x_accountsテーブルに存在しません: ${data.containerId}`,
    };
  }

  try {
    const now = Date.now();
    run(
      `UPDATE x_accounts 
       SET email = ?, email_password = ?, updated_at = ? 
       WHERE container_id = ?`,
      [
        data.email,
        data.password,
        now,
        data.containerId,
      ]
    );

    return {
      success: true,
      message: `✓ 更新成功: ${data.containerId} (email: ${data.email})`,
    };
  } catch (e: any) {
    return {
      success: false,
      message: `❌ エラー: ${data.containerId} - ${e?.message || String(e)}`,
    };
  }
}

function main() {
  // データベース初期化
  initDb({ wal: true });

  // データを定義（引数がある場合は引数から、ない場合はここに定義されたデータを使用）
  const args = process.argv.slice(2);
  let dataLines: string[];

  if (args.length > 0) {
    // 引数からデータを取得
    dataLines = args;
  } else {
    // ここにデータを定義
    dataLines = [
      'sarahwilliams1957@sabesmail.com:nqzxwdwqS5495 fusionwork83663',
      'amyyoung1909@quieresmail.com:ynhxxksfS1442 fusionwork84474',
    ];
  }

  console.log(`📋 ${dataLines.length}件のデータを処理します\n`);

  // 統計情報
  let total = 0;
  let success = 0;
  let errors = 0;
  const errorMessages: string[] = [];

  // 各行を処理
  for (let i = 0; i < dataLines.length; i++) {
    const line = dataLines[i];
    const data = parseEmailLine(line);

    if (!data) {
      continue;
    }

    total++;
    console.log(`[${i + 1}/${dataLines.length}] 処理中: ${data.containerId}...`);
    console.log(`  メール: ${data.email}`);
    
    const result = updateXAccountEmail(data);

    if (result.success) {
      success++;
      console.log(`  ${result.message}\n`);
    } else {
      errors++;
      errorMessages.push(result.message);
      console.error(`  ${result.message}\n`);
    }
  }

  // 結果サマリ
  console.log('='.repeat(60));
  console.log('📊 処理結果サマリ');
  console.log('='.repeat(60));
  console.log(`総データ数: ${dataLines.length}`);
  console.log(`処理対象: ${total}件`);
  console.log(`✓ 更新成功: ${success}件`);
  console.log(`✗ エラー: ${errors}件`);
  console.log('='.repeat(60));

  if (errorMessages.length > 0) {
    console.log('\n❌ エラー詳細:');
    errorMessages.forEach((msg, idx) => {
      console.log(`  ${idx + 1}. ${msg}`);
    });
  }

  if (errors > 0) {
    process.exit(1);
  }
}

main();

