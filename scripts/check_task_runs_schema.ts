
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    console.log('--- task_runs columns ---');
    const cols = query("PRAGMA table_info(task_runs)");
    console.log(JSON.stringify(cols, null, 2));
}

main().catch(console.error);
