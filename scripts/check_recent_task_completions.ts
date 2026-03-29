
import { initDb, query } from "../src/drivers/db";

async function main() {
    initDb();

    console.log("### Recently completed tasks (ended_at) ###");
    const recentEnds = query(`
        SELECT runId, status, datetime(started_at/1000, 'unixepoch', 'localtime') as started, datetime(ended_at/1000, 'unixepoch', 'localtime') as ended
        FROM task_runs
        ORDER BY ended_at DESC
        LIMIT 20
    `, []) as any[];
    console.table(recentEnds);
}

main().catch(console.error);
