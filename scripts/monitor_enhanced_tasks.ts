
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    // 1. 最近実行中または完了した、強化設定（repeat_count=300）のタスクを特定
    const latestRuns = query(`
        SELECT tr.runId, tr.status, tr.id as run_id_num, t.overrides_json, tr.started_at, tr.ended_at
        FROM task_runs tr
        JOIN tasks t ON tr.runId = t.runId
        WHERE t.preset_id = 28 
          AND json_extract(t.overrides_json, '$.repeat_count') = 300
        ORDER BY tr.id DESC
        LIMIT 10
    `);

    if (latestRuns.length === 0) {
        console.log("No enhanced tasks (repeat_count=300) found in task_runs yet.");

        // 進行中のタスクを確認
        const pendingCount = query("SELECT count(*) as c FROM tasks WHERE preset_id = 28 AND status = 'pending'")[0].c;
        const runningCount = query("SELECT count(*) as c FROM tasks WHERE preset_id = 28 AND status = 'running'")[0].c;
        console.log(`Tasks for Preset 28: Pending=${pendingCount}, Running=${runningCount}`);
        return;
    }

    console.log(`Analyzing ${latestRuns.length} recent enhanced runs...`);

    // 2. 各実行の進捗（保存数・スキップ数）をログまたはresult_jsonから解析
    latestRuns.forEach((run: any) => {
        const overrides = JSON.parse(run.overrides_json || '{}');
        console.log(`\nRun: ${run.runId} status: ${run.status}`);
        console.log(`Keyword: ${overrides.keyword}`);

        // もし完了(ok)していればresult_jsonから集計
        if (run.status === 'ok') {
            const tr_full = query("SELECT result_json FROM task_runs WHERE id = ?", [run.run_id_num])[0];
            const res = JSON.parse(tr_full.result_json || '{}');
            let saved = 0;
            let skipped = 0;

            if (res.steps && res.steps[1] && res.steps[1].result && res.steps[1].result.iterations) {
                res.steps[1].result.iterations.forEach((iter: any) => {
                    const saveRes = iter[1]?.result;
                    if (saveRes) {
                        saved += (saveRes.saved || 0);
                        skipped += (saveRes.skipped || 0);
                    }
                });
            }
            console.log(`Results: Saved=${saved}, Skipped=${skipped}`);
        } else if (run.status === 'running') {
            console.log("Task is currently running. Real-time stats depend on app logs.");
        }
    });
}

main().catch(console.error);
