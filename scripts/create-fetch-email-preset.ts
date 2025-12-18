/**
 * メール取得のみのプリセットを作成するスクリプト
 * 
 * 使用方法:
 *   npx tsx scripts/create-fetch-email-preset.ts
 * 
 * このプリセットはメール取得機能（fetch_email）のテスト用です
 */

import 'dotenv/config';
import { initDb } from '../src/drivers/db';
import { createPreset } from '../src/services/presets';

async function main() {
  // DBを初期化
  initDb({ wal: true });
  
  const presetName = 'メール取得テスト';
  const presetDescription = 'FirstMailから確認コードを取得するテスト用プリセットです。テンプレート変数 {{email}}（メールアドレス、必須）、{{email_password}}（メールパスワード、必須）を指定します。取得したコードは {{verification_code}} に格納されます。';

  // プリセットステップ定義（メール取得のみ）
  const steps = [
    {
      type: 'fetch_email',
      description: 'メールから確認コード（6桁の数字）を取得',
      email: '{{email}}',
      email_password: '{{email_password}}',
      subject_pattern: 'X.*verification|確認コード|verification code',
      code_pattern: '\\d{6}',
      timeout_seconds: 60,
      result_var: 'verification_code',
      postWaitSeconds: 1
    },
    {
      type: 'eval',
      description: '取得した確認コードを表示（テスト用）',
      code: `
        (async () => {
          try {
            // このステップはブラウザ上では実行されないため、ログ出力のみ
            // 実際の確認コードは gatheredVars.verification_code に格納されている
            return {
              didAction: true,
              reason: 'メール取得ステップが完了しました。確認コードは verification_code 変数に格納されています。',
              note: 'このevalステップは実際には実行されません（fetch_emailはサーバー側で処理されます）'
            };
          } catch (e) {
            return {
              didAction: false,
              reason: 'エラー: ' + String(e)
            };
          }
        })()
      `,
      postWaitSeconds: 1
    }
  ];

  try {
    const result = createPreset(presetName, presetDescription, JSON.stringify(steps));
    console.log(`✅ プリセットを作成しました:`);
    console.log(`   ID: ${result.id}`);
    console.log(`   名前: ${presetName}`);
    console.log(`   説明: ${presetDescription}`);
    console.log(`   ステップ数: ${steps.length}`);
    console.log(`\nテンプレート変数:`);
    console.log(`   - {{email}}: メールアドレス（FirstMail用、必須）`);
    console.log(`   - {{email_password}}: メールパスワード（FirstMail用、必須）`);
    console.log(`\n取得される変数:`);
    console.log(`   - {{verification_code}}: 取得した確認コード（自動設定）`);
    console.log(`\n注意事項:`);
    console.log(`   - fetch_email ステップタイプはサーバー側で実行されます`);
    console.log(`   - FirstMail APIの実装が必要です（現在はプレースホルダー）`);
    console.log(`   - タイムアウトは60秒に設定されています`);
    console.log(`\n実行例（API経由）:`);
    console.log(`   POST /api/presets/${result.id}/run-with-overrides`);
    console.log(`   {`);
    console.log(`     "containerId": "任意のコンテナID（fetch_emailでは使用されません）",`);
    console.log(`     "overrides": {`);
    console.log(`       "email": "test@example.com",`);
    console.log(`       "email_password": "your-email-password"`);
    console.log(`     }`);
    console.log(`   }`);
    console.log(`\n実行後の確認:`);
    console.log(`   - タスク実行ログで verification_code が取得できたか確認`);
    console.log(`   - エラーメッセージがないか確認`);
  } catch (e: any) {
    console.error('❌ プリセット作成に失敗しました:', e);
    process.exit(1);
  }
}

main().catch(e => {
  console.error('エラー:', e);
  process.exit(1);
});

