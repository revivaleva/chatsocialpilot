
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    // 直近で登録されたPreset 28のタスクからキーワード（overrides_json内のkeyword）を抽出
    const recentTasks = query(`
        SELECT DISTINCT json_extract(overrides_json, '$.keyword') as keyword
        FROM tasks
        WHERE preset_id = 28
        ORDER BY created_at DESC
        LIMIT 100
    `);

    console.log("Recently Used Keywords (Preset 28):");
    console.log(JSON.stringify(recentTasks.map((t: any) => t.keyword).filter((k: any) => k), null, 2));

    // post_libraryから、Threadsの投稿で「いいね数」が多いものから頻出単語を簡易抽出
    // (高度な形態素解析はできないが、目視や簡易カウントで傾向を掴む)
    const topPosts = query(`
        SELECT content
        FROM post_library
        WHERE source_url LIKE '%threads.net%'
        ORDER BY like_count DESC
        LIMIT 100
    `);

    console.log("\nTop 100 Posts Content Preview:");
    topPosts.forEach((p: any, i: number) => {
        console.log(`[${i}] ${p.content.substring(0, 100).replace(/\n/g, ' ')}...`);
    });
}

main().catch(console.error);
