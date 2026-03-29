
import { initDb, query } from "../src/drivers/db";

async function main() {
    initDb();

    console.log("### Current Time: " + new Date().toLocaleString('ja-JP'));

    console.log("\n### Summary of tasks by status and queue (since 3/16) ###");
    const summary = query(`
        SELECT queue_name, status, count(*) as count 
        FROM tasks 
        WHERE created_at >= ?
        GROUP BY queue_name, status
    `, [new Date("2026-03-16T00:00:00+09:00").getTime()]) as any[];
    console.table(summary);

    console.log("\n### Top 10 tasks stuck in 'running' according to tasks table ###");
    const runningTasks = query(`
        SELECT runId, container_id, status, datetime(scheduled_at/1000, 'unixepoch', 'localtime') as scheduled_at_local, datetime(updated_at/1000, 'unixepoch', 'localtime') as updated_at_local
        FROM tasks
        WHERE status = 'running'
        ORDER BY scheduled_at ASC
        LIMIT 10
    `, []) as any[];
    console.table(runningTasks);

    console.log("\n### Top 10 tasks in 'pending' that should have run (scheduled_at < now) ###");
    const overduePending = query(`
        SELECT runId, container_id, status, datetime(scheduled_at/1000, 'unixepoch', 'localtime') as scheduled_at_local, datetime(updated_at/1000, 'unixepoch', 'localtime') as updated_at_local
        FROM tasks
        WHERE status = 'pending' AND scheduled_at < ?
        ORDER BY scheduled_at ASC
        LIMIT 10
    `, [Date.now()]) as any[];
    console.table(overduePending);

    console.log("\n### Checking if any tasks are in 'waiting_success' or other waiting states ###");
    const waitingTasks = query(`
        SELECT runId, container_id, status, datetime(scheduled_at/1000, 'unixepoch', 'localtime') as scheduled_at_local, datetime(updated_at/1000, 'unixepoch', 'localtime') as updated_at_local
        FROM tasks
        WHERE status LIKE 'waiting%'
        LIMIT 10
    `, []) as any[];
    console.table(waitingTasks);
}

main().catch(console.error);
