import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    console.log('--- Checking X Accounts for Rolex ---');
    const xAccounts = query("SELECT * FROM x_accounts WHERE notes LIKE '%rolex%' OR x_username LIKE '%rolex%'");
    console.log(JSON.stringify(xAccounts, null, 2));

    console.log('\n--- Checking Container Groups for Rolex ---');
    const groups = query("SELECT * FROM container_groups WHERE name LIKE '%rolex%' OR description LIKE '%rolex%'");
    console.log(JSON.stringify(groups, null, 2));
}

main().catch(console.error);
