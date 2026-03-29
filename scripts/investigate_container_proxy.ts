
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    const containerId = 'loureiroalbuquerqueqd556';
    console.log(`Investigating proxy for container: ${containerId}`);

    // 0. List all tables
    const tables = query(`SELECT name FROM sqlite_master WHERE type='table'`) as any[];
    console.log(`Tables in DB: ${tables.map(t => t.name).join(', ')}`);

    // 1. Search containerId in all tables
    console.log(`\nSearching for ${containerId} in all tables...`);
    for (const table of tables.map(t => t.name)) {
        try {
            const columns = query(`PRAGMA table_info(${table})`) as any[];
            const hasContainerCol = columns.some(c => c.name.toLowerCase().includes('container'));
            if (hasContainerCol) {
                const results = query(`SELECT * FROM ${table} WHERE container_id = ?`, [containerId]);
                if (results.length > 0) {
                    console.log(`[MATCH] Found in table '${table}':`, JSON.stringify(results));
                }
            }
        } catch (e) { }
    }

    // Check x_accounts specifically
    const xAccount = query(`
        SELECT * 
        FROM x_accounts 
        WHERE container_id = ?
    `, [containerId])[0] as any;

    if (xAccount) {
        console.log(`Container found in x_accounts. Current proxy_id: ${xAccount.proxy_id}`);
        if (xAccount.proxy_id) {
            const proxyInfo = query(`SELECT * FROM proxies WHERE id = ?`, [xAccount.proxy_id])[0] as any;
            if (proxyInfo) {
                console.log(`Assigned Proxy Info: ${JSON.stringify(proxyInfo)}`);
            } else {
                console.log(`Proxy ID ${xAccount.proxy_id} not found in proxies table!`);
            }
        }
    } else {
        console.log(`Container ${containerId} NOT found in x_accounts table.`);
    }

    // 2. List all available proxies
    console.log('\nAvailable proxies in DB (first 10):');
    const allProxies = query(`SELECT id, proxy_info FROM proxies LIMIT 10`);
    console.table(allProxies);

    // 2.5 List some x_accounts to see pattern
    console.log('\nSample x_accounts:');
    const sampleAccounts = query(`SELECT id, container_id, x_username, proxy_id FROM x_accounts LIMIT 10`);
    console.table(sampleAccounts);

    // 3. Check for any tasks with proxy overrides (just in case)
    const recentTasks = query(`
        SELECT id, runId, overrides_json 
        FROM tasks 
        WHERE container_id = ? 
        ORDER BY created_at DESC 
        LIMIT 5
    `, [containerId]);

    console.log('\nRecent tasks for this container:');
    recentTasks.forEach((t: any) => {
        console.log(`Task ${t.id} (${t.runId}): ${t.overrides_json}`);
    });
}

main().catch(console.error);
