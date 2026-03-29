
import { initDb, query } from "../src/drivers/db";

async function main() {
    initDb();

    console.log("### Future Tasks count ###");
    const count = query(`
        SELECT COUNT(*) as count 
        FROM tasks 
        WHERE scheduled_at > strftime('%s', 'now') * 1000
    `, []) as any[];
    console.table(count);

    console.log("### Future Tasks sample ###");
    const tasks = query(`
        SELECT id, container_id, status, datetime(scheduled_at/1000, 'unixepoch', 'localtime') as scheduled 
        FROM tasks 
        WHERE scheduled_at > strftime('%s', 'now') * 1000
        ORDER BY scheduled_at ASC
        LIMIT 20
    `, []) as any[];
    console.table(tasks);
}

main().catch(console.error);
