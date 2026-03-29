import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    const proxyId = 202;
    console.log(`\nChecking accounts using Proxy ID: ${proxyId}`);
    const accounts = query('SELECT container_id FROM x_accounts WHERE proxy_id = ?', [proxyId]);
    console.log(`Total accounts using this proxy: ${accounts.length}`);

    for (const acc of accounts) {
        const tasks = query('SELECT runId, status, updated_at FROM tasks WHERE container_id = ? ORDER BY updated_at DESC LIMIT 5', [acc.container_id]);
        console.log(`\nContainer: ${acc.container_id}`);
        for (const t of tasks) {
            console.log(`  - Task: ${t.runId}, Status: ${t.status}, Updated: ${new Date(t.updated_at).toISOString()}`);
        }
    }
}

main().catch(console.error);
