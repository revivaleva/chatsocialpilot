
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    console.log('--- X兵隊 Group Members Status ---');
    const xHeitaiMembers = query(" \
    SELECT x.id, x.container_id, x.x_username, x.is_banned \
    FROM x_accounts x \
    JOIN container_group_members cgm ON x.container_id = cgm.container_id \
    JOIN container_groups cg ON cgm.group_id = cg.id \
    WHERE cg.name = 'X兵隊' \
    LIMIT 200 \
  ");
    console.log(JSON.stringify(xHeitaiMembers, null, 2));

    console.log('\n--- X兵隊 Members Total Count ---');
    const totalHeitaiCount = query(" \
    SELECT COUNT(*) as count \
    FROM x_accounts x \
    JOIN container_group_members cgm ON x.container_id = cgm.container_id \
    JOIN container_groups cg ON cgm.group_id = cg.id \
    WHERE cg.name = 'X兵隊' \
  ");
    console.log(totalHeitaiCount[0].count);
}

main().catch(console.error);
