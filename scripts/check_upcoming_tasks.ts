
import { initDb, query } from "../src/drivers/db";

async function main() {
    initDb();

    console.log("### Upcoming 'X兵隊' tasks ###");
    const upcoming = query(`
        SELECT datetime(scheduled_at/1000, 'unixepoch', 'localtime') as scheduled, status, COUNT(*) as count
        FROM tasks t
        JOIN container_group_members cgm ON t.container_id = cgm.container_id
        JOIN container_groups cg ON cgm.group_id = cg.id
        WHERE cg.name = 'X兵隊' AND scheduled_at > strftime('%s', 'now') * 1000
        GROUP BY scheduled
        ORDER BY scheduled ASC
        LIMIT 20
    `, []) as any[];
    console.table(upcoming);
}

main().catch(console.error);
