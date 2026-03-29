
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    const runs = query(`
        SELECT tr.runId, tr.result_json, t.overrides_json
        FROM task_runs tr
        JOIN tasks t ON tr.runId = t.runId
        WHERE t.preset_id = 28 AND tr.status = 'ok'
        ORDER BY tr.finished_at DESC
        LIMIT 5
    `);

    runs.forEach((run: any, idx: number) => {
        console.log(`\n--- Run ${idx}: ${run.runId} ---`);
        const res = JSON.parse(run.result_json);
        console.log("Steps length:", res.steps?.length);
        if (res.steps && res.steps.length > 1) {
            const forStep = res.steps[1];
            console.log("Step 1 keys:", Object.keys(forStep));
            if (forStep.iterations) {
                console.log("Iterations count:", forStep.iterations.length);
                let totalSaved = 0;
                let totalSkipped = 0;
                forStep.iterations.forEach((iter: any) => {
                    const saveResult = iter[1]?.result; // Inner step 1
                    if (saveResult) {
                        totalSaved += (saveResult.saved || 0);
                        totalSkipped += (saveResult.skipped || 0);
                    }
                });
                console.log(`Aggregated from iterations: Saved: ${totalSaved}, Skipped: ${totalSkipped}`);
            } else {
                console.log("Step 1 has NO iterations");
            }
        }
    });
}

main().catch(console.error);
