/**
 * プロキシを一括追加するスクリプト
 * 重複チェックを行い、既に存在するプロキシはスキップします
 */

import { initDb, query, run } from '../src/drivers/db';

// プロキシリスト（ユーザーが提供したリスト）
const PROXY_LIST = [
  '173.239.233.215:61235:95556_ybuOg:WEP1Yrkfcx',
  '173.239.233.199:61235:95556_ybuOg:WEP1Yrkfcx',
  '157.254.14.2:61235:95556_ybuOg:WEP1Yrkfcx',
  '157.254.14.156:61235:95556_ybuOg:WEP1Yrkfcx',
  '157.254.14.154:61235:95556_ybuOg:WEP1Yrkfcx',
  '157.254.14.236:61235:95556_ybuOg:WEP1Yrkfcx',
  '173.239.233.174:61235:95556_ybuOg:WEP1Yrkfcx',
  '173.239.233.204:61235:95556_ybuOg:WEP1Yrkfcx',
  '173.239.233.185:61235:95556_ybuOg:WEP1Yrkfcx',
  '173.239.233.134:61235:95556_ybuOg:WEP1Yrkfcx',
  '173.239.233.58:61235:95556_ybuOg:WEP1Yrkfcx',
  '157.254.14.41:61235:95556_ybuOg:WEP1Yrkfcx',
  '173.239.233.120:61235:95556_ybuOg:WEP1Yrkfcx',
  '173.239.233.53:61235:95556_ybuOg:WEP1Yrkfcx',
  '157.254.14.26:61235:95556_ybuOg:WEP1Yrkfcx',
  '157.254.14.43:61235:95556_ybuOg:WEP1Yrkfcx',
  '173.239.233.79:61235:95556_ybuOg:WEP1Yrkfcx',
  '173.239.233.183:61235:95556_ybuOg:WEP1Yrkfcx',
  '157.254.14.52:61235:95556_ybuOg:WEP1Yrkfcx',
  '157.254.14.239:61235:95556_ybuOg:WEP1Yrkfcx',
  '173.239.233.60:61235:95556_ybuOg:WEP1Yrkfcx',
  '157.254.14.174:61235:95556_ybuOg:WEP1Yrkfcx',
  '173.239.233.254:61235:95556_ybuOg:WEP1Yrkfcx',
  '173.239.233.20:61235:95556_ybuOg:WEP1Yrkfcx',
  '157.254.14.117:61235:95556_ybuOg:WEP1Yrkfcx',
  '173.239.233.206:61235:95556_ybuOg:WEP1Yrkfcx',
  '173.239.233.4:61235:95556_ybuOg:WEP1Yrkfcx',
  '157.254.14.85:61235:95556_ybuOg:WEP1Yrkfcx',
  '157.254.14.13:61235:95556_ybuOg:WEP1Yrkfcx',
  '173.239.233.226:61235:95556_ybuOg:WEP1Yrkfcx',
  '157.254.14.216:61235:95556_ybuOg:WEP1Yrkfcx',
  '157.254.14.12:61235:95556_ybuOg:WEP1Yrkfcx',
  '157.254.14.88:61235:95556_ybuOg:WEP1Yrkfcx',
  '157.254.14.235:61235:95556_ybuOg:WEP1Yrkfcx',
  '173.239.233.213:61235:95556_ybuOg:WEP1Yrkfcx',
  '173.239.233.71:61235:95556_ybuOg:WEP1Yrkfcx',
  '157.254.14.229:61235:95556_ybuOg:WEP1Yrkfcx',
  '157.254.14.11:61235:95556_ybuOg:WEP1Yrkfcx',
  '157.254.14.17:61235:95556_ybuOg:WEP1Yrkfcx',
  '157.254.14.164:61235:95556_ybuOg:WEP1Yrkfcx',
  '173.239.233.248:61235:95556_ybuOg:WEP1Yrkfcx',
  '173.239.233.87:61235:95556_ybuOg:WEP1Yrkfcx',
  '157.254.14.37:61235:95556_ybuOg:WEP1Yrkfcx',
  '173.239.233.201:61235:95556_ybuOg:WEP1Yrkfcx',
  '157.254.14.237:61235:95556_ybuOg:WEP1Yrkfcx',
  '173.239.233.66:61235:95556_ybuOg:WEP1Yrkfcx',
  '173.239.233.212:61235:95556_ybuOg:WEP1Yrkfcx',
  '157.254.14.89:61235:95556_ybuOg:WEP1Yrkfcx',
  '157.254.14.108:61235:95556_ybuOg:WEP1Yrkfcx',
  '173.239.233.251:61235:95556_ybuOg:WEP1Yrkfcx',
];

