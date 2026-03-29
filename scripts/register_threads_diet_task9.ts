
import { initDb, run } from '../src/drivers/db.js';

/**
 * Threads Diet Keyword Search Task Registration (Task 9 -> queue9)
 * Target: Preset 28, Container: loureiroalbuquerqueqd556, Queue: queue9
 * Date: 2026-03-27
 */

async function main() {
    initDb();

    // --- Configuration ---
    const presetId = 28; // Threads検索・投稿取得
    const containerId = 'loureiroalbuquerqueqd556';
    const queueName = 'queue9'; // Different queue as requested (Task 9)

    const keywords = [
        "ダイエット", "筋トレ", "トレーニング", "減量", "体重", "ダイエット飯", "ダイエット記録",
        "カロリー", "塩抜き", "腸活", "食事記録", "食事療法", "食事管理", "食事制限", "体脂肪",
        "体脂肪率", "ダイエットサプリ", "半身浴", "アンチエイジング", "プロテイン", "ジム",
        "リベルサス", "マンジャロ", "オゼンピック", "メトホルミン", "フォシーガ", "医療ダイエット",
        "摂食障害", "産後ダイエット", "チートデイ", "低糖質", "有酸素運動", "有酸素",
        "ダイエット垢さんと繋がりたい", "ゆるファスティング", "下っ腹痩せ", "脚やせ", "顔痩せ",
        "劇的ビフォーアフター", "マイナス10キロ", "神痩せ", "痩せ体質", "ながら筋トレ",
        "地中海ダイエット", "時間栄養学", "朝タンパク質", "糖の貯蔵庫", "MCTオイル",
        "MCTダイエット", "PFCバランス", "ケトジェニック", "腸活ダイエット", "酵素ドリンク",
        "GLP1ダイエット", "漢方ダイエット", "防風通聖散", "二の腕痩せ", "骨盤矯正",
        "姿勢改善", "浮き指", "セルライト除去", "リンパマッサージ", "チートデイの過ごし方"
    ];

    const overrides = {
        repeat_count: 300,
        max_posts: 1000,
        batch_size: 10
    };

    const dryRun = process.argv.includes('--dry-run');

    console.log(`Target: Preset ${presetId}, Container: ${containerId}, Queue: ${queueName}`);
    console.log(`Keywords count: ${keywords.length}`);
    console.log(`Parameters: ${JSON.stringify(overrides)}`);
    if (dryRun) console.log('--- DRY RUN MODE ---');

    let successCount = 0;
    for (const keyword of keywords) {
        const runId = `run-${presetId}-${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.floor(Math.random() * 1000000)}`;
        const taskOverrides = { ...overrides, keyword };

        if (dryRun) {
            console.log(`[DRY RUN] Keyword: ${keyword}, runId: ${runId}`);
            successCount++;
        } else {
            try {
                run(
                    "INSERT INTO tasks (runId, preset_id, container_id, overrides_json, status, queue_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    [
                        runId,
                        presetId,
                        containerId,
                        JSON.stringify(taskOverrides),
                        'pending',
                        queueName,
                        Date.now(),
                        Date.now()
                    ]
                );
                successCount++;
            } catch (e: any) {
                console.error(`Failed to register task for ${keyword}: ${e.message}`);
            }
        }
    }

    if (!dryRun) {
        console.log(`Successfully registered ${successCount} diet tasks to ${queueName}.`);
    } else {
        console.log(`Dry run finished. ${successCount} tasks would have been registered.`);
    }
}

main().catch(console.error);
