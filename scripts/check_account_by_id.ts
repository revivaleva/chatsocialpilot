import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    const identifiers = [
        'loureiroalbuquerqueqd556',
        '6cb7bb29-0d43-4d3e-8575-a4aee3313d5e'
    ];

    for (const id of identifiers) {
        console.log(`\nChecking identifier: ${id}`);
        const accounts = query('SELECT * FROM x_accounts WHERE container_id = ?', [id]);
        console.log('x_accounts results:', accounts.length);
        if (accounts.length > 0) {
            console.log('Account Details:', accounts.map(a => ({ container_id: a.container_id, proxy_id: a.proxy_id, email: a.email })));
        }
    }
}

main().catch(console.error);
