
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    const runs = query(`
        SELECT tr.runId, tr.result_json, t.overrides_json
        FROM task_runs tr
        JOIN tasks t ON tr.runId = t.runId
        WHERE t.preset_id = 28 AND tr.status = 'ok'
    `);

    let totalSaved = 0;
    let totalSkipped = 0;
    let runsWithResults = 0;

    runs.forEach((run: any) => {
        const res = JSON.parse(run.result_json);
        if (res.steps && res.steps.length > 1) {
            const forStep = res.steps[1];
            // Check if forStep.result has totalSaved (aggregated by executor?)
            if (forStep.result?.totalSaved > 0) {
                totalSaved += forStep.result.totalSaved;
                runsWithResults++;
            }

            // Or check iterations
            if (forStep.result?.iterations) {
                forStep.result.iterations.forEach((iter: any) => {
                    const saveRes = iter[1]?.result;
                    if (saveRes && saveRes.saved !== undefined) {
                        totalSaved += (saveRes.saved || 0);
                        totalSkipped += (saveRes.skipped || 0);
                    }
                });
            }
        }
    });

    console.log(`Analyzed ${runs.length} runs.`);
    console.log(`Total Saved: ${totalSaved}`);
    console.log(`Total Skipped: ${totalSkipped}`);

    // Also check post_library counts by source_url
    const threadsCount = query("SELECT count(*) as c FROM post_library WHERE source_url LIKE '%threads.com%'")[0].c;
    console.log(`Total Threads posts in post_library: ${threadsCount}`);
}

main().catch(console.error);
