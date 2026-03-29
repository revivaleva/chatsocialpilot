
import { initDb, query } from "../src/drivers/db";

async function main() {
    initDb();

    const runId = 'run-40-2026-03-16T02-01-22-068Z-857836';
    console.log(`### Details for runId: ${runId} ###`);

    const task = query("SELECT * FROM tasks WHERE runId = ?", [runId])[0] as any;
    console.log("Task Status:", task?.status);
    console.log("Updated At:", new Date(task?.updated_at).toLocaleString('ja-JP'));

    const runs = query("SELECT * FROM task_runs WHERE runId = ? ORDER BY started_at DESC", [runId]) as any[];
    console.log(`Total runs found: ${runs.length}`);
    if (runs.length > 0) {
        console.log("Latest Run Status:", runs[0].status);
        console.log("Started At:", new Date(runs[0].started_at).toLocaleString('ja-JP'));
        console.log("Ended At:", runs[0].ended_at ? new Date(runs[0].ended_at).toLocaleString('ja-JP') : "Still Running?");
        console.log("Result Snippet:", runs[0].result_json ? runs[0].result_json.slice(0, 500) : "No result yet");
    }

    // Check if there are ANY recurring updates in task_runs (e.g. steps being logged)
    // Actually, task_runs usually only has result_json. Status is updated in tasks table?
    // Wait, taskQueue.ts updates task_runs.status too.
}

main().catch(console.error);
