
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    console.log("Count with threads.com:", query("SELECT count(*) as c FROM post_library WHERE source_url LIKE '%threads.com%'")[0].c);
    console.log("Count with threads.net:", query("SELECT count(*) as c FROM post_library WHERE source_url LIKE '%threads.net%'")[0].c);

    console.log("\nSample 10 Threads posts:");
    const samples = query(`
        SELECT content, source_url, like_count 
        FROM post_library 
        WHERE source_url LIKE '%threads.com%' OR source_url LIKE '%threads.net%'
        LIMIT 10
    `);
    console.table(samples);
}

main().catch(console.error);
