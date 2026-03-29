import { initDb, query } from "../src/drivers/db";

async function main() {
    initDb();

    const BANNED_GROUP_ID = 'g-1765464486487-7758';

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
      OR tr.result_json LIKE '%ロック%'
      OR tr.result_json LIKE '%lock%'
    )
    ORDER BY tr.ended_at ASC
  `, [startAt, endAt]);

    const banAccounts = new Set<string>();
    const logoutOnlyAccounts = new Map<string, any>();
    const alreadyInBannedGroup = new Set<string>();
    const otherFailures = new Map<string, any>();

    for (const run of taskRuns as any[]) {
        // Check current group
        if (run.current_group_id === BANNED_GROUP_ID) {
            alreadyInBannedGroup.add(run.container_id);
            continue;
        }

        let result;
        try {
            result = JSON.parse(run.result_json);
        } catch (e) {
            result = { raw: run.result_json };
        }

        const resultStr = JSON.stringify(result).toLowerCase();

        // Keywords for Ban/Suspension
        const isBan = /ban|suspended|凍結|suspended|verification|suspended/i.test(resultStr);

        // Keywords for Logout
        const isLogout = /logged out|ログアウト|login|ログイン/i.test(resultStr);

        // Keywords for Lock/Challenge
        const isLock = /lock|ロック|challenge|チャレンジ/.test(resultStr);

        const errorMsg = result.error || (result.results && result.results.find((s: any) => s.outcome === 'failed')?.error) || "Unknown error";

        const accountInfo = {
            containerId: run.container_id,
            time: new Date(run.ended_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
            error: errorMsg,
            isBan,
            isLogout,
            isLock
        };

        if (isBan) {
            banAccounts.add(run.container_id);
            // Remove from other categories if it's a ban
            logoutOnlyAccounts.delete(run.container_id);
            otherFailures.delete(run.container_id);
        } else if (isLogout) {
            if (!banAccounts.has(run.container_id)) {
                logoutOnlyAccounts.set(run.container_id, accountInfo);
            }
        } else if (isLock) {
            otherFailures.set(run.container_id, { ...accountInfo, type: 'Locked' });
        } else {
            if (!banAccounts.has(run.container_id) && !logoutOnlyAccounts.has(run.container_id)) {
                otherFailures.set(run.container_id, { ...accountInfo, type: 'Other Failure' });
            }
        }
    }

    console.log(`\n### 3/9 X Post Task Investigation Report ###`);
    console.log(`Total error/warning incidents processed: ${taskRuns.length}`);
    console.log(`Accounts already in Banned group (skipped/ignored): ${alreadyInBannedGroup.size}`);

    console.log(`\n--- 1. Accounts detected as BAN/SUSPENDED (Action: Move to Banned group if not already) ---`);
    console.log(`Count: ${banAccounts.size}`);
    Array.from(banAccounts).forEach(id => console.log(`- ${id}`));

    console.log(`\n--- 2. Accounts detected as LOGOUT ONLY (Action: Register Login Task) ---`);
    console.log(`Count: ${logoutOnlyAccounts.size}`);
    logoutOnlyAccounts.forEach((info, id) => {
        console.log(`- ${id} (${info.time}) : ${info.error}`);
    });

    console.log(`\n--- 3. Other Failures / Locked (Action: Manual Review recommended) ---`);
    console.log(`Count: ${otherFailures.size}`);
    otherFailures.forEach((info, id) => {
        console.log(`- ${id} [${info.type}] (${info.time}) : ${info.error}`);
    });
}

main().catch(console.error);
