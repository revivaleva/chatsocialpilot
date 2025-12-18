import Database from 'better-sqlite3';
import path from 'path';
import crypto from 'crypto';

const DB_PATH = path.resolve('storage', 'app.db');

// 13件のコンテナID
const containerIds = [
  'a1abd38c-a3f7-4abc-b5da-6569b6463101',
  '0bdcaf09-0d40-4169-b579-b89378c6b84b',
  '1be3a38d-ab9b-4e9e-9b19-61bc56f49513',
  'aa272222-ceca-4b58-a70a-f0c651876c39',
  '2e378dc3-54a8-4ac5-9867-20baeb3e26de',
  '5808ad84-0cc9-4e50-b82e-7b9aa7bf56af',
  '615b8ead-6c7b-4d3c-baef-58e976bf8d7d',
  'da4414cf-9f85-48b4-838e-428ae68faf0c',
  '6f3dff62-e57d-48c6-ad9c-b13a804f46c8',
  '3a248b42-03fb-4e57-aced-62bf3f9fc5ff',
  'fc97435f-4645-4803-8010-efc062178e6e',
  '13d85847-8cdd-4ab0-949f-38f03c49921b',
  '987cbce2-edbb-4460-8843-b0cc62dc119a'
];

try {
  const db = new Database(DB_PATH, { readonly: false });
  
  // フォロワー数取得・保存のプリセットIDを取得
  const presetRow = db.prepare('SELECT id FROM presets WHERE name = ?').get('フォロワー数取得・保存') as { id: number } | undefined;
  
  if (!presetRow) {
    console.error(JSON.stringify({ ok: false, error: 'プリセット「フォロワー数取得・保存」が見つかりませんでした' }, null, 2));
    process.exit(1);
  }
  
  const presetId = presetRow.id;
  console.log(`プリセットID: ${presetId}`);
  
  const now = Date.now();
  const queueName = 'task1';
  let createdCount = 0;
  let skippedCount = 0;
  
  // トランザクション開始
  db.transaction(() => {
    for (const containerId of containerIds) {
      // runIdを生成（一意性を保証）
      const runId = `follower-${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${containerId.slice(0, 8)}`;
      
      // 既に同じrunIdが存在するかチェック（念のため）
      const existing = db.prepare('SELECT id FROM tasks WHERE runId = ?').get(runId) as { id: number } | undefined;
      if (existing) {
        console.log(`スキップ: ${containerId} (既に存在)`);
        skippedCount++;
        continue;
      }
      
      // タスクを作成
      try {
        db.prepare(`
          INSERT INTO tasks(
            runId,
            preset_id,
            container_id,
            overrides_json,
            scheduled_at,
            status,
            created_at,
            updated_at,
            queue_name
          ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          runId,
          presetId,
          containerId,
          null,
          now,
          'pending',
          now,
          now,
          queueName
        );
        
        createdCount++;
        console.log(`作成: ${containerId} -> runId: ${runId}`);
      } catch (e: any) {
        console.error(`エラー (${containerId}): ${String(e?.message || e)}`);
      }
    }
  })();
  
  console.log(`\n結果:`);
  console.log(`  作成: ${createdCount}件`);
  console.log(`  スキップ: ${skippedCount}件`);
  console.log(`  キュー: ${queueName}`);
  
  console.log(JSON.stringify({
    ok: true,
    presetId,
    queueName,
    created: createdCount,
    skipped: skippedCount,
    total: containerIds.length
  }, null, 2));
  
  db.close();
} catch (e: any) {
  console.error(JSON.stringify({ ok: false, error: String(e?.message || e) }, null, 2));
  process.exit(1);
}

