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
    // さきほど成功したコンテナを取得
    const list = await cbRequest('/containers');
    const container = list.containers.find((c: any) => c.name.startsWith('rolex-final-test'));
    if (!container) {
        console.log('Test container not found.');
        return;
    }

    const cid = container.id;
    console.log(`Testing SMS skip in container: ${cid}...`);

    // 1. トップページへ戻る
    console.log('Navigating to top...');
    await cbRequest('/exec', 'POST', { contextId: cid, command: 'navigate', url: 'https://reservation.rolexboutique-lexia.jp/shinjuku/reservation' });
    await new Promise(r => setTimeout(r, 3000));

    // 2. 同意ボタンクリック
    console.log('Clicking agree...');
    await cbRequest('/exec', 'POST', { contextId: cid, command: 'humanClick', selector: '.button01' });
    await new Promise(r => setTimeout(r, 4000));

    // 3. 別の日時を選択（適当に選択）
    console.log('Selecting new slot...');
    await cbRequest('/exec', 'POST', {
        contextId: cid,
        command: 'eval',
        eval: `(async () => {
            const dateSel = document.getElementById('first');
            if (dateSel && dateSel.options.length > 2) {
                dateSel.value = dateSel.options[2].value; // 別の枠
                dateSel.dispatchEvent(new Event('change', { bubbles: true }));
            }
            await new Promise(r => setTimeout(r, 2000));
            const timeSel = document.getElementById('second');
            if (timeSel && timeSel.options.length > 2) {
                timeSel.value = timeSel.options[2].value;
                timeSel.dispatchEvent(new Event('change', { bubbles: true }));
            }
        })()`
    });
    await new Promise(r => setTimeout(r, 2000));
    await cbRequest('/exec', 'POST', { contextId: cid, command: 'eval', eval: `document.querySelector('button[name="register"]')?.click();` });
    await new Promise(r => setTimeout(r, 5000));

    // 4. フォーム入力を再現（前回と同じデータ）
    console.log('Filling form...');
    await cbRequest('/exec', 'POST', {
        contextId: cid,
        command: 'eval',
        eval: `(() => {
            const data = {
                'last_name': '田中', 'first_name': '誠',
                'last_kananame': 'タナカ', 'first_kananame': 'マコト',
                'birthday': '1988-11-20',
                'phone_number': '645934427',
                'phone_country_code': '31',
                'email01': 'gregoryfish1931@puedemail.com', 'email02': 'gregoryfish1931@puedemail.com'
            };
            for (const [name, val] of Object.entries(data)) {
                const el = document.querySelector('[name="' + name + '"]');
                if (el) { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); }
            }
            document.getElementById('check01').checked = true;
            document.getElementById('check02').checked = true;
        })()`
    });

    console.log('\n--- MANUAL CHECK ---');
    console.log('Please check the browser. If reCAPTCHA is solved, click "Input content confirmation" and "Submit".');
    console.log('See if it goes to SMS page or skips to Completion page.');
}

main().catch(err => console.error(err));
