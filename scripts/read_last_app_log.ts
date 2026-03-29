
import fs from 'node:fs';
import path from 'node:path';

async function main() {
    const logPath = path.resolve('logs', 'app-20260322.log');
    if (!fs.existsSync(logPath)) {
        console.log('Log file not found');
        return;
    }
    const stats = fs.statSync(logPath);
    const size = stats.size;
    const bufferSize = Math.min(size, 100000); // Read last 100KB
    const buffer = Buffer.alloc(bufferSize);
    const fd = fs.openSync(logPath, 'r');
    fs.readSync(fd, buffer, 0, bufferSize, size - bufferSize);
    fs.closeSync(fd);

    console.log(buffer.toString('utf8').split('\n').slice(-100).join('\n'));
}

main().catch(console.error);
