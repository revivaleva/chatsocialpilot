
import mysql from 'mysql2/promise';
import {
    evalInContext,
    execInContainer,
    createContainer,
    closeContainer,
    setNativeCookies,
    solveArkose,
    humanClickInContext
} from '../src/drivers/browser.js';
import { fetchVerificationCode } from '../src/services/emailFetcher.js';
import * as fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const mysqlConfig = {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'kameleo',
};

const PROGRESS_LOG = 'notes/recovery_progress_v5.log';
const SUCCESS_LIST = 'notes/heitai_success_v5.txt';

function logProgress(msg: string) {
    const timestamp = new Date().toLocaleString('ja-JP');
    const line = `[${timestamp}] ${msg}\n`;
    fs.appendFileSync(PROGRESS_LOG, line);
    console.log(msg);
}

function markSuccess(xid: string) {
    fs.appendFileSync(SUCCESS_LIST, xid + '\n');
}

function isAlreadySuccess(xid: string) {
    if (!fs.existsSync(SUCCESS_LIST)) return false;
    const content = fs.readFileSync(SUCCESS_LIST, 'utf8');
    return content.includes(xid);
}

async function updateMySQLStatus(id: number, data: { status: string; profile_id?: string; auth_token?: string; ct0?: string }) {
    logProgress(`Updating MySQL status for ID ${id} to ${data.status}...`);
    const connection = await mysql.createConnection(mysqlConfig);
    try {
        const sets: string[] = [`status = '${data.status}'`];
        if (data.profile_id) sets.push(`profile_id = '${data.profile_id}'`);
        if (data.auth_token) sets.push(`auth_token = '${data.auth_token}'`);
        if (data.ct0) sets.push(`ct0 = '${data.ct0}'`);

        const sql = `UPDATE accounts SET ${sets.join(', ')}, updated_at = NOW() WHERE id = ${id}`;
        await connection.execute(sql);
        logProgress(`  Successfully updated MySQL.`);
    } catch (e: any) {
        logProgress(`  [ERROR] Failed to update MySQL: ${e.message}`);
    } finally {
        await connection.end();
    }
}

