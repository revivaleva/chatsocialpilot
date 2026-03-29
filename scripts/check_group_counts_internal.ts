
import { initDb, query } from "../src/drivers/db";

async function main() {
    initDb();

    console.log("### Group Counts (Internal Check) ###");
    const counts = query(`
        SELECT cg.name, count(cgm.container_id) as count
        FROM container_groups cg
        LEFT JOIN container_group_members cgm ON cg.id = cgm.group_id
        GROUP BY cg.id
        HAVING count > 0
        ORDER BY count DESC
    `, []) as any[];
    console.table(counts);
}

main().catch(console.error);
