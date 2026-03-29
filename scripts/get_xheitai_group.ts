
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const rows = query('SELECT id, name FROM container_groups WHERE name = ?', ["X兵隊"]) as any[];
    console.log(JSON.stringify(rows, null, 2));
}

main().catch(console.error);
