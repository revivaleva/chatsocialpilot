
import { initDb, query } from "../src/drivers/db";

async function main() {
    initDb();

    console.log("### Searching for all groups containing 'X兵隊' ###");
    const groups = query(`SELECT id, name FROM container_groups WHERE name LIKE '%X兵隊%'`, []) as any[];
    console.table(groups);

    console.log("\n### Counting members in each 'X兵隊' group ###");
    const memberCounts = query(`
        SELECT cg.name, count(cgm.container_id) as member_count
        FROM container_groups cg
        LEFT JOIN container_group_members cgm ON cg.id = cgm.group_id
        WHERE cg.name LIKE '%X兵隊%'
        GROUP BY cg.name
    `, []) as any[];
    console.table(memberCounts);

    const totalMembers = memberCounts.reduce((acc, curr) => acc + curr.member_count, 0);
    console.log(`\nTotal members in all 'X兵隊' groups: ${totalMembers}`);

    // Peek at some members to see their container_ids
    console.log("\n### Sample members from these groups ###");
    const samples = query(`
        SELECT cg.name as group_name, cgm.container_id
        FROM container_group_members cgm
        JOIN container_groups cg ON cgm.group_id = cg.id
        WHERE cg.name LIKE '%X兵隊%'
        LIMIT 20
    `, []) as any[];
    console.table(samples);
}

main().catch(console.error);
