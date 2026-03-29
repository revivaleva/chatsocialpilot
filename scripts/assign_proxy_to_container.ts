
import { initDb, run, query } from '../src/drivers/db.js';

/**
 * Script to assign a proxy to a specific container by adding/updating its entry in x_accounts.
 */

async function main() {
    initDb();

    const containerId = 'loureiroalbuquerqueqd556';
    const proxyId = 202; // isp.decodo.com:10001
    const now = Date.now();

    console.log(`Assigning proxy ID ${proxyId} to container: ${containerId}`);

    // Check if proxy exists
    const proxyExists = query(`SELECT id FROM proxies WHERE id = ?`, [proxyId])[0];
    if (!proxyExists) {
        console.error(`Error: Proxy ID ${proxyId} not found in proxies table.`);
        return;
    }

    // Check if entry already exists in x_accounts
    const existing = query(`SELECT id FROM x_accounts WHERE container_id = ?`, [containerId])[0] as any;

    if (existing) {
        console.log(`Updating existing record in x_accounts (ID: ${existing.id})...`);
        run(`
            UPDATE x_accounts 
            SET proxy_id = ?, updated_at = ? 
            WHERE container_id = ?
        `, [proxyId, now, containerId]);
    } else {
        console.log(`Creating new record in x_accounts for container...`);
        run(`
            INSERT INTO x_accounts (container_id, proxy_id, created_at, updated_at) 
            VALUES (?, ?, ?, ?)
        `, [containerId, proxyId, now, now]);
    }

    console.log(`Successfully assigned proxy to ${containerId}.`);

    // Verify
    const verify = query(`SELECT * FROM x_accounts WHERE container_id = ?`, [containerId])[0];
    console.log('Verification:', JSON.stringify(verify));
}

main().catch(console.error);
