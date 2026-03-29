
import { initDb, query } from '../src/drivers/db.js';
import { createContainer } from '../src/drivers/browser.js';
import fs from 'node:fs';
import path from 'node:path';

async function main() {
    initDb();

    const logsDir = path.resolve('logs');
    const files = fs.readdirSync(logsDir).filter(f => f.startsWith('run-login-check-') && f.endsWith('.json'));

    const targetRunIds: { runId: string; containerName: string }[] = [];

    // UUID (per-run) vs Container Name (static)
    // We want to open containers by their NAME (XID)

    for (const file of files) {
        try {
            const runId = file.replace('.json', '');
            const content = JSON.parse(fs.readFileSync(path.join(logsDir, file), 'utf8'));
            const evalStep = content.steps.find((s: any) => s.step.type === 'eval');

            if (evalStep && evalStep.result && evalStep.result.body && evalStep.result.body.result) {
                if (evalStep.result.body.result.status === 'locked') {
                    // Find the original container_id from the tasks table for this runId
                    const taskRows = query("SELECT container_id FROM tasks WHERE runId = ?", [runId]) as any[];
                    if (taskRows.length > 0) {
                        targetRunIds.push({ runId, containerName: taskRows[0].container_id });
                    }
                }
            }
        } catch (e) { }
        if (targetRunIds.length >= 30) break;
    }

    console.log(`Opening ${targetRunIds.length} locked accounts...`);

    const results = [];
    for (const item of targetRunIds) {
        try {
            const xid = item.containerName;
            // Get proxy info from DB for this account
            const accRows = query("SELECT proxy_id FROM x_accounts WHERE container_id = ?", [xid]) as any[];
            let proxyOpts = undefined;
            if (accRows.length > 0 && accRows[0].proxy_id) {
                const proxyRows = query("SELECT proxy_info FROM proxies WHERE id = ?", [accRows[0].proxy_id]) as any[];
                if (proxyRows.length > 0) {
                    const parts = proxyRows[0].proxy_info.split(':');
                    if (parts.length >= 2) {
                        proxyOpts = {
                            server: `http://${parts[0]}:${parts[1]}`,
                            username: parts[2] || undefined,
                            password: parts[3] || undefined
                        };
                    }
                }
            }

            console.log(`Opening container ${xid}...`);
            const res = await createContainer({
                name: xid,
                proxy: proxyOpts
            });
            results.push({ xid, ok: res.ok, message: res.message });
        } catch (e: any) {
            console.error(`Failed to open ${item.containerName}:`, e.message);
            results.push({ xid: item.containerName, ok: false, error: e.message });
        }
    }

    console.log('\n--- Opened Containers Summary ---');
    results.forEach((r: any) => {
        console.log(`${r.xid}: ${r.ok ? 'SUCCESS' : 'FAILED (' + (r.error || r.message || 'Unknown error') + ')'}`);
    });
}

main().catch(console.error);
