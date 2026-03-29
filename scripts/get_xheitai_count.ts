
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const rows = query('SELECT count(*) as count FROM container_group_members WHERE group_id = ?', ["6df1aacd-4623-4908-9e2d-9fa1d9990109"]) as any[];
    console.log(JSON.stringify(rows[0], null, 2));
}

main().catch(console.error);
