
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    const runs = query(`
        SELECT tr.runId, tr.result_json, t.overrides_json
        FROM task_runs tr
        JOIN tasks t ON tr.runId = t.runId
        WHERE t.preset_id = 28 AND tr.status = 'ok'
        LIMIT 1
    `);

    if (runs.length > 0) {
        const run = runs[0];
        console.log("RunId:", run.runId);
        const res = JSON.parse(run.result_json);
        console.log("Steps Count:", res.steps?.length);

        if (res.steps) {
            res.steps.forEach((s: any, i: number) => {
                console.log(`\nStep ${i}:`);
                console.log("Step keys:", Object.keys(s));
                console.log("Result keys:", s.result ? Object.keys(s.result) : "N/A");
                if (s.result?.iterations) {
                    console.log("Iterations count:", s.result.iterations.length);
                    s.result.iterations.forEach((iter: any, iterIdx: number) => {
                        console.log(`  Iteration ${iterIdx} steps:`, iter.length);
                        iter.forEach((innerStep: any, innerIdx: number) => {
                            console.log(`    Inner Step ${innerIdx} Result:`, JSON.stringify(innerStep.result, null, 2));
                        });
                    });
                }
            });
        }
    }
}

main().catch(console.error);
