
import { initDb, query } from '../src/drivers/db.js';

async function checkStatus() {
    initDb();
    const gid = '6df1aacd-4623-4908-9e2d-9fa1d9990109';

    const allAccountsInGroup = query('SELECT count(*) as count FROM container_group_members WHERE group_id = ?', [gid]) as any[];
    console.log(`Total accounts in group ${gid}: ${allAccountsInGroup[0].count}`);

    const accounts = query('SELECT x_username as name, container_id, auth_token, ct0 FROM x_accounts WHERE container_id IN (SELECT container_id FROM container_group_members WHERE group_id = ?)', [gid]) as any[];
    console.log(`Accounts in x_accounts table for this group: ${accounts.length}`);

    const recovered = accounts.filter(a => a.auth_token && a.ct0);
    console.log(`Successfully recovered (has token & ct0): ${recovered.length}`);
    console.log(`Pending recovery: ${accounts.length - recovered.length}`);
}

checkStatus().catch(console.error);
