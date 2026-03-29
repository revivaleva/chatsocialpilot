
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    console.log("--- Threads Task Analysis ---");

    // 1. Get Preset Info
    const preset = query("SELECT id, name, description FROM presets WHERE id = 28")[0];
    console.log("Preset:", JSON.stringify(preset, null, 2));

    // 2. Count distinct keywords in tasks
    const keywords = query(`
        SELECT count(DISTINCT json_extract(overrides_json, '$.keyword')) as count
        FROM tasks
        WHERE preset_id = 28
    `)[0];
    console.log("Total Keywords registered:", keywords.count);

    // 3. Status of tasks
    const taskStatus = query(`
        SELECT status, count(*) as count
        FROM tasks
        WHERE preset_id = 28
        GROUP BY status
    `);
    console.log("Task Status Summary:");
    console.table(taskStatus);

    // 4. Analysis of post_library
    // Note: source_url should contain 'threads.net'
    const threadsPosts = query(`
        SELECT count(*) as count 
        FROM post_library 
        WHERE source_url LIKE '%threads.net%'
    `)[0];
    console.log("Total Posts in post_library from threads.net:", threadsPosts.count);

    // 5. Check task_runs for results
    // We look for 'totalSaved' and 'skipped' in result_json or logs
    // result_json might contain the final gatheredVars
    const recentTaskRuns = query(`
        SELECT tr.id, tr.runId, tr.status, tr.result_json, t.overrides_json
        FROM task_runs tr
        JOIN tasks t ON tr.runId = t.runId
        WHERE t.preset_id = 28
        ORDER BY tr.created_at DESC
        LIMIT 20
    `);

    console.log("\n--- Recent Task Runs (Sample) ---");
    recentTaskRuns.forEach((run: any) => {
        let result = {};
        try { result = JSON.parse(run.result_json); } catch (e) { }
        let overrides = {};
        try { overrides = JSON.parse(run.overrides_json); } catch (e) { }

        console.log(`Run: ${run.runId} | Status: ${run.status} | Keyword: ${overrides.keyword || 'N/A'}`);
        // console.log("Result:", result);
    });

    // 6. Aggregate results from task_runs
    const aggResults = query(`
        SELECT 
            COUNT(*) as total_runs,
            SUM(CASE WHEN tr.status = 'completed' THEN 1 ELSE 0 END) as success_runs,
            SUM(CASE WHEN tr.status = 'failed' THEN 1 ELSE 0 END) as failed_runs
        FROM task_runs tr
        JOIN tasks t ON tr.runId = t.runId
        WHERE t.preset_id = 28
    `)[0];
    console.log("\nAggregate Task Runs:", JSON.stringify(aggResults, null, 2));

    // 7. Investigate 'skipped' vs 'saved' in detail from all completed runs
    const allCompletedRuns = query(`
        SELECT tr.result_json
        FROM task_runs tr
        JOIN tasks t ON tr.runId = t.runId
        WHERE t.preset_id = 28 AND tr.status = 'completed'
    `);

    let totalSavedInRuns = 0;
    let totalSkippedInRuns = 0;
    let runCount = 0;

    allCompletedRuns.forEach((run: any) => {
        try {
            const res = JSON.parse(run.result_json);
            // gatheredVars are usually in result_json.gatheredVars
            const gv = res.gatheredVars || {};
            // The logic in taskQueue.ts sets gatheredVars.pr_save_result? No, it looks like it's per iteration.
            // Wait, I need to see if result_json has the summary.
        } catch (e) { }
    });

    // Actually, taskQueue.ts has:
    // iterationResults[innerIdx] = { result: gatheredVars.pr_save_result, ... }
    // I should check run_history for more granular info if task_runs doesn't have it.
}

main().catch(console.error);
