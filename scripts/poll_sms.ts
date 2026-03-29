import dotenv from 'dotenv';
dotenv.config();

const CB_API_BASE = 'http://127.0.0.1:3002/internal';

async function cbRequest(path: string, method: string = 'POST', body?: any) {
    const url = `${CB_API_BASE}${path}`;
    const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
    });
    return res.json();
}

async function main() {
    const cid = '4161759d-ff46-4fed-873d-c9b005b12223';
    const smsCode = '937260';

    console.log(`Entering code ${smsCode} into #onetimePass...`);
    const res = await cbRequest('/exec', 'POST', {
        contextId: cid,
        command: 'eval',
        eval: `(() => {
            const input = document.getElementById('onetimePass') || document.querySelector('[name="onetimePass"]');
            if (input) {
                input.value = "${smsCode}";
                input.dispatchEvent(new Event('input', { bubbles: true }));
                const btn = document.querySelector('button[type="submit"]');
                if (btn) btn.click();
                return "SUCCESS";
            }
            return "ERROR: onetimePass not found";
        })()`
    });
    console.log('Result:', res.result);
}

main().catch(err => console.error(err));
