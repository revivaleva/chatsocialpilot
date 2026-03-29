
import { initDb, query } from "../src/drivers/db";

async function main() {
    initDb();

    console.log("### Detail of the 256 accounts in 'X兵隊' group ###");
    // cg.name is EXACTLY 'X兵隊' for these 256 (from previous run)
    const membersDetail = query(`
        SELECT xa.container_id, xa.x_username, xa.follower_count, cg.name as group_name
        FROM container_group_members cgm
        JOIN container_groups cg ON cgm.group_id = cg.id
        LEFT JOIN x_accounts xa ON cgm.container_id = xa.container_id -- Warning: Join on UUID?
        WHERE cg.name = 'X兵隊'
        LIMIT 20
    `, []) as any[];
    console.table(membersDetail);

    // If join failed because of UUID/XID, try to resolve UUIDs
    const sampleUuid = query(`SELECT container_id FROM container_group_members cgm JOIN container_groups cg ON cgm.group_id = cg.id WHERE cg.name = 'X兵隊' LIMIT 1`, []) as any[];
    console.log("Sample UUID from group member:", sampleUuid[0]?.container_id);

    // Resolve sample UUID if possible
}

main().catch(console.error);
