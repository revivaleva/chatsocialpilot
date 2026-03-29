
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    // Check proxies table
    const proxyTable = query("PRAGMA table_info(proxies)", []);
    console.log('proxies table info:');
    console.log(JSON.stringify(proxyTable, null, 2));

    const proxySample = query("SELECT * FROM proxies WHERE id IN (SELECT proxy_id FROM x_accounts LIMIT 5)", []);
    console.log('Sample Proxies:');
    console.log(JSON.stringify(proxySample, null, 2));

    // Check x_accounts sample for email password
    const accountSample = query("SELECT email, email_password FROM x_accounts LIMIT 5", []);
    console.log('Sample Accounts (Email/Pass):');
    console.log(JSON.stringify(accountSample, null, 2));
}

main().catch(console.error);
