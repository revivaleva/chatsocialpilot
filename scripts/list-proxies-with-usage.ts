/**
 * Xアカウントテーブルにあるコンテナに設定されているプロキシの使用数を確認するスクリプト
 */

import { initDb, query } from '../src/drivers/db';

interface ProxyUsage {
  proxy_id: number;
  proxy_info: string;
  container_count: number;
  container_ids: string[];
}

// プロキシ使用状況を取得
function getProxyUsage(): ProxyUsage[] {
  const results = query<{
    proxy_id: number | null;
    proxy_info: string | null;
    container_id: string;
  }>(`
    SELECT 
      xa.proxy_id,
      p.proxy_info,
      xa.container_id
    FROM x_accounts xa
    LEFT JOIN proxies p ON xa.proxy_id = p.id
    WHERE xa.container_id IS NOT NULL
    ORDER BY xa.proxy_id, xa.container_id
  `);

  // プロキシごとに集計
  const proxyMap = new Map<number | null, { proxy_info: string | null; container_ids: string[] }>();

  for (const row of results) {
    const proxyId = row.proxy_id;
    if (!proxyMap.has(proxyId)) {
      proxyMap.set(proxyId, {
        proxy_info: row.proxy_info || null,
        container_ids: []
      });
    }
    const entry = proxyMap.get(proxyId)!;
    if (row.container_id) {
      entry.container_ids.push(row.container_id);
    }
  }

  // ProxyUsage形式に変換
  const usageList: ProxyUsage[] = [];
  for (const [proxyId, data] of proxyMap.entries()) {
    usageList.push({
      proxy_id: proxyId || 0,
      proxy_info: data.proxy_info || '(プロキシなし)',
      container_count: data.container_ids.length,
      container_ids: data.container_ids
    });
  }

  // 使用数でソート（降順）
  usageList.sort((a, b) => b.container_count - a.container_count);

  return usageList;
}

// メイン処理
async function main() {
  console.log('📊 Xアカウントテーブルのコンテナに設定されているプロキシ一覧を取得します...\n');

  // DB初期化
  initDb();

  // プロキシ使用状況を取得
  const usageList = getProxyUsage();

  // 統計情報
  const totalContainers = usageList.reduce((sum, item) => sum + item.container_count, 0);
  const proxiesWithUsage = usageList.filter(item => item.container_count > 0).length;
  const proxiesWithoutUsage = usageList.filter(item => item.container_count === 0).length;

  console.log('📈 統計情報:');
  console.log(`  - 総コンテナ数: ${totalContainers}件`);
  console.log(`  - プロキシ使用中: ${proxiesWithUsage}件`);
  console.log(`  - プロキシ未使用: ${proxiesWithoutUsage}件`);
  console.log(`  - プロキシなし: ${usageList.filter(item => item.proxy_id === 0).length}件\n`);

  // プロキシ一覧を表示
  console.log('📋 プロキシ一覧（使用数順）:\n');

  if (usageList.length === 0) {
    console.log('  (プロキシ情報がありません)');
    return;
  }

  // 使用数が多い順に表示
  for (let i = 0; i < usageList.length; i++) {
    const item = usageList[i];
    console.log(`[${i + 1}] プロキシID: ${item.proxy_id === 0 ? '(なし)' : item.proxy_id}`);
    console.log(`    プロキシ情報: ${item.proxy_info}`);
    console.log(`    使用コンテナ数: ${item.container_count}件`);

    // コンテナID一覧を表示（最大10件まで）
    if (item.container_ids.length > 0) {
      const displayIds = item.container_ids.slice(0, 10);
      console.log(`    コンテナID: ${displayIds.join(', ')}`);
      if (item.container_ids.length > 10) {
        console.log(`    ... 他 ${item.container_ids.length - 10}件`);
      }
    }
    console.log('');
  }

  // JSON形式でも出力（オプション）
  const outputJson = process.argv.includes('--json');
  if (outputJson) {
    console.log('\n📄 JSON形式出力:');
    console.log(JSON.stringify(usageList, null, 2));
  }

  // CSV形式でも出力（オプション）
  const outputCsv = process.argv.includes('--csv');
  if (outputCsv) {
    console.log('\n📄 CSV形式出力:');
    console.log('プロキシID,プロキシ情報,使用コンテナ数,コンテナID一覧');
    for (const item of usageList) {
      const containerIdsStr = item.container_ids.join(';');
      console.log(`${item.proxy_id === 0 ? '' : item.proxy_id},"${item.proxy_info}",${item.container_count},"${containerIdsStr}"`);
    }
  }
}

// 実行
main().catch(e => {
  console.error('❌ エラー:', e);
  process.exit(1);
});














