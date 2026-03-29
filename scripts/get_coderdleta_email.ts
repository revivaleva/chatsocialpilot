
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const rows = query('SELECT email, email_password FROM x_accounts WHERE container_id = ?', ["CoderDleta48054"]) as any[];
    console.log(JSON.stringify(rows[0], null, 2));
}

main().catch(console.error);