// プロキシを正規化（前後の空白を削除）
function normalizeProxy(proxy: string): string {
  return proxy.trim();
}

// 既存のプロキシを取得
function getExistingProxies(): Set<string> {
  const rows = query<{ proxy_info: string }>('SELECT proxy_info FROM proxies');
  return new Set(rows.map(row => row.proxy_info));
}

// プロキシを追加（重複チェック付き）
function addProxy(proxyInfo: string): { success: boolean; message: string } {
  const normalized = normalizeProxy(proxyInfo);
  
  if (!normalized) {
    return { success: false, message: 'プロキシ情報が空です' };
  }
  
  // 既存チェック
  const existing = query<{ id: number }>(
    'SELECT id FROM proxies WHERE proxy_info = ? LIMIT 1',
    [normalized]
  );
  
  if (existing && existing.length > 0) {
    return { success: false, message: '既に存在します' };
  }
  
  // 追加
  try {
    run(
      'INSERT INTO proxies (proxy_info, added_at) VALUES (?, ?)',
      [normalized, Date.now()]
    );
    return { success: true, message: '追加しました' };
  } catch (e: any) {
    // UNIQUE制約違反の場合も重複として扱う
    if (e.message && e.message.includes('UNIQUE constraint')) {
      return { success: false, message: '既に存在します（UNIQUE制約）' };
    }
    return { success: false, message: `エラー: ${e.message}` };
  }
}

// メイン処理
async function main() {
  console.log('📥 プロキシの一括追加を開始します...\n');
  
  // DB初期化
  initDb();
  
  // 既存のプロキシを取得
  const existingProxies = getExistingProxies();
  console.log(`📊 既存のプロキシ数: ${existingProxies.size}件\n`);
  
  // 追加対象のプロキシを正規化して重複を除去
  const normalizedList = PROXY_LIST.map(normalizeProxy).filter(p => p);
  const uniqueProxies = Array.from(new Set(normalizedList));
  
  console.log(`📋 追加対象: ${uniqueProxies.length}件（元のリスト: ${PROXY_LIST.length}件）\n`);
  
  // 各プロキシを追加
  let added = 0;
  let skipped = 0;
  let errors = 0;
  
  for (const proxy of uniqueProxies) {
    const result = addProxy(proxy);
    if (result.success) {
      added++;
      console.log(`✅ [${added}] ${proxy}`);
    } else if (result.message.includes('既に存在')) {
      skipped++;
      console.log(`⏭️  [スキップ] ${proxy} (${result.message})`);
    } else {
      errors++;
      console.log(`❌ [エラー] ${proxy} (${result.message})`);
    }
  }
  
  // 結果サマリー
  console.log('\n📊 処理結果:');
  console.log(`  ✅ 追加: ${added}件`);
  console.log(`  ⏭️  スキップ（既存）: ${skipped}件`);
  console.log(`  ❌ エラー: ${errors}件`);
  console.log(`  📋 合計: ${uniqueProxies.length}件\n`);
  
  // 最終的なプロキシ数を表示
  const finalCount = query<{ count: number }>('SELECT COUNT(*) as count FROM proxies')[0]?.count || 0;
  console.log(`📊 データベース内のプロキシ総数: ${finalCount}件\n`);
}

// 実行
main().catch(e => {
  console.error('❌ エラー:', e);
  process.exit(1);
});






