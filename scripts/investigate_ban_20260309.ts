import { initDb, query } from "../src/drivers/db";

async function main() {
    initDb();

    // 2026-03-09 JST
    const startAt = new Date("2026-03-09T00:00:00+09:00").getTime();
    const endAt = new Date("2026-03-09T23:59:59+09:00").getTime();

    console.log(`Investigating range: ${new Date(startAt).toISOString()} to ${new Date(endAt).toISOString()}`);

    const banRuns = query(`
    SELECT tr.id, tr.runId, tr.started_at, tr.ended_at, tr.status, tr.result_json, t.container_id
    FROM task_runs tr
    JOIN tasks t ON tr.runId = t.runId
    WHERE tr.ended_at >= ? AND tr.ended_at <= ?
    AND (
      tr.status = 'failed' 
      OR tr.result_json LIKE '%ban%' 
      OR tr.result_json LIKE '%suspended%'
      OR tr.result_json LIKE '%凍結%'
      OR tr.result_json LIKE '%logged out%'
      OR tr.result_json LIKE '%ログアウト%'
    )
    ORDER BY tr.ended_at ASC
  `, [startAt, endAt]);

    console.log(`Found ${banRuns.length} potential ban/logout incidents on 3/9.`);

    for (const run of banRuns as any[]) {
        let result;
        try {
            result = JSON.parse(run.result_json);
        } catch (e) {
            result = run.result_json;
        }

        console.log(`\n--- [${run.status}] Container: ${run.container_id} (RunID: ${run.runId}) ---`);
        console.log(`Time: ${new Date(run.ended_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);

        // Check for specific keywords in result or errors
        const resultStr = JSON.stringify(result);
        const isBan = /ban|suspended|凍結/i.test(resultStr);
        const isLogout = /logged out|ログアウト|login|ログイン/i.test(resultStr);

        if (isBan) {
            console.log("Detected: [BAN/SUSPENDED]");
        }
        if (isLogout) {
            console.log("Detected: [LOGOUT]");
        }

        // Try to find the error message
        if (result && result.error) {
            console.log("Error:", result.error);
        } else if (result && result.results) {
            const failedStep = result.results.find((s: any) => s.outcome === 'failed');
            if (failedStep) {
                console.log(`Failed at step ${failedStep.stepIndex} (${failedStep.capability})`);
                console.log(`Error:`, failedStep.error || (failedStep.result && failedStep.result.body && failedStep.result.body.result && failedStep.result.body.result.error));
            }
        }
    }
}

main().catch(console.error);
