
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const tableInfo = query("PRAGMA table_info(x_accounts)", []);
    console.log('x_accounts table info:');
    console.log(JSON.stringify(tableInfo, null, 2));

    const groups = query("SELECT id, name FROM groups", []);
    console.log('Groups:');
    console.log(JSON.stringify(groups, null, 2));
}

main().catch(console.error);
