
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    console.log('--- run_history columns ---');
    const cols = query("PRAGMA table_info(run_history)");
    console.log(JSON.stringify(cols, null, 2));
}

main().catch(console.error);
