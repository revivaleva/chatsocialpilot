
import { initDb, run } from '../src/drivers/db.js';

/**
 * Threads Beauty Keyword Search Task Registration (Task 10 -> queue10)
 * Target: Preset 28, Container: loureiroalbuquerqueqd556, Queue: queue10
 * Date: 2026-03-28
 * Keywords: 130 Unique Beauty Keywords
 */

async function main() {
    initDb();

    // --- Configuration ---
    const presetId = 28; // Threads検索・投稿取得
    const containerId = 'loureiroalbuquerqueqd556';
    const queueName = 'queue10'; // Target: Task 10

    const keywords = [
        "1軍コスメ", "Anua", "CANMAKE", "Dior", "ETUDE", "It Cosmetics", "LUNASOL", "Laka リップライナー", "NARS", "PDRN", "Qoo10メガ割", "RMK", "RMK スキンティント", "SHIGETA", "SHISEIDO", "SNIDEL BEAUTY", "SUQQU", "TAMBURINS", "THREE", "Threads美容部", "YSL", "YSL クッションパウダー", "e.l.f. SKIN", "fwee", "hince", "rom&nd", "rom&nd ヌーディカラー", "こじはる", "ご自愛", "さっしー", "なごみちゃん", "アイシャドウパレット", "アイパレ", "アイブロウ", "アイメイク", "アイライン", "アンチエイジング", "イエベ", "イドラクラリティ", "インサイト祭り", "インナードライ", "エガちゃん", "エクソソーム", "エスティローダー", "オルビス", "カバンの中身", "キャンメイク", "キュレル", "クッションファンデ", "クレドポー ボーテ", "クレンジング", "ケイト 毛穴磨き", "コスメ", "コスメデコルテ", "コスメデコルテ 薬用美白", "コンシーラー", "コンビニコスメ", "シェーディング", "シャネル", "スキンケア", "ストック買い", "タンフルリップ", "タンブリンズ", "チーク", "ティント", "ディオール", "トリートメント", "ドラパト", "ハンドクリーム", "パウダー", "パウダーファンデ", "ファンデ", "フェイスパック", "フェイスライン", "フェーズフリーコスメ", "ブルベ", "ヘアオイル", "ヘアケア", "ヘアパック", "ポーチの中身", "マキアージュ エッセンスリキッド", "マスカラ", "ミニコスメ", "ミニリップ", "ミュートメイク", "メイクブラシ", "ラ ロッシュ ポゼ", "リカバリーコスメ", "リキッドファンデ", "リップ", "リップクリーム", "ロムアンド", "ロンジェビティ", "中顔面短縮", "乾燥肌", "使い切りコスメ", "先どりパーツケア", "全域ハリ肌", "化粧水", "垢抜け", "多幸感メイク", "夢中美容", "導入美容液", "小田切ヒロ", "底見えコスメ", "持ち歩きコスメ", "本田真凛", "正直レビュー", "泡パック", "混合肌", "無印良品", "田中みな実", "粘膜リップ", "紗栄子", "美容", "美容の裏側", "美容垢さんと繋がりたい", "美容法", "美容液", "肌なじみ", "肌守り", "肌馴染み", "脂性肌", "調和メイク", "資生堂", "超キラメロコスメ", "追い買い", "透明感", "韓国コスメ新作", "鹿の間"
    ];

    const overrides = {
        repeat_count: 300,
        max_posts: 1000,
        batch_size: 10
    };

    const dryRun = process.argv.includes('--dry-run');

    console.log(`Target: Preset ${presetId}, Container: ${containerId}, Queue: ${queueName}`);
    console.log(`Unique Keywords: ${keywords.length}`);
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
        console.log(`Successfully registered ${successCount} beauty tasks to ${queueName}.`);
    } else {
        console.log(`Dry run finished. ${successCount} tasks would have been registered.`);
    }
}

main().catch(console.error);
