
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const info = query("PRAGMA table_info(tasks)");
    console.log(JSON.stringify(info, null, 2));
}

main().catch(console.error);
