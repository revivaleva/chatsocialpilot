
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    console.log('--- Preset ID 6 ---');
    const preset6 = query('SELECT * FROM presets WHERE id = 6');
    console.log(JSON.stringify(preset6, null, 2));

    console.log('\n--- X兵隊 Accounts Count ---');
    const xHeitaiCount = query(`
    SELECT COUNT(*) as count 
    FROM x_accounts 
    WHERE container_id IN (
      SELECT cgm.container_id 
      FROM container_group_members cgm
      JOIN container_groups cg ON cgm.group_id = cg.id
      WHERE cg.name LIKE '%X兵隊%'
    )
  `);
    console.log(JSON.stringify(xHeitaiCount, null, 2));

    console.log('\n--- Container Groups ---');
    const groups = query('SELECT * FROM container_groups');
    console.log(JSON.stringify(groups, null, 2));
}

main().catch(console.error);
