
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const columns = query("PRAGMA table_info(container_group_members)");
    console.log(JSON.stringify(columns, null, 2));
}

main().catch(console.error);
