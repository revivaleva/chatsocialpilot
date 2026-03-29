
import { initDb, query } from '../src/drivers/db.js';
import fs from 'node:fs';
import path from 'node:path';

async function main() {
    initDb();

    const logsDir = path.resolve('logs');
    const files = fs.readdirSync(logsDir).filter(f => f.startsWith('run-login-check-') && f.endsWith('.json'));

    console.log(`Processing ${files.length} results...`);

    // UUID -> XID map
    const accountMap: Record<string, string> = {};
    const accounts = query("SELECT container_id, x_username FROM x_accounts", []);
    for (const acc of accounts as any[]) {
        accountMap[acc.container_id] = acc.x_username || acc.container_id;
    }

    const results: Record<string, any[]> = {
        'locked': [],
        'suspended': [],
        'logged_out': [],
        'active': [],
        'unknown': []
    };

    for (const file of files) {
        try {
            const content = JSON.parse(fs.readFileSync(path.join(logsDir, file), 'utf8'));
            const containerId = content.containerId;
            const xid = accountMap[containerId] || containerId;

            // Look for the eval step result
            const evalStep = content.steps.find((s: any) => s.step.type === 'eval');
            if (evalStep && evalStep.result && evalStep.result.body && evalStep.result.body.result) {
                const status = evalStep.result.body.result.status;
                const reason = evalStep.result.body.result.reason;
                results[status] = results[status] || [];
                results[status].push({ xid, reason });
            }
        } catch (e) {
            console.error(`Error processing ${file}:`, e);
        }
    }

    console.log('\n--- Login Status Summary ---');
    for (const [status, list] of Object.entries(results)) {
        console.log(`${status.toUpperCase()}: ${list.length}`);
    }

    if (results['locked'].length > 0) {
        console.log('\n--- Locked Accounts (Recaptcha required) ---');
        results['locked'].forEach(a => console.log(`- ${a.xid}: ${a.reason}`));
    }
}

main().catch(console.error);
