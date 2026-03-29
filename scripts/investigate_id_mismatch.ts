
import { initDb, query } from "../src/drivers/db";

async function main() {
    initDb();

    console.log("### Searching for all containers with 'X兵隊' in their container_id ###");
    const likeCid = query(`SELECT container_id, x_username FROM x_accounts WHERE container_id LIKE '%X兵隊%'`, []) as any[];
    console.table(likeCid);

    console.log("\n### Searching for all containers where group name is 'X兵隊' but membership uses x_accounts' container_id as container_name ###");
    // This is a shot in the dark, but maybe members table uses UUID but we are looking for XID?
    // Let's list groups starting with 'X兵隊' and their member count again but check if membership table has items.

    const membershipCount = query("SELECT count(*) as count FROM container_group_members", []) as any[];
    console.log(`Total membership rows: ${membershipCount[0].count}`);

    const xids = query("SELECT container_id FROM x_accounts LIMIT 5", []) as any[];
    console.log("XID examples from x_accounts:", xids.map(x => x.container_id));

    const uuids = query("SELECT container_id FROM container_group_members LIMIT 5", []) as any[];
    console.log("IDs from membership table:", uuids.map(u => u.container_id));

    // Check if any XID exists in membership table
    const xidInMembership = query(`
        SELECT count(*) as count 
        FROM x_accounts xa
        JOIN container_group_members cgm ON xa.container_id = cgm.container_id
    `, []) as any[];
    console.log(`Common IDs between x_accounts and membership: ${xidInMembership[0].count}`);

    if (xidInMembership[0].count > 0) {
        const samples = query(`
            SELECT xa.container_id, cg.name
            FROM x_accounts xa
            JOIN container_group_members cgm ON xa.container_id = cgm.container_id
            JOIN container_groups cg ON cgm.group_id = cg.id
            LIMIT 10
        `, []) as any[];
        console.log("Samples of joined data:");
        console.table(samples);
    }
}

main().catch(console.error);
