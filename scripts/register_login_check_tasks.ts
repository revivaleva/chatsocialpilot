import { initDb, query, run as dbRun } from '../src/drivers/db.js';
import crypto from 'node:crypto';

function generateRunIdShort() {
    return crypto.randomBytes(4).toString('hex');
}

async function main() {
    initDb();

    // Find "X兵隊" group
    const groupResult = query("SELECT id FROM container_groups WHERE name = 'X兵隊'", []);
    const groupId = groupResult[0].id;

    // Fetch accounts
    const accounts = query(`
        SELECT a.container_id, a.proxy_id 
        FROM container_group_members m
        JOIN x_accounts a ON m.container_id = a.container_id
        WHERE m.group_id = ?
    `, [groupId]);

    console.log(`Registering ${accounts.length} tasks for Preset 200...`);
    const presetId = 200;
    const now = Date.now();
    const targetQueues = ["queue2", "queue3", "queue4", "queue5", "queue6", "queue7", "queue8", "queue9"];

    for (const acc of accounts as any[]) {
        const runId = `run-login-check-${generateRunIdShort()}-${now}`;
        // Proxy-aware queue assignment
        const proxyId = acc.proxy_id || 0;
        const queueName = targetQueues[proxyId % targetQueues.length];

        dbRun(`
            INSERT INTO tasks (
                runId, preset_id, container_id, queue_name, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [runId, presetId, acc.container_id, queueName, 'pending', now, now]);
    }

    console.log(`Successfully registered ${accounts.length} tasks in queues 2-9.`);
}

main().catch(console.error);
