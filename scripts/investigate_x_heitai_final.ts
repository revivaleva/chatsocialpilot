
import { initDb, query } from "../src/drivers/db";

async function main() {
    initDb();

    console.log("### Searching for all 'X兵隊' accounts and their status ###");

    // 1. Get all accounts currently in a group named 'X兵隊%'
    const xHeitaiCurrentlyCount = query(`
        SELECT count(*) as count
        FROM container_group_members cgm
        JOIN container_groups cg ON cgm.group_id = cg.id
        WHERE cg.name LIKE 'X兵隊%'
    `, []) as any[];
    console.log(`\n1. 現在 'X兵隊%' グループに所属しているアカウント数: ${xHeitaiCurrentlyCount[0].count}`);

    // 2. These 256 accounts status from account_status_events
    const xHeitaiStatusBreakdown = query(`
        SELECT ase.event_type, count(DISTINCT cgm.container_id) as count
        FROM container_group_members cgm
        JOIN container_groups cg ON cgm.group_id = cg.id
        LEFT JOIN account_status_events ase ON cgm.container_id = ase.container_id
        WHERE cg.name LIKE 'X兵隊%'
        GROUP BY ase.event_type
    `, []) as any[];
    console.log(`\n2. 'X兵隊%' グループ所属アカウントのイベント内訳:`);
    console.table(xHeitaiStatusBreakdown);

    // 3. Are there any accounts NOT in any group but look like X Soldier?
    // Let's count total accounts in x_accounts
    const totalAccounts = query(`SELECT count(*) as count FROM x_accounts`, []) as any[];
    console.log(`\n3. x_accounts テーブルの総アカウント数: ${totalAccounts[0].count}`);

    const groupedAccountsCount = query(`SELECT count(DISTINCT container_id) as count FROM container_group_members`, []) as any[];
    console.log(`   うち、いずれかのグループに所属している数: ${groupedAccountsCount[0].count}`);

    // 4. Counts for 'Banned' group
    const bannedCount = query(`
        SELECT count(*) as count
        FROM container_group_members cgm
        JOIN container_groups cg ON cgm.group_id = cg.id
        WHERE cg.name = 'Banned'
    `, []) as any[];
    console.log(`\n4. 'Banned' グループの所属数: ${bannedCount[0].count}`);

    // 5. Total unique accounts with 'suspended' event
    const totalSuspendedEver = query(`
        SELECT count(DISTINCT container_id) as count
        FROM account_status_events
        WHERE event_type = 'suspended'
    `, []) as any[];
    console.log(`\n5. 過去に一度でも 'suspended' (凍結) イベントが記録されたアカウント数: ${totalSuspendedEver[0].count}`);

    // 6. Final verification of active accounts
    const activeEver = query(`
        SELECT count(DISTINCT container_id) as count
        FROM account_status_events
        WHERE event_type = 'active'
    `, []) as any[];
    console.log(`\n6. 'active' イベントが記録されたことがあるアカウント数: ${activeEver[0].count}`);
}

main().catch(console.error);
