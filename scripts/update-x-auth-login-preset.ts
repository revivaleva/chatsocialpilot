/**
 * X Authログインプリセット（ID: 16）を更新するスクリプト
 * 
 * 使用方法:
 *   npx tsx scripts/update-x-auth-login-preset.ts
 */

import 'dotenv/config';
import { initDb } from '../src/drivers/db';
import { getPreset, updatePreset } from '../src/services/presets';

async function main() {
  // DBを初期化
  initDb({ wal: true });
  
  const presetId = 16;
  const preset = getPreset(presetId);
  
  if (!preset) {
    console.error(`❌ プリセット ID ${presetId} が見つかりません`);
    process.exit(1);
  }
  
  console.log(`現在のプリセット情報:`);
  console.log(`  ID: ${preset.id}`);
  console.log(`  名前: ${preset.name}`);
  console.log(`  説明: ${preset.description}`);
  
  // 更新後の説明
  const updatedDescription = 'X（旧Twitter）にAuthトークンでログインします。テンプレート変数 {{container_name}}（コンテナ名、必須）、{{auth_token}}（認証トークン、必須）、{{ct0}}（CSRFトークン、必須）を指定してコンテナを作成/開き、Cookieを設定してログイン状態を確認します。';
  
  // ステップは既存のものをそのまま使用（コンテナ作成はtaskQueue.tsで自動処理されるため）
  const steps = JSON.parse(preset.steps_json || '[]');
  
  try {
    updatePreset(presetId, preset.name, updatedDescription, preset.steps_json);
    console.log(`\n✅ プリセットを更新しました:`);
    console.log(`   ID: ${presetId}`);
    console.log(`   名前: ${preset.name}`);
    console.log(`   説明: ${updatedDescription}`);
    console.log(`   ステップ数: ${steps.length}`);
    console.log(`\nテンプレート変数:`);
    console.log(`   - {{container_name}}: コンテナ名（必須、新規作成される）`);
    console.log(`   - {{auth_token}}: Xの認証トークン（必須）`);
    console.log(`   - {{ct0}}: CSRFトークン（必須）`);
  } catch (e: any) {
    console.error('❌ プリセット更新に失敗しました:', e);
    process.exit(1);
  }
}

main().catch(e => {
  console.error('エラー:', e);
  process.exit(1);
});

