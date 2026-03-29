import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    console.log('\nListing all container groups...');
    const allGroups: any[] = query('SELECT * FROM container_groups', []);

    for (const group of allGroups) {
        const countRows: any = query('SELECT COUNT(*) as count FROM container_group_members WHERE group_id = ?', [group.id]);
        const count = countRows[0]?.count || 0;
        console.log(`Group: ${group.name} (${group.id}), Member Count: ${count}`);

        if (group.name.includes('スレッズ') || group.name.toLowerCase().includes('threads')) {
            const members: any[] = query('SELECT * FROM container_group_members WHERE group_id = ?', [group.id]);
            console.log(`  Members of ${group.name}:`);
            for (const m of members) {
                // Try both container_id and name mapping if needed, but x_accounts uses container_id
                const accounts: any[] = query('SELECT x.container_id, x.proxy_id, p.proxy_info FROM x_accounts x LEFT JOIN proxies p ON x.proxy_id = p.id WHERE x.container_id = ?', [m.container_id]);
                const acc = accounts[0];
                if (acc) {
                    console.log(`    - Container: ${acc.container_id}, ProxyID: ${acc.proxy_id}, Proxy: ${acc.proxy_info}`);
                } else {
                    console.log(`    - Container ${m.container_id} NOT found in x_accounts table.`);
                }
            }
        }
    }
}

main().catch(console.error);
