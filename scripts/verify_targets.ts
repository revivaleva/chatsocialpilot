
import { initDb, query } from "../src/drivers/db";

async function main() {
    initDb();

    // 2026-03-10
    const startAt = new Date("2026-03-10T00:00:00+09:00").getTime();

    // Get all containers that were assigned a login task since 3/10
    const allAssigned = query(`
        SELECT DISTINCT container_id FROM tasks 
        WHERE preset_id IN (17, 39, 42) 
        AND created_at >= ?
    `, [startAt]) as any[];

    console.log(`Total containers assigned login tasks since 3/10: ${allAssigned.length}`);

    const results = [];
    for (const row of allAssigned) {
        const runs = query(`
            SELECT status, result_json, ended_at 
            FROM task_runs 
            WHERE task_id IN (SELECT id FROM tasks WHERE container_id = ? AND preset_id IN (17, 39, 42))
            ORDER BY ended_at DESC
        `, [row.container_id]) as any[];

        const bestStatus = runs.some(r => r.status === 'ok' || r.status === 'done') ? 'OK' : 'FAIL';
        let latestError = "";
        if (bestStatus === 'FAIL' && runs.length > 0) {
            try {
                const res = JSON.parse(runs[0].result_json);
                latestError = res.error || res.message || "Unknown error";
            } catch (e) {
                latestError = "Parse error";
            }
        }

        results.push({
            container_id: row.container_id,
            status: bestStatus,
            latestError: latestError,
            isTimeout: latestError.toLowerCase().includes("timeout")
        });
    }

    const succeeded = results.filter(r => r.status === 'OK');
    const timeoutOnly = results.filter(r => r.status === 'FAIL' && r.isTimeout);
    const others = results.filter(r => r.status === 'FAIL' && !r.isTimeout);

    console.log(`\n### Target Analysis ###`);
    console.log(`- Succeeded (OK): ${succeeded.length}`);
    console.log(`- Timeout Only (Treat as Target): ${timeoutOnly.length}`);
    console.log(`- Other Failures: ${others.length}`);

    console.log(`\n### Timeout Only Containers ###`);
    timeoutOnly.forEach(r => console.log(`- ${r.container_id}`));

    console.log(`\n### Other Failure Containers ###`);
    others.forEach(r => console.log(`- ${r.container_id} : ${r.latestError}`));
}

main().catch(console.error);
