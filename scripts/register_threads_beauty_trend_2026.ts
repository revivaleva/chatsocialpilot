
import { initDb, run, query } from '../src/drivers/db.js';

/**
 * 2026 March Beauty Trend Keywords Registration Script
 * Target: Preset 28, Queue: queue10
 */

async function main() {
    initDb();

    // --- Configuration ---
    const presetId = 28; // Threads検索・投稿取得
    const containerId = 'loureiroalbuquerqueqd556';
    const queueName = 'queue10';

    const categories = {
        community: [
            "インサイト祭り", "Threads美容部", "美容垢さんと繋がりたい",
            "全域ハリ肌", "夢中美容", "ご自愛", "肌守り", "先どりパーツケア",
            "美容の裏側", "正直レビュー"
        ],
        trends2026: [
            "タンブリンズ", "TAMBURINS", "SNIDEL BEAUTY", "ケイト 毛穴磨き",
            "マキアージュ エッセンスリキッド", "コスメデコルテ 薬用美白",
            "イドラクラリティ", "RMK スキンティント", "YSL クッションパウダー",
            "PERFECT DIARY サクラバタフライ"
        ],
        concepts: [
            "タンフルリップ", "超キラメロコスメ", "ミュートメイク", "調和メイク",
            "中顔面短縮", "多幸感メイク", "ロンジェビティ", "エクソソーム",
            "PDRN", "フェーズフリーコスメ", "リカバリーコスメ"
        ],
        behavior: [
            "ドラパト", "追い買い", "ストック買い", "1軍コスメ", "底見えコスメ",
            "使い切りコスメ", "ポーチの中身", "カバンの中身", "持ち歩きコスメ",
            "コンビニコスメ"
        ],
        kbeauty: [
            "Qoo10メガ割", "韓国コスメ新作", "Laka リップライナー",
            "rom&nd ヌーディカラー", "fwee", "hince"
        ]
    };

    // Flatten and Deduplicate
    const rawKeywords = Object.values(categories).flat();
    const keywords = [...new Set(rawKeywords)];

    // Enhanced parameters for the test
    const overrides = {
        repeat_count: 300,
        max_posts: 1000,
        batch_size: 10
    };

    const dryRun = process.argv.includes('--dry-run');

    console.log(`Target: Preset ${presetId}, Container: ${containerId}, Queue: ${queueName}`);
    console.log(`Unique Keywords: ${keywords.length}`);
    console.log(`Settings: ${JSON.stringify(overrides)}`);
    if (dryRun) console.log('--- DRY RUN MODE ---');

    let count = 0;
    for (const keyword of keywords) {
        const runId = `run-${presetId}-${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.floor(Math.random() * 1000000)}`;
        const taskOverrides = { ...overrides, keyword };

        if (dryRun) {
            console.log(`[DRY RUN] Keyword: ${keyword}, runId: ${runId}`);
            count++;
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
                count++;
            } catch (e: any) {
                console.error(`Failed to register task for ${keyword}: ${e.message}`);
            }
        }
    }

    if (!dryRun) {
        console.log(`Successfully registered ${count} new trend beauty tasks to ${queueName}.`);
    } else {
        console.log(`Dry run finished. ${count} tasks would have been registered.`);
    }
}

main().catch(console.error);
