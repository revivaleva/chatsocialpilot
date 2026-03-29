
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const res = query('SELECT MAX(id) as maxId FROM presets');
    console.log(res[0].maxId);
}

main().catch(console.error);
