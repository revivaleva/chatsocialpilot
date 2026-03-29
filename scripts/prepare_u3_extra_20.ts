
import { initDb, query } from '../src/drivers/db.js';
import fs from 'fs';

async function main() {
    initDb();

    // X兵隊グループから20アカウント選ぶ
    // なるべく前回の U3 (605) に使われていないもの
    const groupId = '6df1aacd-4623-4908-9e2d-9fa1d9990109';
    const u3Used = query("SELECT DISTINCT container_id FROM tasks WHERE preset_id = 605");
    const usedIds = u3Used.map(u => u.container_id);

    const members = query("SELECT container_id FROM container_group_members WHERE group_id = ?", [groupId]);
    const available = members.filter(m => !usedIds.includes(m.container_id)).slice(0, 20);

    if (available.length < 20) {
        // 足りない場合は、全体から適当に選ぶ（重複を許容するか、あるいは古い順）
        const extra = members.filter(m => usedIds.includes(m.container_id)).slice(0, 20 - available.length);
        available.push(...extra);
    }

    // プロキシ情報取得（分散のため）
    const placeholders = available.map(() => "?").join(",");
    const accounts = query("SELECT container_id, proxy_id FROM x_accounts WHERE container_id IN (" + placeholders + ")", available.map(a => a.container_id));

    const queueIds = [2, 3, 4, 5, 6, 7, 8, 9];
    let qIdx = 0;

    const tasks = accounts.map(a => ({
        presetId: 605,
        containerId: a.container_id,
        queueName: "queue" + queueIds[qIdx++ % queueIds.length]
    }));

    fs.writeFileSync('tasks_u3_extra_20.json', JSON.stringify(tasks, null, 2));
    console.log("Prepared " + tasks.length + " extra tasks for U3 in tasks_u3_extra_20.json");
}

main().catch(console.error);
