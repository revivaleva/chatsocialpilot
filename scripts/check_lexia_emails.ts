import { createRequire } from "module";
import dotenv from 'dotenv';
import { initDb, query } from '../src/drivers/db.js';

const require = createRequire(import.meta.url);
const Imap = require('imap');
dotenv.config();

/**
 * 以前テストで使用したメールアドレス gregoryfish1931@puedemail.com に対して
 * Rolex予約システムからのメール（特に内容）を確認する
 */
async function main() {
    initDb();

    const email = 'gregoryfish1931@puedemail.com';
    const res = query('SELECT email, email_password FROM x_accounts WHERE email = ?', [email]);
    if (!res || res.length === 0) {
        console.error(`Account ${email} not found in database.`);
        return;
    }

    const { email_password } = res[0];
    const password = email_password.split(':')[1];

    console.log(`Checking email body for ${email}...`);

    const imap = new Imap({
        user: email,
        password: password,
        host: 'imap.firstmail.ltd',
        port: 993,
        tls: true,
        tlsOptions: { rejectUnauthorized: false }
    });

    function openInbox(cb: any) {
        imap.openBox('INBOX', true, cb);
    }

    imap.once('ready', () => {
        openInbox((err: any, box: any) => {
            if (err) throw err;

            // 最新のレキシアからのメールを検索
            imap.search([['FROM', 'shinjuku@reservation.rolexboutique-lexia.jp']], (err: any, results: any) => {
                if (err) throw err;
                if (!results || results.length === 0) {
                    console.log('No Lexia emails found.');
                    imap.end();
                    return;
                }

                console.log(`Found ${results.length} Lexia emails. Fetching the latest one...`);
                // 最新のものを取得 (resultsの最後)
                const latestUid = results[results.length - 1];
                const f = imap.fetch(latestUid, { bodies: '' });

                f.on('message', (msg: any) => {
                    msg.on('body', (stream: any) => {
                        let buffer = '';
                        stream.on('data', (chunk: any) => { buffer += chunk.toString('utf8'); });
                        stream.once('end', () => {
                            console.log('\n--- EMAIL BODY START ---');
                            console.log(buffer);
                            console.log('--- EMAIL BODY END ---\n');
                        });
                    });
                });

                f.once('end', () => {
                    imap.end();
                });
            });
        });
    });

    imap.once('error', (err: any) => { console.error('IMAP Error:', err); });
    imap.once('end', () => { console.log('Connection ended.'); });

    imap.connect();
}

main().catch(err => console.error('Main Error:', err));
