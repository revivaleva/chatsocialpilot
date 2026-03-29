
import { initDb, run, query } from '../src/drivers/db.js';

/**
 * Bulk Threads Keyword Search Task Registration Script
 * Target: Preset 28, Queue: queue10
 */

async function main() {
    initDb();

    // --- Configuration ---
    const presetId = 28; // Threads検索・投稿取得
    const containerId = 'loureiroalbuquerqueqd556';
    const queueName = 'queue10';

    const rawKeywords = [
        "紗栄子", "小田切ヒロ", "田中みな実", "鹿の間", "本田真凛", "なごみちゃん", "エガちゃん", "こじはる", "さっしー",
        "RMK", "LUNASOL", "ロムアンド", "Anua", "コスメデコルテ", "クレドポー ボーテ", "NARS", "Dior",
        "ラ ロッシュ ポゼ", "SHISEIDO", "資生堂", "THREE", "SHIGETA", "SUQQU", "オルビス", "rom&nd",
        "キュレル", "e.l.f. SKIN", "エスティローダー", "It Cosmetics", "ETUDE", "CANMAKE", "キャンメイク",
        "YSL", "シャネル", "ETUDE", "無印良品", "ディオール", "コスメ", "美容", "リップ", "アイメイク",
        "スキンケア", "ファンデ", "パウダー", "メイクブラシ", "コンシーラー", "化粧水", "美容液", "乳液",
        "フェイスパック", "泡パック", "クレンジング", "洗顔", "ヘアパック", "トリートメント", "ヘアケア",
        "アイブロウ", "チーク", "ハンドクリーム", "リップクリーム", "マスカラ", "ヘアオイル", "香水",
        "脂性肌", "乾燥肌", "インナードライ", "混合肌", "イエベ", "ブルベ", "ミニリップ", "下地",
        "シェーディング", "フェイスライン", "粘膜リップ", "ロムアンド", "ティント", "アイライン", "美肌",
        "透明感", "垢抜け", "クッションファンデ", "リキッドファンデ", "パウダーファンデ", "色味",
        "肌なじみ", "肌馴染み", "アイパレ", "アイシャドウパレット"
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
    console.log(`Keywords count: ${keywords.length} (deduplicated from ${rawKeywords.length})`);
    if (dryRun) console.log('--- DRY RUN MODE ---');

    for (const keyword of keywords) {
        const runId = `run-${presetId}-${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.floor(Math.random() * 1000000)}`;
        const taskOverrides = { ...overrides, keyword };

        if (dryRun) {
            console.log(`[DRY RUN] Keyword: ${keyword}, runId: ${runId}`);
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
            } catch (e: any) {
                console.error(`Failed to register task for ${keyword}: ${e.message}`);
            }
        }
    }

    if (!dryRun) {
        console.log(`Successfully registered ${keywords.length} tasks to ${queueName}.`);
    } else {
        console.log(`Dry run finished. ${keywords.length} tasks would have been registered.`);
    }
}

main().catch(console.error);
