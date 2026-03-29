
import { initDb, run, query } from '../src/drivers/db.js';

/**
 * Bulk Threads Keyword Search Task Registration Script
 * Target: Preset 28, Queue: queue10
 * Batch 2: Health & Diet (Scheduled for 2026-03-12)
 */

async function main() {
    initDb();

    // --- Configuration ---
    const presetId = 28; // Threads検索・投稿取得
    const containerId = 'loureiroalbuquerqueqd556';
    const queueName = 'queue10';

    // 2026-03-12 00:00:00 JST (approximate)
    // 2026-03-12T00:00:00+09:00 = 2026-03-11T15:00:00Z
    const scheduledAt = new Date('2026-03-12T00:00:00+09:00').getTime();

    const rawKeywords = [
        "ダイエット", "筋トレ", "トレーニング", "減量", "体重", "ダイエット飯", "ダイエット記録",
        "カロリー", "塩抜き", "腸活", "食事記録", "食事療法", "食事管理", "食事制限", "体脂肪",
        "体脂肪率", "ダイエットサプリ", "半身浴", "アンチエイジング", "プロテイン", "ジム",
        "リベルサス", "マンジャロ", "オゼンピック", "メトホルミン", "フォシーガ", "医療ダイエット",
        "摂食障害", "産産後ダイエット", "チートデイ", "低糖質", "有酸素運動", "有酸素"
    ];

    // Deduplicate
    const keywords = [...new Set(rawKeywords)];

    // parameters as requested by user
    const overrides = {
        repeat_count: 100,
        max_posts: 500,
        batch_size: 5
    };

    const dryRun = process.argv.includes('--dry-run');

    console.log(`Target: Preset ${presetId}, Container: ${containerId}, Queue: ${queueName}`);
    console.log(`Scheduled for: ${new Date(scheduledAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);
    console.log(`Keywords count: ${keywords.length}`);
    if (dryRun) console.log('--- DRY RUN MODE ---');

    for (const keyword of keywords) {
        const runId = `run-${presetId}-${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.floor(Math.random() * 1000000)}`;
        const taskOverrides = { ...overrides, keyword };

        if (dryRun) {
            console.log(`[DRY RUN] Keyword: ${keyword}, runId: ${runId}, scheduledAt: ${scheduledAt}`);
        } else {
            try {
                run(
                    "INSERT INTO tasks (runId, preset_id, container_id, overrides_json, status, queue_name, scheduled_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    [
                        runId,
                        presetId,
                        containerId,
                        JSON.stringify(taskOverrides),
                        'pending',
                        queueName,
                        scheduledAt,
                        Date.now(),
                        Date.now()
                    ]
                );
            } catch (e: any) {
                console.error(`Failed to register task for ${keyword}: ${e.message}`);
            }
        }
    }

    if (!dryRun) {
        console.log(`Successfully registered ${keywords.length} tasks to ${queueName} for 2026-03-12.`);
    } else {
        console.log(`Dry run finished. ${keywords.length} tasks would have been registered.`);
    }
}

main().catch(console.error);
