
import mysql from 'mysql2/promise';
import {
    createContainer,
    closeContainer,
} from '../src/drivers/browser.js';
import { query } from '../src/drivers/db.js';
import * as fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const mysqlConfig = {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'kameleo',
};

const REPORT_FILE = 'notes/profile_creation_report.json';

async function main() {
    const connection = await mysql.createConnection(mysqlConfig);
    console.log('Connected to MySQL.');

    try {
        // テスト用：ID #77 を取得
        const [accounts]: any = await connection.execute(
            'SELECT * FROM accounts WHERE id = 77 LIMIT 1'
        );

        if (accounts.length === 0) {
            console.error('Account ID 77 not found in MySQL.');
            return;
        }

        const acc = accounts[0];
        const xid = acc.account_id;

        console.log(`Processing report for: ${xid}`);

        // 1. SQLite から認証情報を補完
        // SQLite の初期化
        const { initDb } = await import('../src/drivers/db.js');
        await initDb();

        const sqliteRows: any = await query(`SELECT * FROM x_accounts WHERE container_id = ? OR email LIKE ? LIMIT 1`, [xid, `%${xid}%`]);
        const sqliteAcc = sqliteRows && sqliteRows.length > 0 ? sqliteRows[0] : null;

        const authToken = acc.auth_token || sqliteAcc?.auth_token;
        const ct0 = acc.ct0 || sqliteAcc?.ct0;

        console.log(`  Auth Tokens found in SQLite: ${!!sqliteAcc?.auth_token}`);

        // 2. プロファイル作成 (Windows/Chrome指定)
        console.log(`  Creating profile with Windows/Chrome...`);
        let proxyObj = undefined;
        if (acc.proxy && acc.proxy.includes(':')) {
            const pts = acc.proxy.split(':');
            proxyObj = { server: `${pts[0]}:${pts[1]}`, username: pts[2] || "", password: pts[3] || "" };
        }

        // 強制的に新規作成するため、一度消してから作る（または名前で再取得）
        // ここでは browser.ts の createContainer が既存を返す仕様を利用
        const createRes = await createContainer({
            name: xid,
            proxy: proxyObj,
            storage: 'cloud',
            device: 'desktop',
            os: 'windows',
            browser: 'chrome'
        });

        if (!createRes.ok) throw new Error(`Failed to create container: ${createRes.message}`);

        const report = {
            mysql_id: acc.id,
            xid: xid,
            container_id: createRes.containerId,
            platform: {
                os: 'windows',
                browser: 'chrome',
                device: 'desktop'
            },
            auth_data: {
                has_auth_token: !!authToken,
                has_ct0: !!ct0,
                source: acc.auth_token ? 'MySQL' : (sqliteAcc?.auth_token ? 'SQLite' : 'None')
            },
            proxy: acc.proxy,
            created_at: new Date().toISOString()
        };

        fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
        console.log(`Report saved to ${REPORT_FILE}`);
        console.log('--- PROFILE CREATION SUCCESSFUL ---');
        console.table(report);

    } finally {
        await connection.end();
    }
}

main().catch(console.error);
