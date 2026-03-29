
import { initDb, run as dbRun, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    const presetId = 200;
    const name = 'Login Status Check (X兵隊)';
    const description = 'X兵隊のアカウントのログイン状態を詳細にチェックするためのプリセットです。';

    // Steps for checking the status
    const steps = [
        {
            type: 'navigate',
            name: 'ホームページにアクセス',
            url: 'https://x.com/home',
            postWaitSeconds: 15,
            options: { timeoutMs: 60000 }
        },
        {
            type: 'eval',
            name: '詳細ステータスチェック',
            code: `(function() {
                const url = window.location.href;
                const html = document.documentElement.outerHTML || '';
                const title = document.title || '';
                
                if (url.includes('/account/access')) {
                    return { ok: true, status: 'locked', reason: 'Recaptcha/Verification required', url };
                }
                if (html.includes('Your account is suspended')) {
                    return { ok: true, status: 'suspended', reason: 'Account suspended', url };
                }
                if (url.includes('/i/flow/login') || url.includes('/login')) {
                    return { ok: true, status: 'logged_out', reason: 'Cookies expired / Login required', url };
                }
                if (url.includes('/home')) {
                    return { ok: true, status: 'active', reason: 'Logged in successfully', url };
                }
                
                return { ok: true, status: 'unknown', reason: 'Unknown state: ' + title, url };
            })()`
        }
    ];

    const stepsJson = JSON.stringify(steps);
    const now = Date.now();

    // Upsert preset
    const existing = query("SELECT id FROM presets WHERE id = ?", [presetId]);
    if (existing.length > 0) {
        dbRun("UPDATE presets SET name = ?, description = ?, steps_json = ?, updated_at = ? WHERE id = ?",
            [name, description, stepsJson, now, presetId]);
        console.log(`Updated Preset ${presetId}`);
    } else {
        dbRun("INSERT INTO presets (id, name, description, steps_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            [presetId, name, description, stepsJson, now, now]);
        console.log(`Created Preset ${presetId}`);
    }
}

main().catch(console.error);
