
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const groups = query("SELECT * FROM container_groups");
    console.log(JSON.stringify(groups, null, 2));
}

main().catch(console.error);
