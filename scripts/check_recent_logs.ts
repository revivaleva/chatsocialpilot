
import fs from 'node:fs';
import path from 'node:path';

async function main() {
    const logsDir = path.resolve('logs');
    if (!fs.existsSync(logsDir)) {
        console.log('Logs directory not found');
        return;
    }
    const files = fs.readdirSync(logsDir)
        .map(f => ({ name: f, time: fs.statSync(path.join(logsDir, f)).mtimeMs }))
        .sort((a, b) => b.time - a.time)
        .slice(0, 20);

    console.log('Recent Log Files:');
    for (const f of files) {
        console.log(`${f.name} (Modified: ${new Date(f.time).toISOString()})`);
    }
}

main().catch(console.error);
