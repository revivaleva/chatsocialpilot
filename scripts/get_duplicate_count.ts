
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const xid = '6df1aacd-4623-4908-9e2d-9fa1d9990109';
    const bid = 'g-1765464486487-7758';
    const rows = query('SELECT count(*) as count FROM container_group_members WHERE group_id = ? AND container_id IN (SELECT container_id FROM container_group_members WHERE group_id = ?)', [xid, bid]) as any[];
    console.log(JSON.stringify(rows[0], null, 2));
}

main().catch(console.error);
