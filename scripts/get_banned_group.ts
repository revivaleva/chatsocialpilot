
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const graps = query('SELECT id, name FROM container_groups WHERE name = ?', ["Banned"]) as any[];
    console.log(JSON.stringify(graps, null, 2));
}

main().catch(console.error);
