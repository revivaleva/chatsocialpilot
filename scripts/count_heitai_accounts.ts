
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const groups = query("SELECT id, name FROM container_groups WHERE name LIKE '%X兵隊%'", []);
    for (const group of groups as any[]) {
        const count = query("SELECT COUNT(*) as count FROM container_group_members WHERE group_id = ?", [group.id])[0] as any;
        console.log(`Group: ${group.name} (ID: ${group.id}), Accounts: ${count.count}`);
    }
}

main().catch(console.error);
