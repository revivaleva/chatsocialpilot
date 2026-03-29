
import { initDb, query } from "../src/drivers/db";

async function main() {
    initDb();

    const startAt = new Date("2026-03-09T00:00:00+09:00").getTime();

    const tasks = query(`
        SELECT date(tr.ended_at / 1000, 'unixepoch', 'localtime') as day, tr.status, count(*) as count
        FROM tasks t
        JOIN task_runs tr ON t.id = tr.task_id
        WHERE t.preset_id IN (17, 39, 42)
        AND tr.ended_at >= ?
        GROUP BY day, tr.status
    `, [startAt]) as any[];

    console.table(tasks);
}

main().catch(console.error);
