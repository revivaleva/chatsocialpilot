import dotenv from 'dotenv';
dotenv.config();

const CB_API_BASE = 'http://127.0.0.1:3002/internal';

async function cbRequest(path: string, method: string = 'GET', body?: any) {
    const url = `${CB_API_BASE}${path}`;
    const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
    });
    return res.json();
}

async function main() {
    const list = await cbRequest('/containers');
    const container = list.containers[0];
    if (!container) return;

    const fields = await cbRequest('/exec', 'POST', {
        contextId: container.id,
        command: 'eval',
        eval: `(() => {
            const items = Array.from(document.querySelectorAll('input, select, textarea, button'));
            return items.map(el => ({
                tag: el.tagName,
                name: el.name,
                id: el.id,
                type: el.type,
                text: el.innerText
            }));
        })()`
    });
    console.log(JSON.stringify(fields.result, null, 2));
}

main().catch(err => console.error(err));
