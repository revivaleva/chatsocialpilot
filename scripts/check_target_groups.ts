
import { initDb, query } from "../src/drivers/db";

async function main() {
    initDb();

    // 2026-03-10
    const startAt = new Date("2026-03-10T00:00:00+09:00").getTime();
    const containers = query(`
        SELECT DISTINCT container_id FROM tasks 
        WHERE preset_id IN (17, 39, 42) 
        AND created_at >= ?
    `, [startAt]) as any[];

    const groupCounts: Record<string, number> = {};
    for (const c of containers) {
        const group = query(`
            SELECT g.name FROM container_groups g
            JOIN container_group_members m ON g.id = m.group_id
            WHERE m.container_id = ?
        `, [c.container_id]) as any[];

        const groupName = group.length > 0 ? group[0].name : "No Group";
        groupCounts[groupName] = (groupCounts[groupName] || 0) + 1;
    }

    console.log(`Current group distribution of targeted 260 accounts:`);
    console.table(groupCounts);
}

main().catch(console.error);
