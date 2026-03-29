
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    console.log("Sampling 10 records from post_library:");
    const samples = query("SELECT source_url FROM post_library LIMIT 10");
    console.table(samples);
}

main().catch(console.error);
