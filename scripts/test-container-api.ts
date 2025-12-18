/**
 * コンテナブラウザのAPIをテストするスクリプト
 */

async function testContainerAPI() {
  const containerName = 'mechgrove35751';
  const containerUuid = 'd9aea987-735c-4538-b18b-3faf44a00d37';
  
  console.log('🔍 コンテナブラウザのAPIをテスト\n');
  console.log(`コンテナ名: ${containerName}`);
  console.log(`コンテナUUID: ${containerUuid}\n`);

  // 名前で検索
  console.log('='.repeat(80));
  console.log('📋 名前でコンテナを開く（openContainer）');
  console.log('='.repeat(80));
  
  try {
    const url = 'http://127.0.0.1:3001/internal/export-restored';
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: containerName,
        ensureAuth: false,
        timeoutMs: 60000,
      }),
    });

    const text = await response.text();
    console.log(`ステータス: ${response.status}`);
    console.log(`レスポンス: ${text.substring(0, 500)}`);
    
    if (response.ok) {
      const json = JSON.parse(text);
      console.log(`✓ 成功: ${JSON.stringify(json, null, 2)}`);
    } else {
      console.log(`✗ 失敗: HTTP ${response.status}`);
    }
  } catch (e: any) {
    console.error(`✗ エラー: ${e.message}`);
  }

  console.log('\n');

  // UUIDで検索
  console.log('='.repeat(80));
  console.log('📋 UUIDでコンテナを開く（openContainer）');
  console.log('='.repeat(80));
  
  try {
    const url = 'http://127.0.0.1:3001/internal/export-restored';
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: containerUuid,
        ensureAuth: false,
        timeoutMs: 60000,
      }),
    });

    const text = await response.text();
    console.log(`ステータス: ${response.status}`);
    console.log(`レスポンス: ${text.substring(0, 500)}`);
    
    if (response.ok) {
      const json = JSON.parse(text);
      console.log(`✓ 成功: ${JSON.stringify(json, null, 2)}`);
    } else {
      console.log(`✗ 失敗: HTTP ${response.status}`);
    }
  } catch (e: any) {
    console.error(`✗ エラー: ${e.message}`);
  }
}

testContainerAPI().catch(console.error);

