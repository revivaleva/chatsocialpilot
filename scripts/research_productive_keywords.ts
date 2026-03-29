
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    // 1. 各キーワードごとの「新規取得数」と「平均いいね数」を集計
    // note: overrides_jsonからkeywordを抽出して集計
    const keywordPerformance = query(`
        SELECT 
            json_extract(t.overrides_json, '$.keyword') as keyword,
            count(*) as run_count,
            sum(CASE WHEN tr.status = 'ok' THEN 1 ELSE 0 END) as success_runs
        FROM tasks t
        JOIN task_runs tr ON t.runId = tr.runId
        WHERE t.preset_id = 28
        GROUP BY keyword
        ORDER BY success_runs DESC
        LIMIT 20
    `);

    console.log("Keyword Task Performance (Top 20 by success runs):");
    console.table(keywordPerformance);

    // 2. post_libraryから、Threadsの投稿に含まれるハッシュタグやキーワードの出現頻度を再集計（より広範囲に）
    const recentPosts = query(`
        SELECT content 
        FROM post_library 
        WHERE source_url LIKE '%threads%'
        ORDER BY created_at DESC
        LIMIT 2000
    `);

    const tagMap: Record<string, number> = {};
    const hashtagRegex = /#([^\s#]+)/g;

    recentPosts.forEach((p: any) => {
        if (!p.content) return;
        let match;
        while ((match = hashtagRegex.exec(p.content)) !== null) {
            const tag = match[1];
            tagMap[tag] = (tagMap[tag] || 0) + 1;
        }
    });

    console.log("\nTrending Hashtags found in recent Threads posts:");
    const topTags = Object.entries(tagMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20);
    console.table(topTags);
}

main().catch(console.error);
