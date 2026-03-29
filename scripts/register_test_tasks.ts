
import { initDb } from '../src/drivers/db.js';
import { enqueueTask } from '../src/services/taskQueue.js';

async function main() {
    initDb();

    const testData = [
        { presetId: 601, containerId: 'AnthonyHal56094', queueName: 'queue2' },
        { presetId: 602, containerId: 'ruth63377557155', queueName: 'queue2' },
        { presetId: 603, containerId: 'DonaldRobi54643', queueName: 'queue2' },
        { presetId: 604, containerId: 'susan0995270400', queueName: 'queue2' }
    ];

    for (const t of testData) {
        const runId = enqueueTask({
            presetId: t.presetId,
            containerId: t.containerId,
            overrides: {}
        }, t.queueName);
        console.log("Registered test task: " + runId + " (Preset " + t.presetId + ", Container " + t.containerId + ", Queue " + t.queueName + ")");
    }
}

main().catch(console.error);
