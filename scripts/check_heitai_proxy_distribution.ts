
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const accounts = query(`
        SELECT a.proxy_id, COUNT(*) as count 
        FROM x_accounts a
        JOIN container_group_members cgm ON a.container_id = cgm.container_id
        JOIN container_groups cg ON cgm.group_id = cg.id
        WHERE cg.name = 'X兵隊'
        GROUP BY a.proxy_id
    `, []);
    console.log('Proxy distribution for X兵隊:');
    console.log(JSON.stringify(accounts, null, 2));
}

main().catch(console.error);
