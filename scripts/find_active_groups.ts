
import { initDb, query } from "../src/drivers/db";

async function main() {
    initDb();

    console.log("### Listing groups and member counts FROM ALL GROUPS ###");
    const allGroups = query(`
        SELECT cg.name, count(cgm.container_id) as count
        FROM container_groups cg
        LEFT JOIN container_group_members cgm ON cg.id = cgm.group_id
        GROUP BY cg.name
    `, []) as any[];
    console.table(allGroups);

    console.log("\n### Looking for ANY group with members ###");
    const activeGroups = allGroups.filter(g => g.count > 0);
    console.table(activeGroups);
}

main().catch(console.error);
