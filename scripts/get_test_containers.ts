
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const containers = query(" \
    SELECT x.container_id \
    FROM x_accounts x \
    JOIN container_group_members cgm ON x.container_id = cgm.container_id \
    JOIN container_groups cg ON cgm.group_id = cg.id \
    WHERE cg.name = 'X兵隊' \
    LIMIT 4 \
  ");
    console.log(JSON.stringify(containers, null, 2));
}

main().catch(console.error);
