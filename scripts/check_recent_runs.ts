
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    const containerId = 'loureiroalbuquerqueqd556';

    console.log(`Checking task runs for container: ${containerId}`);

    const runs = query(`
        SELECT r.id, r.runId, r.task_id, r.status, r.started_at, r.ended_at, r.result_json, t.overrides_json
        FROM task_runs r
        JOIN tasks t ON r.task_id = t.id
        WHERE t.container_id = ?
        ORDER BY r.started_at DESC
        LIMIT 10
    `, [containerId]);

    console.log('Recent Runs:');
    console.table(runs.map((r: any) => {
        let summary = 'N/A';
        try {
            const res = JSON.parse(r.result_json);
            if (res.body) {
                summary = `Saved: ${res.body.totalSaved}, Iter: ${res.body.completed}/${res.body.count}`;
            }
        } catch (e) { }

        return {
            id: r.id,
            taskId: r.task_id,
            status: r.status,
            started: r.started_at ? new Date(r.started_at).toLocaleString() : 'N/A',
            duration: r.ended_at && r.started_at ? ((r.ended_at - r.started_at) / 1000).toFixed(1) + 's' : 'N/A',
            summary,
            overrides: r.overrides_json
        };
    }));

    for (const run of runs as any[]) {
        if (run.status === 'ok' || run.status === 'failed' || run.status === 'waiting_success') {
            console.log(`\nRun Details for ${run.id} (${run.runId}):`);
            if (run.result_json) {
                try {
                    const result = JSON.parse(run.result_json);
                    if (result.steps && result.steps.length > 0) {
                        const lastStep = result.steps[result.steps.length - 1];
                        console.log(`Last step: ${lastStep.step.type} - Result: ${JSON.stringify(lastStep.result).substring(0, 200)}`);
                    }
                    if (result.error) {
                        console.log(`Error in log: ${result.error}`);
                    }
                    if (result.body) {
                        console.log(`Body: ${JSON.stringify(result.body)}`);
                    }
                } catch (e) {
                    console.log(`Raw Result snippet: ${run.result_json.substring(0, 200)}`);
                }
            }
        }
    }
}

main().catch(console.error);
