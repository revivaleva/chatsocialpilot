
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const xid = 'DonaldRobi54643';
    const rows = query('SELECT * FROM x_accounts WHERE container_id = ?', [xid]);
    console.log(JSON.stringify(rows[0], null, 2));
}

main().catch(console.error);
