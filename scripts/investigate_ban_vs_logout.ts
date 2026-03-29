import { initDb, query } from "../src/drivers/db";

async function main() {
    initDb();

    // Find the 'Ban' group ID
    const groups = query(`SELECT id, name FROM container_groups WHERE name LIKE '%Ban%' OR name LIKE '%凍結%'`, []);
    console.log("Groups matching 'Ban':", groups);

    const banGroupIds = groups.map((g: any) => g.id);

    // 2026-03-09 JST
    const startAt = new Date("2026-03-09T00:00:00+09:00").getTime();
    const endAt = new Date("2026-03-09T23:59:59+09:00").getTime();

    console.log(`Investigating range: ${new Date(startAt).toISOString()} to ${new Date(endAt).toISOString()}`);

    const taskRuns = query(`
    SELECT tr.id, tr.runId, tr.ended_at, tr.status, tr.result_json, t.container_id,
           (SELECT group_id FROM container_group_members WHERE container_id = t.container_id) as current_group_id
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

    const results = {
        alreadyInBanGroup: [] as string[],
        logoutOnly: [] as any[], // Accounts that had logout but not necessarily ban
        undetermined: [] as any[],
    };

    for (const run of taskRuns as any[]) {
        // If already in a ban group, skip
        if (run.current_group_id && banGroupIds.includes(run.current_group_id)) {
            if (!results.alreadyInBanGroup.includes(run.container_id)) {
                results.alreadyInBanGroup.push(run.container_id);
            }
            continue;
        }

        let result;
        try {
            result = JSON.parse(run.result_json);
        } catch (e) {
            result = { raw: run.result_json };
        }

        const resultStr = JSON.stringify(result).toLowerCase();
        const isBan = /ban|suspended|凍結|suspended|verification/.test(resultStr);
        const isLogout = /logged out|ログアウト|login|ログイン/.test(resultStr);

        const errorInfo = result.error || "";
        let failedStepInfo = "";
        if (result.results) {
            const failedStep = result.results.find((s: any) => s.outcome === 'failed');
            if (failedStep) {
                failedStepInfo = `Step ${failedStep.stepIndex} (${failedStep.capability}): ${failedStep.error || JSON.stringify(failedStep.result)}`;
            }
        }

        const info = {
            container_id: run.container_id,
            runId: run.runId,
            time: new Date(run.ended_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
            isBan,
            isLogout,
            errorInfo,
            failedStepInfo
        };

        if (isLogout && !isBan) {
            results.logoutOnly.push(info);
        } else {
            results.undetermined.push(info);
        }
    }

    console.log(`\n### Summary of 3/9 investigation ###`);
    console.log(`Total incidents found: ${taskRuns.length}`);
    console.log(`Accounts already in Ban group: ${results.alreadyInBanGroup.length}`);
    console.log(`Accounts with Logout detected but NOT marked as Ban: ${results.logoutOnly.length}`);
    console.log(`Other (potential bans or unclear): ${results.undetermined.length}`);

    console.log(`\n### Logout Only (Candidate for login task) ###`);
    results.logoutOnly.forEach(a => {
        console.log(`- ${a.container_id} (${a.time})`);
        if (a.failedStepInfo) console.log(`  Reason: ${a.failedStepInfo}`);
    });

    console.log(`\n### Other/Potential Bans (Needs verification) ###`);
    results.undetermined.forEach(a => {
        console.log(`- ${a.container_id} (${a.time}) - Ban:${a.isBan} Logout:${a.isLogout}`);
        if (a.failedStepInfo) console.log(`  Reason: ${a.failedStepInfo}`);
    });
}

main().catch(console.error);
