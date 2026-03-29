
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const rows = query('SELECT count(*) as count FROM container_group_members WHERE group_id = ?', ["g-1765464486487-7758"]) as any[];
    console.log(JSON.stringify(rows[0], null, 2));
}

main().catch(console.error);
