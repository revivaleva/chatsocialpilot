import dotenv from 'dotenv';
import fs from 'fs';
import { initDb, query } from '../src/drivers/db.js';

dotenv.config();

const CB_API_BASE = 'http://127.0.0.1:3002/internal';
const FIVESIM_API_KEY = process.env.FIVESIM_API_KEY;

async function cbRequest(path: string, method: string = 'GET', body?: any) {
    const url = `${CB_API_BASE}${path}`;
    const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
    });
    return res.json();
}

async function fivesimRequest(path: string, method: string = 'GET', body?: any) {
    const url = `https://5sim.net/v1${path}`;
    const res = await fetch(url, {
        method,
        headers: { 'Authorization': `Bearer ${FIVESIM_API_KEY}`, 'Accept': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    if (text === 'no free phones') return { error: 'no free phones' };
    try { return JSON.parse(text); } catch (e) { return { error: 'Not JSON', detail: text }; }
}

async function main() {
    initDb();

    // 1. DBからメールアドレスとパスワードを取得
    const accounts = query('SELECT email, x_password FROM x_accounts WHERE email IS NOT NULL LIMIT 1');
    if (!accounts.length) {
        console.error('No accounts found in DB');
        return;
    }
    const targetAccount = accounts[0];
    console.log(`Using account: ${targetAccount.email}`);

    const name = `rolex-final-test-${Date.now()}`;
    console.log(`[CB] Creating container: ${name}...`);
    const createRes = await cbRequest('/containers/create', 'POST', { name });
    const cid = createRes.container.id;

    console.log(`[CB] Step 1: Navigating and clicking Agree...`);
    await cbRequest('/exec', 'POST', { contextId: cid, command: 'navigate', url: 'https://reservation.rolexboutique-lexia.jp/shinjuku/reservation' });
    await cbRequest('/exec', 'POST', { contextId: cid, command: 'humanClick', selector: '.button01' });
    await new Promise(r => setTimeout(r, 4000));

    console.log(`[CB] Step 2: Selecting Date/Time...`);
    await cbRequest('/exec', 'POST', {
        contextId: cid,
        command: 'eval',
        eval: `(async () => {
            const dateSel = document.getElementById('first');
            if (dateSel && dateSel.options.length > 1) {
                dateSel.value = dateSel.options[1].value;
                dateSel.dispatchEvent(new Event('change', { bubbles: true }));
            }
            await new Promise(r => setTimeout(r, 2000));
            const timeSel = document.getElementById('second');
            if (timeSel && timeSel.options.length > 1) {
                timeSel.value = timeSel.options[1].value;
                timeSel.dispatchEvent(new Event('change', { bubbles: true }));
            }
        })()`
    });
    await new Promise(r => setTimeout(r, 2000));
    await cbRequest('/exec', 'POST', { contextId: cid, command: 'eval', eval: `document.querySelector('button[name="register"]')?.click();` });
    await new Promise(r => setTimeout(r, 6000));

    // Acquire NL number
    console.log(`[5SIM] Requesting Netherlands number for 'other'...`);
    const buyRes = await fivesimRequest('/user/buy/activation/netherlands/any/other');
    if (buyRes.error) {
        console.log(`[5SIM] Netherlands failed: ${buyRes.error}`);
        return;
    }
    const phoneFull = buyRes.phone;
    const orderId = buyRes.id;
    const localNumber = phoneFull.replace("+31", "");
    console.log(`[5SIM] Got number: ${phoneFull} (Order: ${orderId})`);

    console.log(`[CB] Step 3: Filling Form...`);
    await cbRequest('/exec', 'POST', {
        contextId: cid,
        command: 'eval',
        eval: `(() => {
            const data = {
                'last_name': '田中',
                'first_name': '誠',
                'last_kananame': 'タナカ',
                'first_kananame': 'マコト',
                'birthday': '1988-11-20',
                'phone_number': '${localNumber}',
                'phone_country_code': '31',
                'email01': '${targetAccount.email}',
                'email02': '${targetAccount.email}'
            };
            for (const [name, val] of Object.entries(data)) {
                const el = document.querySelector('[name="' + name + '"]');
                if (el) { 
                    el.value = val; 
                    el.dispatchEvent(new Event('input', { bubbles: true })); 
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
            
            // Set country flag for UI
            const telInput = document.querySelector('#phone_number');
            const iti = window.intlTelInputGlobals?.getInstance(telInput);
            if (iti) { iti.setCountry('nl'); }

            const c1 = document.getElementById('check01'); if(c1) c1.checked = true;
            const c2 = document.getElementById('check02'); if(c2) c2.checked = true;
        })()`
    });

    console.log('\n================================================================');
    console.log('USER ACTION REQUIRED:');
    console.log('1. Go to the browser window named: ' + name);
    console.log('2. Resolve the reCAPTCHA manually.');
    console.log('3. Click the "Input content confirmation" (入力内容確認) button.');
    console.log('4. Click the "Submit with this content" (この内容で送信する) button on the next page.');
    console.log('================================================================\n');

    console.log(`[CB] Waiting for SMS verification page to appear...`);

    let isSmsPage = false;
    const waitStart = Date.now();
    while (Date.now() - waitStart < 300000) { // 5 minutes
        const status = await cbRequest('/exec', 'POST', {
            contextId: cid,
            command: 'eval',
            eval: `document.querySelector('[name="certification_code"]') !== null`
        });
        if (status.result) {
            isSmsPage = true;
            console.log(`\n[CB] SMS Verification page reached! Polling for SMS code...`);
            break;
        }
        process.stdout.write('.');
        await new Promise(r => setTimeout(r, 5000));
    }

    if (isSmsPage) {
        let smsCode = null;
        const pollStart = Date.now();
        while (Date.now() - pollStart < 180000) {
            const check = await fivesimRequest(`/user/check/${orderId}`);
            if (check.sms && check.sms.length > 0) {
                smsCode = check.sms[0].code;
                console.log(`\n[5SIM] Got SMS code: ${smsCode}`);
                break;
            }
            if (check.status === 'CANCELED' || check.status === 'FINISHED') break;
            process.stdout.write('*');
            await new Promise(r => setTimeout(r, 6000));
        }

        if (smsCode) {
            console.log(`[CB] Entering SMS code: ${smsCode}...`);
            await cbRequest('/exec', 'POST', {
                contextId: cid,
                command: 'eval',
                eval: `const el = document.querySelector('[name="certification_code"]'); if(el) { el.value = "${smsCode}"; el.dispatchEvent(new Event('input', { bubbles: true })); }`
            });
            console.log('SUCCESS: SMS code entered. You can now manually submit to finish reservation.');
        } else {
            console.log('\n[5SIM] SMS timed out.');
        }
    } else {
        console.log('\n[CB] Timeout waiting for SMS page.');
    }
}

main().catch(err => console.error(err));
