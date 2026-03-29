
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const xid = 'nancy9869865732';
    const rows = query('SELECT * FROM x_accounts WHERE container_id = ? OR x_username = ?', [xid, xid]);
    if (rows.length === 0) {
        console.error(`Account not found for ${xid}. Checked container_id and x_username.`);
        const counts = query('SELECT count(*) as cnt FROM x_accounts', []);
        console.log(`Total accounts in DB: ${counts[0].cnt}`);
    } else {
        console.log(JSON.stringify(rows[0], null, 2));
    }
}

main().catch(console.error);
