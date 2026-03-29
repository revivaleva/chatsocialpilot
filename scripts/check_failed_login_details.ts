
import { initDb, query } from "../src/drivers/db";

async function main() {
    initDb();

    const startAt = new Date("2026-03-09T00:00:00+09:00").getTime();

    const failedTasks = query(`
        SELECT t.container_id, tr.status, tr.result_json, tr.ended_at
        FROM tasks t
        JOIN task_runs tr ON t.id = tr.task_id
        WHERE t.preset_id IN (17, 39, 42)
        AND tr.ended_at >= ?
        AND tr.status NOT IN ('ok', 'done')
    `, [startAt]) as any[];

    console.log(`\n### All Failed Login Task Runs (${failedTasks.length}) ###`);
    for (const t of failedTasks) {
        let error = "n/a";
        try {
            const res = JSON.parse(t.result_json);
            error = res.error || res.message || (res.results && res.results.find((s: any) => s.outcome === 'failed')?.error) || "Unknown error";
        } catch (e) { }
        console.log(`- ${t.container_id} (${new Date(t.ended_at).toLocaleString()}): ${error}`);
    }
}

main().catch(console.error);
