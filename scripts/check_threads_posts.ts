
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    console.log("Sampling 10 posts from Threads:");
    const samples = query(`
        SELECT content, source_url, like_count 
        FROM post_library 
        WHERE source_url LIKE '%threads.net%'
        LIMIT 10
    `);
    console.table(samples);

    console.log("\nCounts by like_count:");
    const counts = query(`
        SELECT like_count, count(*) as count 
        FROM post_library 
        WHERE source_url LIKE '%threads.net%'
        GROUP BY like_count
        ORDER BY count DESC
        LIMIT 10
    `);
    console.table(counts);
}

main().catch(console.error);
