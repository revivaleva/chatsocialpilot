
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    console.log('--- x_accounts Schema ---');
    const columns = query("PRAGMA table_info(x_accounts)");
    console.log(JSON.stringify(columns, null, 2));
}

main().catch(console.error);
