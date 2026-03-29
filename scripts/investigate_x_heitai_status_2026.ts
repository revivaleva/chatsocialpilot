
import { initDb, query } from "../src/drivers/db";

async function main() {
    initDb();

    console.log("### 1. すべてのグループと所属しているアカウント数 ###");
    const groupCounts = query(`
        SELECT cg.name as group_name, COUNT(cgm.container_id) as count
        FROM container_groups cg
        LEFT JOIN container_group_members cgm ON cg.id = cgm.group_id
        GROUP BY cg.id
        HAVING count > 0
        ORDER BY count DESC
    `, []) as any[];
    console.table(groupCounts);

    const xHeitaiGroups = groupCounts.filter(g => g.group_name.includes("X兵隊"));
    const xHeitaiTotal = xHeitaiGroups.reduce((acc, curr) => acc + curr.count, 0);

    console.log(`\n「X兵隊」系グループに現在所属しているアカウント数: ${xHeitaiTotal}`);

    console.log("\n### 2. 「X兵隊」グループ内のアカウントの凍結(suspended)状態の確認 ###");
    // X兵隊グループに所属するコンテナIDをすべて取得
    const xHeitaiContainers = query(`
        SELECT cgm.container_id as uuid, cg.name as group_name
        FROM container_group_members cgm
        JOIN container_groups cg ON cgm.group_id = cg.id
        WHERE cg.name LIKE '%X兵隊%'
    `, []) as any[];

    // 最新のイベントをマッピング
    const latestEvents = query(`
        SELECT container_id as uuid, event_type, created_at
        FROM account_status_events ase
        WHERE created_at = (
            SELECT MAX(created_at)
            FROM account_status_events ase2
            WHERE ase2.container_id = ase.container_id
        )
    `, []) as any[];

    const eventMap = new Map();
    latestEvents.forEach(e => eventMap.set(e.uuid, e.event_type));

    let activeCount = 0;
    let frozenInGroupCount = 0;
    let unknownStatusCount = 0;

    xHeitaiContainers.forEach(c => {
        const lastEvent = eventMap.get(c.uuid);
        if (lastEvent === 'suspended') {
            frozenInGroupCount++;
        } else if (lastEvent) {
            activeCount++;
        } else {
            unknownStatusCount++;
        }
    });

    console.log(`\n[X兵隊グループ内のステータス内訳]`);
    console.log(`- 正常 (最新イベントが suspended 以外): ${activeCount}`);
    console.log(`- 凍結 (最新イベントが suspended): ${frozenInGroupCount}`);
    console.log(`- 不明 (イベント記録なし): ${unknownStatusCount}`);
    console.log(`- 合計: ${xHeitaiContainers.length}`);

    console.log("\n### 結論 ###");
    console.log(`現在、「X兵隊」系グループに所属しており、明示的な凍結イベントがないアカウント数は ${activeCount + unknownStatusCount} です。`);
    console.log(`(うち、確実に稼働実績があり凍結されていないことが確認できるものは ${activeCount} 件、一度もイベントが記録されていないものは ${unknownStatusCount} 件です)`);

}

main().catch(console.error);
