import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    const results: any[] = query('SELECT proxy_id, COUNT(*) as count FROM x_accounts GROUP BY proxy_id', []);
    console.log('Proxy distribution in x_accounts:');
    for (const r of results) {
        const proxy: any = r.proxy_id ? query('SELECT proxy_info FROM proxies WHERE id = ?', [r.proxy_id])[0] : { proxy_info: 'NONE' };
        console.log(`Proxy ID: ${r.proxy_id}, Count: ${r.count}, Info: ${proxy?.proxy_info}`);
    }
}

main().catch(console.error);
