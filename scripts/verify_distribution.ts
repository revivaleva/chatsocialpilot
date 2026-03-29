
import fs from 'node:fs';

const data = JSON.parse(fs.readFileSync('tasks_to_register_heitai.json', 'utf8'));
const counts: Record<string, number> = {};
const presetCounts: Record<string, number> = {};

for (const t of data) {
    counts[t.queueName] = (counts[t.queueName] || 0) + 1;
    presetCounts[t.presetId] = (presetCounts[t.presetId] || 0) + 1;
}

console.log('Queue distribution:');
console.log(JSON.stringify(counts, null, 2));
console.log('Preset distribution:');
console.log(JSON.stringify(presetCounts, null, 2));
