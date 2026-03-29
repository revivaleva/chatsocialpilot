
import { initDb, query } from "../src/drivers/db";

async function main() {
    initDb();

    // 2026-03-09 00:00 JST
    const startAt = new Date("2026-03-09T00:00:00+09:00").getTime();

    // 1. Get containers that succeeded
    const succeededRows = query(`
        SELECT DISTINCT t.container_id
        FROM tasks t
        JOIN task_runs tr ON t.id = tr.task_id
        WHERE t.preset_id IN (17, 39, 42)
        AND tr.ended_at >= ?
        AND tr.status IN ('ok', 'done')
    `, [startAt]) as any[];
    const succeededContainers = new Set(succeededRows.map(r => r.container_id));

    // 2. Get containers that failed but might be "effectively logged in" (Timeout)
    const failedRows = query(`
        SELECT t.container_id, tr.result_json, tr.status
        FROM tasks t
        JOIN task_runs tr ON t.id = tr.task_id
        WHERE t.preset_id IN (17, 39, 42)
        AND tr.ended_at >= ?
        AND tr.status NOT IN ('ok', 'done')
    `, [startAt]) as any[];

    const timeoutContainers = new Set<string>();
    const otherFailedContainers = new Set<string>();

    for (const row of failedRows) {
        if (succeededContainers.has(row.container_id)) continue;

        let isTimeout = false;
        try {
            const res = JSON.parse(row.result_json);
            const error = (res.error || res.message || "").toLowerCase();
            if (error.includes("timeout")) {
                isTimeout = true;
            } else if (res.results) {
                const failedStep = res.results.find((s: any) => s.outcome === 'failed');
                if (failedStep && (failedStep.error || "").toLowerCase().includes("timeout")) {
                    isTimeout = true;
                }
            }
        } catch (e) { }

        if (isTimeout) {
            timeoutContainers.add(row.container_id);
        } else {
            otherFailedContainers.add(row.container_id);
        }
    }

    // Clean up: if a container is in timeout AND other failed, and never succeeded
    // we should check if it's "still failed" without success.
    // Actually, timeoutContainers already excludes succeeded ones.

    console.log(`\n### X Post Task Target Planning ###`);
    console.log(`1. Successfully logged in: ${succeededContainers.size}`);
    console.log(`2. Failed with Timeout (never succeeded): ${timeoutContainers.size}`);
    console.log(`   Total targets: ${succeededContainers.size + timeoutContainers.size}`);

    console.log(`\n3. Truly failed (never succeeded, not timeout): ${otherFailedContainers.size}`);
    for (const id of otherFailedContainers) {
        if (!timeoutContainers.has(id)) {
            console.log(`   - ${id} (Need Manual Check)`);
        }
    }

    // Identify X Post Preset
    const xPostPresets = query(`SELECT id, name FROM presets WHERE name LIKE '%投稿%' OR name LIKE '%Post%'`, []);
    console.log(`\n### Available X Post Presets ###`);
    console.table(xPostPresets);
}

main().catch(console.error);
