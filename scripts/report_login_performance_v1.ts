
import { initDb, query } from "../src/drivers/db";

async function main() {
    initDb();

    // 2026-03-09 00:00 JST
    const startAt = new Date("2026-03-09T00:00:00+09:00").getTime();

    const tasks = query(`
        SELECT t.id, t.preset_id, t.container_id, tr.status, tr.result_json, tr.ended_at
        FROM tasks t
        JOIN task_runs tr ON t.id = tr.task_id
        WHERE t.preset_id IN (17, 39, 42)
        AND tr.ended_at >= ?
        ORDER BY tr.ended_at ASC
    `, [startAt]) as any[];

    if (tasks.length === 0) {
        console.log("No login tasks found since 2026-03-09.");
        return;
    }

    const stats = {
        total: tasks.length,
        ok: 0,
        failed: 0,
        reasons: {} as Record<string, number>
    };

    const containerStatusMap = new Map<string, string>();

    for (const t of tasks) {
        if (t.status === 'ok' || t.status === 'done') {
            stats.ok++;
            containerStatusMap.set(t.container_id, 'ok');
        } else {
            stats.failed++;
            containerStatusMap.set(t.container_id, 'failed');

            let reason = "Unknown failure";
            try {
                const res = JSON.parse(t.result_json);
                const error = (res.error || res.message || "").toLowerCase();

                if (error.includes("timeout")) {
                    reason = "Timeout";
                } else if (error.includes("proxy")) {
                    reason = "Proxy Error";
                } else if (error.includes("suspended") || error.includes("ban") || error.includes("凍結")) {
                    reason = "Account Suspended/Banned";
                } else if (error.includes("challenge") || error.includes("verification") || error.includes("ロック") || error.includes("lock")) {
                    reason = "Challenge/Lock Required";
                } else if (error.includes("auth") || error.includes("login fail") || error.includes("password")) {
                    reason = "Auth Failed";
                } else if (res.results) {
                    const failedStep = res.results.find((s: any) => s.outcome === 'failed');
                    if (failedStep) {
                        const stepError = (failedStep.error || "").toLowerCase();
                        if (stepError.includes("suspended") || stepError.includes("ban")) {
                            reason = "Account Suspended/Banned (detected in step)";
                        } else {
                            reason = `Step ${failedStep.stepIndex} failed: ${failedStep.error || "no error msg"}`;
                        }
                    }
                } else if (error) {
                    reason = error;
                }
            } catch (e) {
                reason = "JSON parse error / Raw: " + t.result_json.substring(0, 50);
            }

            stats.reasons[reason] = (stats.reasons[reason] || 0) + 1;
        }
    }

    console.log(`\n### X Login Tasks Report (Since 2026-03-09) ###`);
    console.log(`Total tasks executed: ${stats.total}`);
    console.log(`Success (OK): ${stats.ok} (${((stats.ok / stats.total) * 100).toFixed(1)}%)`);
    console.log(`Failed: ${stats.failed} (${((stats.failed / stats.total) * 100).toFixed(1)}%)`);

    console.log(`\n### Failure Breakdown ###`);
    const sortedReasons = Object.entries(stats.reasons).sort((a, b) => b[1] - a[1]);
    for (const [reason, count] of sortedReasons) {
        console.log(`- ${reason}: ${count}`);
    }

    // Unique container stats
    const uniqueContainers = new Set(tasks.map(t => t.container_id));
    console.log(`\nUnique containers handled: ${uniqueContainers.size}`);

    // We might want to see how many unique containers eventually succeeded
    let eventuallyOk = 0;
    for (const status of containerStatusMap.values()) {
        if (status === 'ok') eventuallyOk++;
    }
    console.log(`Unique containers eventually OK: ${eventuallyOk}`);
    console.log(`Unique containers still Failed: ${uniqueContainers.size - eventuallyOk}`);

}

main().catch(console.error);
