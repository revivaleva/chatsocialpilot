
import { initDb, query, run } from "../src/drivers/db";
import crypto from "node:crypto";

async function main() {
    initDb();

    // 1. "X兵隊" グループを探す。なければ作成する。
    let group = (query("SELECT id FROM container_groups WHERE name = 'X兵隊' LIMIT 1") as any[])[0];
    let groupId: string;

    if (group) {
        groupId = group.id;
        console.log(`Found existing 'X兵隊' group with ID: ${groupId}`);
    } else {
        groupId = crypto.randomUUID();
        const now = Date.now();
        run("INSERT INTO container_groups (id, name, description, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            [groupId, "X兵隊", "直近で復旧させたアカウント群", "#00ff00", now, now]);
        console.log(`Created new 'X兵隊' group with ID: ${groupId}`);
    }

    // 2. 直近でログイン復旧に成功した259件を特定する
    const startAt = new Date("2026-03-10T00:00:00+09:00").getTime();
    const recoveredRows = query(`
        SELECT DISTINCT t.container_id 
        FROM tasks t
        JOIN task_runs tr ON t.id = tr.task_id
        WHERE t.preset_id IN (17, 39, 42)
        AND tr.ended_at >= ?
        AND tr.status IN ('ok', 'done')
    `, [startAt]) as any[];

    console.log(`Identified ${recoveredRows.length} recovered containers.`);

    // 3. グループに所属させる（既存の所属があれば更新、なければ追加）
    let updatedCount = 0;
    let insertedCount = 0;

    for (const row of recoveredRows) {
        const containerId = row.container_id;
        const now = Date.now();

        // UUID形式への変換が必要なケースがあるか確認（x_accountsはXID、cgmはUUIDのルールがあるが、現状cgmにXIDを入れている場所もある）
        // ルール3: container_id は XID (文字列) と UUID が混在している。

        const existing = (query("SELECT id FROM container_group_members WHERE container_id = ? LIMIT 1", [containerId]) as any[])[0];

        if (existing) {
            run("UPDATE container_group_members SET group_id = ?, updated_at = ? WHERE container_id = ?", [groupId, now, containerId]);
            updatedCount++;
        } else {
            run("INSERT INTO container_group_members (container_id, group_id, created_at, updated_at) VALUES (?, ?, ?, ?)", [containerId, groupId, now, now]);
            insertedCount++;
        }
    }

    console.log(`Group Assignment Task Completed.`);
    console.log(`- Updated membership: ${updatedCount}`);
    console.log(`- Inserted new membership: ${insertedCount}`);
    console.log(`Total active members in 'X兵隊' group: ${updatedCount + insertedCount}`);
}

main().catch(console.error);
