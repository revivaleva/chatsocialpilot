
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    // いいね数（like_count）が多い投稿からキーワード、特に特徴的な単語を簡易抽出
    const topPosts = query(`
        SELECT content 
        FROM post_library 
        WHERE (source_url LIKE '%threads.com%' OR source_url LIKE '%threads.net%')
          AND like_count > 10
        ORDER BY like_count DESC
        LIMIT 1000
    `);

    const words = [
        "ベストコスメ", "ベスコス", "新作", "限定", "ドラスト", "デパコス", "プチプラ",
        "スキンケア", "透明感", "垢抜け", "美肌", "毛穴", "保湿", "美白",
        "アイシャドウ", "リップ", "ファンデ", "下地", "日焼け止め", "マスカラ",
        "おすすめ", "神コスメ", "バズり", "リピ買い", "愛用", "Qoo10", "メガ割",
        "イエベ", "ブルベ", "パーソナルカラー", "韓国コスメ", "プチプラコスメ",
        "ドラコス", "使い切り", "殿堂入り", "毎日メイク", "スクールメイク"
    ];

    const counts: Record<string, number> = {};
    words.forEach(w => counts[w] = 0);

    topPosts.forEach((p: any) => {
        if (!p.content) return;
        words.forEach(w => {
            if (p.content.includes(w)) {
                counts[w]++;
            }
        });
    });

    console.log("Common Keyword Frequencies in Top 1000 Threads Posts:");
    console.table(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

main().catch(console.error);
