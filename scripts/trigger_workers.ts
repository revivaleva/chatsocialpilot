
import { startWorker, ALL_QUEUE_NAMES } from '../src/services/taskQueue.js';

async function main() {
    console.log('Triggering all workers...');
    for (const queueName of ALL_QUEUE_NAMES) {
        console.log(`Starting worker for ${queueName}...`);
        startWorker(queueName).catch(err => {
            console.error(`Failed to start worker for ${queueName}:`, err);
        });
    }
    console.log('All workers triggered.');
    // Let it run for a bit to make sure they start
    await new Promise(r => setTimeout(r, 2000));
}

main().catch(console.error);
