
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    const taskCount = query("SELECT count(*) as c FROM tasks WHERE preset_id = 28")[0].c;
    console.log("Total tasks for preset 28:", taskCount);

    const taskRunsCount = query(`
        SELECT count(*) as c 
        FROM task_runs tr
        JOIN tasks t ON tr.runId = t.runId
        WHERE t.preset_id = 28
    `)[0].c;
    console.log("Total task_runs for preset 28:", taskRunsCount);

    const runStatuses = query(`
        SELECT tr.status, count(*) as c
        FROM task_runs tr
        JOIN tasks t ON tr.runId = t.runId
        WHERE t.preset_id = 28
        GROUP BY tr.status
    `);
    console.log("Task Runs Statuses:");
    console.table(runStatuses);

    // If task_runs is empty, maybe they are in run_history?
    // Or maybe the tasks were run but run_history was cleaned up?
}

main().catch(console.error);
