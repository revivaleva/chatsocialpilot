
import { initDb, query } from "../src/drivers/db";

async function main() {
    initDb();

    // 1. Get ALL accounts from x_accounts
    const allAccounts = query(`
        SELECT container_id, x_username
        FROM x_accounts
    `, []) as any[];

    console.log(`Total accounts in x_accounts: ${allAccounts.length}`);

    // No Group accounts from targeted list (roughly)
    const targets = query(`
        SELECT DISTINCT container_id FROM tasks 
        WHERE preset_id IN (17, 39, 42) 
        AND created_at >= ?
    `, [new Date("2026-03-10T00:00:00+09:00").getTime()]) as any[];

    const targetIds = new Set(targets.map((t: any) => t.container_id));

    let countInXSoldierNames = 0;
    const sampleInXSoldierNames = [];

    for (const id of targetIds) {
        if (id.includes("X兵隊") || id.toLowerCase().includes("soldier")) {
            countInXSoldierNames++;
            sampleInXSoldierNames.push(id);
        }
    }

    console.log(`Target IDs containing 'X兵隊': ${countInXSoldierNames}`);
    if (sampleInXSoldierNames.length > 0) {
        console.log("Samples:", sampleInXSoldierNames.slice(0, 10));
    }

    // Check if these accounts are in No Group explicitly
    const hasMembership = query(`
        SELECT count(*) as count 
        FROM container_group_members 
        WHERE container_id IN (${Array.from(targetIds).map(() => "?").join(",")})
    `, Array.from(targetIds)) as any[];

    console.log(`Target accounts with ANY group membership: ${hasMembership[0].count} / ${targetIds.size}`);

    // Let's assume the user considers these 260 accounts as "X Soldier Accounts" (likely the ones recovered recently)
    // Actually, maybe the user wants to target EVERYTHING EXCEPT Banned?
    const nonBanned = query(`
        SELECT count(*) as count 
        FROM x_accounts xa
        LEFT JOIN container_group_members cgm ON xa.container_id = cgm.container_id
        LEFT JOIN container_groups cg ON cgm.group_id = cg.id
        WHERE cg.name IS NULL OR cg.name != 'Banned'
    `, []) as any[];
    console.log(`\nTotal Non-Banned Accounts: ${nonBanned[0].count}`);
}

main().catch(console.error);
