import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const xaCount = query('SELECT COUNT(*) as count FROM x_accounts')[0].count;
    const xaUuidCount = query("SELECT COUNT(*) as count FROM x_accounts WHERE container_id LIKE '%-%-%-%-%'")[0].count;
    console.log(`x_accounts total: ${xaCount}, with UUID: ${xaUuidCount}`);
}

main().catch(console.error);
