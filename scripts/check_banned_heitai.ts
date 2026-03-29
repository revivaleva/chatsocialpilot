
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    const results = query(' \
    SELECT COUNT(*) as count \
    FROM container_group_members cgm1 \
    JOIN container_group_members cgm2 ON cgm1.container_id = cgm2.container_id \
    JOIN container_groups cg1 ON cgm1.group_id = cg1.id \
    JOIN container_groups cg2 ON cgm2.group_id = cg2.id \
    WHERE cg1.name = "X兵隊" AND cg2.name = "Banned" \
  ');
    console.log('Banned in X兵隊:', results[0].count);
}

main().catch(console.error);
