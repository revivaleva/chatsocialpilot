
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    console.log("--- Schema info ---");
    const taskRunsInfo = query("PRAGMA table_info(task_runs)");
    console.log("task_runs columns:", taskRunsInfo.map((c: any) => c.name).join(", "));

    const postLibraryInfo = query("PRAGMA table_info(post_library)");
    console.log("post_library columns:", postLibraryInfo.map((c: any) => c.name).join(", "));

    console.log("\n--- Sample post_library records ---");
    const posts = query("SELECT id, content, source_url, account_id, created_at FROM post_library ORDER BY created_at DESC LIMIT 5");
    console.log(JSON.stringify(posts, null, 2));

    console.log("\n--- Search for 'threads' in source_url ---");
    const threadsSample = query("SELECT source_url FROM post_library WHERE source_url LIKE '%threads%' LIMIT 5");
    console.log(JSON.stringify(threadsSample, null, 2));
}

main().catch(console.error);
