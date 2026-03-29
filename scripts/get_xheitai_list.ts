
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const gid = '6df1aacd-4623-4908-9e2d-9fa1d9990109';
    const rows = query('SELECT container_id FROM container_group_members WHERE group_id = ?', [gid]) as any[];
    console.log(JSON.stringify(rows.map(r => r.container_id), null, 2));
}

main().catch(console.error);
