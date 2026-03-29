
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const schema = query("PRAGMA table_info(x_accounts)", []);
    console.log('x_accounts schema:');
    console.log(JSON.stringify(schema, null, 2));
}

main().catch(console.error);
