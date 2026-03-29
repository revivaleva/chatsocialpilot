
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    // Correct column names for task_runs: id, runId, status, result_json, started_at, ended_at
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
    let fullMatchedCount = 0; // runs where we reached max_posts

    console.log("Analyze Recent 50 Runs of Preset 28:");
    console.log("RunId | Keyword | Saved | Skipped | Target");

    runs.forEach((run: any) => {
        const overrides = JSON.parse(run.overrides_json || '{}');
        const maxPosts = parseInt(overrides.max_posts || '0');
        const res = JSON.parse(run.result_json || '{}');

        let runSaved = 0;
        let runSkipped = 0;

        if (res.steps && res.steps.length > 1) {
            const forStep = res.steps[1];
            if (forStep.iterations) {
                forStep.iterations.forEach((iter: any) => {
                    // Back in step 50, we saw:
                    // iter[0] is pr_search_results (extraction)
                    // iter[1] is pr_save_result (saving)
                    const saveResult = iter[1]?.result;
                    if (saveResult) {
                        runSaved += (saveResult.saved || 0);
                        runSkipped += (saveResult.skipped || 0);
                    }
                });
            }
        }

        console.log(`${run.runId.substring(0, 20)}... | ${overrides.keyword || 'N/A'} | ${runSaved} | ${runSkipped} | ${maxPosts}`);

        totalSavedAll += runSaved;
        totalSkippedAll += runSkipped;
        if (runSaved >= maxPosts && maxPosts > 0) {
            fullMatchedCount++;
        }
    });

    console.log("\nSummary of 50 sampled runs:");
    console.log(`Total Saved: ${totalSavedAll}`);
    console.log(`Total Skipped: ${totalSkippedAll}`);
    console.log(`Fully Matched Target Rate: ${fullMatchedCount}/50 (${(fullMatchedCount / 50 * 100).toFixed(1)}%)`);
}

main().catch(console.error);
