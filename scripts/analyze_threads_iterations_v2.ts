
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    // Use updated_at instead
    const runs = query(`
        SELECT tr.runId, tr.result_json, t.overrides_json
        FROM task_runs tr
        JOIN tasks t ON tr.runId = t.runId
        WHERE t.preset_id = 28 AND tr.status = 'ok'
        ORDER BY tr.updated_at DESC
        LIMIT 5
    `);

    runs.forEach((run: any, idx: number) => {
        console.log(`\n--- Run ${idx}: ${run.runId} ---`);
        const res = JSON.parse(run.result_json);
        console.log("Steps length:", res.steps?.length);
        if (res.steps) {
            res.steps.forEach((s: any, stepIdx: number) => {
                console.log(`Step ${stepIdx}: Keys: [${Object.keys(s).join(", ")}]`);
                if (s.iterations) {
                    console.log(`Step ${stepIdx} Iterations count: ${s.iterations.length}`);
                }
            });
        }
    });
}

main().catch(console.error);
