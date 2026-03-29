
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    console.log("--- run_history schema ---");
    const info = query("PRAGMA table_info(run_history)");
    info.forEach((c: any) => console.log(c.name));
}

main().catch(console.error);
