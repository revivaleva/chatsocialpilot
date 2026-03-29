
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    console.log("--- task_runs schema ---");
    const info = query("PRAGMA table_info(task_runs)");
    info.forEach((c: any) => console.log(c.name));
}

main().catch(console.error);
