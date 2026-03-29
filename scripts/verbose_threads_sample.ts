
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    const sample = query(`
        SELECT content, source_url, like_count 
        FROM post_library 
        WHERE source_url LIKE '%threads.com%' OR source_url LIKE '%threads.net%'
        LIMIT 5
    `);

    sample.forEach((p: any, i: number) => {
        console.log(`[${i}] URL: ${p.source_url}`);
        console.log(`    Likes: ${p.like_count}`);
        console.log(`    Content: ${p.content?.substring(0, 100)}...`);
    });
}

main().catch(console.error);
