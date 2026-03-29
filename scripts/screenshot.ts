import dotenv from 'dotenv';
dotenv.config();

const CB_API_BASE = 'http://127.0.0.1:3002/internal';

async function main() {
    const listRes = await fetch(`${CB_API_BASE}/containers`);
    const list = await listRes.json();
    const container = list.containers.find((c: any) => c.name.startsWith('rolex-final-test'));
    if (!container) {
        console.log('Container not found');
        return;
    }
    const cid = container.id;
    const res = await fetch(`${CB_API_BASE}/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contextId: cid, command: 'status', options: { screenshot: true } })
    });
    const j = await res.json();
    console.log(JSON.stringify(j, null, 2));
}
main();
