
import { initDb, query } from "../src/drivers/db";

async function main() {
    initDb();

    console.log("### Groups ###");
    console.table(query("SELECT * FROM container_groups", []));

    console.log("### X兵隊 tasks (any status) ###");
    const tasks = query(`
        SELECT t.id, t.status, datetime(t.scheduled_at/1000, 'unixepoch', 'localtime') as scheduled 
        FROM tasks t
        WHERE t.container_id IN (
            SELECT cgm.container_id 
            FROM container_group_members cgm
            JOIN container_groups cg ON cgm.group_id = cg.id
            WHERE cg.name = 'X兵隊'
        )
        ORDER BY t.scheduled_at DESC
        LIMIT 20
    `, []);
    console.table(tasks);
}

main().catch(console.error);
