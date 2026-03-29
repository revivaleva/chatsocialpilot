
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    // Try to find the group ID for "X兵隊" by looking at x_accounts group_id values and what looks like a group table.
    // Maybe the table name is "container_groups" or something.
    const tables = query("SELECT name FROM sqlite_master WHERE type='table'", []);
    console.log('Tables:', JSON.stringify(tables, null, 2));

    // Check account status for "X兵隊" group
    const accounts = query("SELECT DISTINCT group_id FROM x_accounts", []);
    console.log('Unique Group IDs in x_accounts:', JSON.stringify(accounts, null, 2));
}

main().catch(console.error);
