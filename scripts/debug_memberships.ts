
import { initDb, query } from "../src/drivers/db";

async function main() {
    initDb();

    console.log("### Investigating container_group_members table content ###");
    const totalCgm = query("SELECT count(*) as count FROM container_group_members", []) as any[];
    console.log(`Total rows in container_group_members: ${totalCgm[0].count}`);

    const sampleCgm = query("SELECT * FROM container_group_members LIMIT 10", []) as any[];
    console.log("Sample rows from container_group_members:");
    console.table(sampleCgm);

    console.log("\n### Investigating group and membership linkage ###");
    const orphans = query(`
        SELECT count(*) as count 
        FROM container_group_members cgm
        LEFT JOIN container_groups cg ON cgm.group_id = cg.id
        WHERE cg.id IS NULL
    `, []) as any[];
    console.log(`Members with non-existent group_id: ${orphans[0].count}`);

    const groupSummary = query(`
        SELECT group_id, count(*) as count 
        FROM container_group_members 
        GROUP BY group_id
    `, []) as any[];

    console.log("\n### Counts by group_id (Raw) ###");
    console.table(groupSummary);

    const groupNames = query("SELECT id, name FROM container_groups", []) as any[];
    console.log("\n### Group ID to Name map ###");
    console.table(groupNames);
}

main().catch(console.error);
