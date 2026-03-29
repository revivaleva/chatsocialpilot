
import { initDb, query } from '../src/drivers/db.js';

async function main() {
  initDb();
  const data = query(`
        SELECT p.* FROM proxies p
        WHERE p.id IN (
            SELECT x.proxy_id 
            FROM container_group_members m
            JOIN container_groups g ON m.group_id = g.id
            JOIN x_accounts x ON m.container_id = x.container_id
            WHERE g.name = 'X兵隊'
        )
        LIMIT 5
    `, []);
  console.log('X Soldier Proxies:', JSON.stringify(data, null, 2));
}

main().catch(console.error);
