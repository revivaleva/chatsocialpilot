
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    // Find "X兵隊" group
    const groups = query("SELECT id, name FROM container_groups WHERE name = 'X兵隊'", []);
    console.log('X兵隊 group info:');
    console.log(JSON.stringify(groups, null, 2));

    if (groups.length > 0) {
        const groupId = groups[0].id;
        // Check schema of container_group_members
        const schema = query("PRAGMA table_info(container_group_members)", []);
        console.log('container_group_members schema:');
        console.log(JSON.stringify(schema, null, 2));

        // Count members
        const count = query("SELECT COUNT(*) as count FROM container_group_members WHERE group_id = ?", [groupId]);
        console.log(`Member count for group ${groupId}:`, count[0].count);

        // Sample members from x_accounts joined
        const members = query(`
            SELECT a.container_id, a.screen_name, a.status 
            FROM container_group_members m
            JOIN x_accounts a ON m.container_id = a.container_id
            WHERE m.group_id = ?
            LIMIT 5
        `, [groupId]);
        console.log('Sample members:');
        console.log(JSON.stringify(members, null, 2));
    }
}

main().catch(console.error);
