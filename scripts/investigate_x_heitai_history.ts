
import { initDb, query } from "../src/drivers/db";

async function main() {
    initDb();

    console.log("### Sample check for x_accounts patterns ###");
    const samples = query(`
        SELECT container_id, x_username, last_group_name
        FROM x_accounts
        LIMIT 20
    `, []) as any[];
    console.table(samples);

    console.log("\n### Counting all accounts that were 'X兵隊' at some point ###");
    // Check for "X兵隊" in last_group_name
    const xHeitaiHistorically = query(`
        SELECT count(*) as count
        FROM x_accounts
        WHERE last_group_name LIKE '%X兵隊%'
    `, []) as any[];
    console.log(`Accounts with last_group_name containing 'X兵隊': ${xHeitaiHistorically[0].count}`);

    // Check currently belonging to a group starting with "X兵隊"
    const xHeitaiCurrently = query(`
        SELECT count(*) as count
        FROM container_group_members cgm
        JOIN container_groups cg ON cgm.group_id = cg.id
        WHERE cg.name LIKE 'X兵隊%'
    `, []) as any[];
    console.log(`Accounts currently in a group named 'X兵隊%': ${xHeitaiCurrently[0].count}`);

    // Check those in 'Banned' but were 'X兵隊'
    const xHeitaiBanned = query(`
        SELECT count(*) as count
        FROM x_accounts xa
        JOIN container_group_members cgm ON xa.container_id = cgm.container_id -- Caution: XID or UUID?
        JOIN container_groups cg ON cgm.group_id = cg.id
        WHERE cg.name = 'Banned' AND xa.last_group_name LIKE '%X兵隊%'
    `, []) as any[];
    // Wait, the join above might fail if container_id formats differ.
}

main().catch(console.error);
