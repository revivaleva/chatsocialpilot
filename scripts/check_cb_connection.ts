
import net from 'node:net';
import { loadSettings } from '../src/services/appSettings.js';

async function main() {
    const cfg = loadSettings();
    const host = cfg.containerBrowserHost || '127.0.0.1';
    const port = Number(cfg.containerBrowserPort || 3001);

    console.log(`Checking connection to Container Browser at ${host}:${port}...`);

    const canConnect = await new Promise<boolean>((resolve) => {
        const sock = net.createConnection({ host, port }, () => {
            sock.end();
            resolve(true);
        });
        sock.on('error', (err) => {
            console.error('Connection error:', err.message);
            resolve(false);
        });
        sock.setTimeout(5000, () => {
            console.error('Connection timeout');
            sock.destroy();
            resolve(false);
        });
    });

    console.log(`Connection test result: ${canConnect ? 'SUCCESS' : 'FAILURE'}`);
}

main().catch(console.error);
