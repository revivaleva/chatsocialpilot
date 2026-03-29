
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    const runs = query(`
        SELECT tr.runId, tr.result_json, t.overrides_json
        FROM task_runs tr
        JOIN tasks t ON tr.runId = t.runId
        WHERE t.preset_id = 28 AND tr.status = 'ok'
        ORDER BY tr.id DESC
        LIMIT 50
    `);

    let totalSavedAll = 0;
    let totalSkippedAll = 0;
    let fullMatchedCount = 0;

    runs.forEach((run: any) => {
        const overrides = JSON.parse(run.overrides_json || '{}');
        const maxPosts = parseInt(overrides.max_posts || '0');
        const res = JSON.parse(run.result_json || '{}');

        let runSaved = 0;
        let runSkipped = 0;

        if (res.steps && res.steps.length > 1) {
            const forStep = res.steps[1];
            const iterations = forStep.result?.iterations;
            if (iterations) {
                iterations.forEach((iter: any) => {
                    const saveResult = iter[1]?.result;
                    if (saveResult) {
                        runSaved += (saveResult.saved || 0);
                        runSkipped += (saveResult.skipped || 0);
                    }
                });
            }
        }

        totalSavedAll += runSaved;
        totalSkippedAll += runSkipped;
        if (runSaved >= maxPosts && maxPosts > 0) {
            fullMatchedCount++;
        }
    });

    console.log(`Summary of 50 sampled runs:`);
    console.log(`Total Saved: ${totalSavedAll}`);
    console.log(`Total Skipped: ${totalSkippedAll}`);
}

main().catch(console.error);
