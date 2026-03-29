
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    // すでに run-60* 系のタスクが割り当てられているコンテナを除外して、X兵隊から取得する
    const usedContainers = query("SELECT DISTINCT container_id FROM tasks WHERE runId LIKE 'run-60%'");
    const usedIds = usedContainers.map(c => c.container_id);

    const group = query("SELECT id FROM groups WHERE name = 'X兵隊'")[0];
    if (!group) throw new Error("Group X兵隊 not found");

    const available = query(`
    SELECT container_id, proxy_id 
    FROM accounts 
    WHERE group_id = ? 
    AND container_id NOT IN (\${usedIds.map(() => '?').join(',') || "''"})
  `, [group.id, ...usedIds]);

    console.log('Available accounts:', available.length);
    console.log(JSON.stringify(available.slice(0, 10), null, 2));
}

main().catch(console.error);
