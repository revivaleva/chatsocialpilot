
import { setExecutionEnabled, ALL_QUEUE_NAMES } from '../src/services/taskQueue.js';

async function main() {
    console.log('Enabling execution for all queues...');
    for (const queueName of ALL_QUEUE_NAMES) {
        console.log(`Enabling execution for ${queueName}...`);
        setExecutionEnabled(true, queueName);
    }
    console.log('All execution enabled.');
}

main().catch(console.error);