async function main() {
    if (!fs.existsSync('notes')) fs.mkdirSync('notes');
    if (!fs.existsSync(PROGRESS_LOG)) fs.writeFileSync(PROGRESS_LOG, `--- Recovery Session V5.1 (Full Lifecycle) Start: ${new Date().toLocaleString()} ---\n`);

    const connection = await mysql.createConnection(mysqlConfig);
    logProgress('Connected to MySQL.');

    // SQLite の初期化
    const { initDb, query } = await import('../src/drivers/db.js');
    await initDb();

    try {
        // テスト用：ID #77 を優先的に取得
        const [accounts]: any = await connection.execute(
            'SELECT * FROM accounts WHERE id = 77 LIMIT 1'
        );

        logProgress(`Target accounts from MySQL: ${accounts.length}`);

        for (const acc of accounts) {
            const xid = acc.account_id;
            const dbId = acc.id;
            let cid = acc.profile_id;
            let finished = false;

            logProgress(`Processing account: ${xid} (MySQL ID: ${dbId})`);

            try {

                // 1. プロファイル管理
                if (!cid) {
                    logProgress(`  Profile not found. Creating new Kameleo profile...`);
                    let proxyObj = undefined;
                    if (acc.proxy && acc.proxy.includes(':')) {
                        const pts = acc.proxy.split(':');
                        proxyObj = { server: `${pts[0]}:${pts[1]}`, username: pts[2] || "", password: pts[3] || "" };
                    }
                    const createRes = await createContainer({ name: xid, proxy: proxyObj, storage: 'cloud' });
                    if (!createRes.ok) throw new Error(`Failed to create container: ${createRes.message}`);
                    cid = createRes.containerId;
                    await connection.execute('UPDATE accounts SET profile_id = ? WHERE id = ?', [cid, dbId]);
                    logProgress(`  Profile created and saved: ${cid}`);
                } else {
                    logProgress(`  Existing Profile ID: ${cid}. Ensuring closed then opening...`);
                    await closeContainer({ id: cid }).catch(() => { }); // 念のためクローズ
                    await new Promise(r => setTimeout(r, 2000));
                    const openRes = await createContainer({ name: xid, storage: 'cloud' });
                    if (!openRes.ok) {
                        logProgress(`  [WARNING] Initial open failed, retrying once...`);
                        await new Promise(r => setTimeout(r, 5000));
                        await createContainer({ name: xid, storage: 'cloud' });
                    }
                }

                // 2. 原生クッキー注入 (MySQLから一元取得)
                const authToken = acc.auth_token;
                const ct0 = acc.ct0;

                if (authToken) {
                    logProgress(`  Injecting cookies via Native Layer (Cloudflare Bypass Mode)...`);
                    const cookies = [
                        { url: 'https://x.com', name: 'auth_token', value: authToken, domain: '.x.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' },
                        { url: 'https://x.com', name: 'ct0', value: ct0 || 'dummy', domain: '.x.com', path: '/', secure: true, sameSite: 'Lax' }
                    ];
                    await setNativeCookies(cid, cookies);
                } else {
                    logProgress(`  No cookies found anywhere. Will attempt manual/automated login.`);
                }

                // 3. Navigation
                logProgress(`  Navigating to x.com/home...`);
                await execInContainer(cid, 'navigate', { url: 'https://x.com/home' });
                await new Promise(r => setTimeout(r, 12000));

                // 4. Action Loop (Verification & Login)
                let attempt = 0;
                while (attempt < 15 && !finished) {
                    attempt++;
                    const statusRes = await evalInContext(cid, `(function() {
                        const url = window.location.href;
                        const text = document.body.innerText;
                        const title = document.title;
                        const html = document.documentElement.outerHTML;

                        if (url.includes('/home') || document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]')) return 'home';
                        if (text.includes('セキュリティ検証') || text.includes('しばらくお待ちください') || html.includes('cf-turnstile') || html.includes('cloudflare')) return 'cloudflare_gate';
                        if (text.includes('Arkose') || document.querySelector('iframe[src*="arkoselabs"]')) return 'arkose';
                        if (text.includes('Verify email') || text.includes('認証コード') || text.includes('Confirm your email') || text.includes('メールを送信しました')) return 'email_verify';
                        if (url.includes('/login') || text.includes('Sign in') || text.includes('ログイン')) return 'login_form';
                        if (text.includes('Account unlocked') || text.includes('Continue to X') || text.includes('Xへ移動')) return 'unlocked';
                        if (text.includes('Suspended') || text.includes('凍結')) return 'suspended';
                        return 'waiting_or_unknown';
                    })()`, { screenshot: true });

                    const status = statusRes.ok ? statusRes.result : 'error';
                    if (!statusRes.ok) {
                        logProgress(`  [ERROR] Status check failed: ${statusRes.errorDetail?.message || statusRes.error}`);
                        if (statusRes.screenshotPath) logProgress(`  Screenshot saved: ${statusRes.screenshotPath}`);
                    }
                    logProgress(`  Status (Attempt ${attempt}): ${status}`);

                    if (status === 'home') {
                        logProgress(`  SUCCESS: ${xid} is active.`);
                        // クッキー回収と同期
                        logProgress(`  Capturing cookies for future bypass...`);
                        const cookRes = await execInContainer(cid, 'eval', { eval: '1' }, { returnCookies: true });
                        const at = cookRes.ok && cookRes.cookies ? cookRes.cookies.find((c: any) => c.name === 'auth_token')?.value : undefined;
                        const ct = cookRes.ok && cookRes.cookies ? cookRes.cookies.find((c: any) => c.name === 'ct0')?.value : undefined;

                        await updateMySQLStatus(dbId, {
                            status: 'active',
                            profile_id: cid,
                            auth_token: at,
                            ct0: ct
                        });

                        markSuccess(xid);
                        await closeContainer({ id: cid });
                        finished = true;
                    } else if (status === 'cloudflare_gate') {
                        logProgress(`  Cloudflare detected. Waiting for auto-pass or attempting click...`);
                        await humanClickInContext(cid, 'iframe, body');
                        await new Promise(r => setTimeout(r, 15000));
                    } else if (status === 'arkose') {
                        logProgress(`  Arkose detected. Triggering solver...`);
                        await solveArkose(cid);
                        await new Promise(r => setTimeout(r, 15000));
                    } else if (status === 'email_verify') {
                        logProgress(`  Email verification flow...`);
                        // Check if we need to click "Send"
                        const sendClick = await evalInContext(cid, `(function() {
                            const btn = Array.from(document.querySelectorAll('div[role="button"], span')).find(b => b.innerText.includes('Send') || b.innerText.includes('送信'));
                            if (btn) { btn.click(); return true; }
                            return false;
                        })()`);
                        if (sendClick.result) await new Promise(r => setTimeout(r, 15000));

                        const emailPass = acc.mail_pass.includes(':') ? acc.mail_pass.split(':')[1] : acc.mail_pass;
                        const emailRes = await fetchVerificationCode({ email: acc.mail, email_password: emailPass, timeout_seconds: 90 });
                        if (emailRes.ok && emailRes.code) {
                            logProgress(`  Code received: ${emailRes.code}. Inputting...`);
                            await evalInContext(cid, `(function() {
                                const inp = document.querySelector('input[name="token"]') || document.querySelector('input[placeholder*="code"]');
                                if (inp) {
                                    inp.value = '${emailRes.code}';
                                    inp.dispatchEvent(new Event('input', { bubbles: true }));
                                    setTimeout(() => {
                                        const next = Array.from(document.querySelectorAll('div[role="button"], span')).find(s => s.innerText.includes('Next') || s.innerText.includes('次へ') || s.innerText.includes('Verify'));
                                        if (next) next.click();
                                    }, 800);
                                    return true;
                                }
                                return false;
                            })()`);
                            await new Promise(r => setTimeout(r, 10000));
                        }
                    } else if (status === 'login_form') {
                        logProgress(`  Entering ID: ${xid}...`);
                        await evalInContext(cid, `(function() {
                            const inp = document.querySelector('input[name="text"]');
                            if (inp) {
                                inp.value = '${xid}';
                                inp.dispatchEvent(new Event('input', { bubbles: true }));
                                setTimeout(() => {
                                    const next = Array.from(document.querySelectorAll('span')).find(s => s.innerText.includes('Next') || s.innerText.includes('次へ'));
                                    if (next) next.click();
                                }, 800);
                                return true;
                            }
                            return false;
                        })()`);
                        await new Promise(r => setTimeout(r, 5000));
                        // 次にパスワード入力
                        await evalInContext(cid, `(function() {
                            const pwd = document.querySelector('input[name="password"]');
                            if (pwd) {
                                pwd.value = '${acc.password}';
                                pwd.dispatchEvent(new Event('input', { bubbles: true }));
                                setTimeout(() => {
                                    const login = Array.from(document.querySelectorAll('div[role="button"], span')).find(s => s.innerText.includes('Log in') || s.innerText.includes('ログイン'));
                                    if (login) login.click();
                                }, 800);
                                return true;
                            }
                            return false;
                        })()`);
                        await new Promise(r => setTimeout(r, 10000));
                    } else if (status === 'unlocked') {
                        logProgress(`  Clicking 'Continue to X'...`);
                        await evalInContext(cid, `(function() {
                            const btn = Array.from(document.querySelectorAll('div[role="button"], span')).find(el => el.innerText.includes('Continue') || el.innerText.includes('Xへ移動'));
                            if (btn) btn.click();
                        })()`);
                        await new Promise(r => setTimeout(r, 8000));
                    } else {
                        logProgress(`  Current loop state: ${status}. Waiting...`);
                        await new Promise(r => setTimeout(r, 8000));
                    }
                }

                if (!finished) {
                    logProgress(`  Finishing account ${xid} with failure status.`);
                    await updateMySQLStatus(dbId, {
                        status: 'login_failed',
                        profile_id: cid
                    });
                }

            } catch (err: any) {
                logProgress(`  [CRITICAL ERROR] ${acc.account_id}: ${err.message}`);
                await updateMySQLStatus(dbId, {
                    status: 'ERROR',
                    profile_id: cid
                });
            }
        }

    } finally {
        await connection.end();
        logProgress('Session finished.');
    }
}

main().catch(console.error);
