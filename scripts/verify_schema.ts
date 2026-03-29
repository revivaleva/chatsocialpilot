
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    console.log("--- task_runs schema again ---");
    const info = query("PRAGMA table_info(task_runs)");
    console.log(info);

    console.log("\n--- tasks schema again ---");
    const info2 = query("PRAGMA table_info(tasks)");
    console.log(info2);
}

main().catch(console.error);
