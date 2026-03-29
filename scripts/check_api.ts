import dotenv from 'dotenv';
dotenv.config();

const CB_API_BASE = 'http://127.0.0.1:3002/internal';

async function main() {
    try {
        const res = await fetch(`${CB_API_BASE}/containers`);
        const j = await res.json();
        console.log('API is alive. Containers:', j.containers.length);
    } catch (e) {
        console.error('API is dead or unreachable:', e.message);
    }
}
main();
