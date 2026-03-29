
import { initDb, run } from '../src/drivers/db.js';

/**
 * Bulk Threads Keyword Search Task Registration Script
 * Target: Preset 28 (Threads検索・投稿取得), Container: loureiroalbuquerqueqd556, Queue: queue10
 * Date: 2026-03-26
 */

async function main() {
    initDb();

    // --- Configuration ---
    const presetId = 28; // Threads検索・投稿取得
    const containerId = 'loureiroalbuquerqueqd556';
    const queueName = 'queue10';

    const rawKeywords = [
        "インサイト祭り", "Threads美容部", "美容垢さんと繋がりたい", "全域ハリ肌", "夢中美容",
        "先どりパーツケア", "美容の裏側", "正直レビュー", "タンブリンズ", "TAMBURINS",
        "SNIDEL BEAUTY", "ケイト 毛穴磨き", "マキアージュ エッセンスリキッド", "コスメデコルテ 薬用美白",
        "イドラクラリティ", "RMK スキンティント", "YSL クッションパウダー", "PERFECT DIARY サクラバタフライ",
        "タンフルリップ", "超キラメロコスメ", "ミュートメイク", "調和メイク", "中顔面短縮",
        "多幸感メイク", "ロンジェビティ", "エクソソーム", "PDRN", "フェーズフリーコスメ",
        "リカバリーコスメ", "ドラパト", "追い買い", "ストック買い", "1軍コスメ",
        "底見えコスメ", "使い切りコスメ", "ポーチの中身", "カバンの中身", "持ち歩きコスメ",
        "コンビニコスメ", "Qoo10メガ割", "韓国コスメ新作", "Laka リップライナー",
        "rom&nd ヌーディカラー", "fwee", "hince", "アンチエイジング"
    ];

    // Deduplicate
    const keywords = [...new Set(rawKeywords)];

    // parameters as used before
    const overrides = {
        repeat_count: 300,
        max_posts: 1000,
        batch_size: 10
    };

    const dryRun = process.argv.includes('--dry-run');

    console.log(`Target: Preset ${presetId}, Container: ${containerId}, Queue: ${queueName}`);
    console.log(`Keywords count: ${keywords.length} (deduplicated from ${rawKeywords.length})`);
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
        console.log(`Successfully registered ${successCount} tasks to ${queueName}.`);
    } else {
        console.log(`Dry run finished. ${successCount} tasks would have been registered.`);
    }
}

main().catch(console.error);
