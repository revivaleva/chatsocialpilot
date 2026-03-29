
import { initDb, query } from "../src/drivers/db";
import { enqueueTask } from "../src/services/taskQueue";
import fs from "node:fs";

async function main() {
    initDb();

    const PRESET_ID = 40;
    const QUEUE_NAME = "default";

    // 1. 指定された除外リスト (container_id または x_username)
    const excludeList = [
        "an_cosme_beauty", "miyu_biyou", "iroyuru_", "kui_nyan_", "miyu_bgnr",
        "hana_beatbabe", "rin_g_bx", "nemu_bloom", "hinata_w_cosme", "n7_cos",
        "c1115Sarah", "rutho0vazy0", "donna2010ir2lzv", "momoka_coswalk",
        "onaka_no_yuki", "ElizabethG76409", "barbara1fz0w3n", "carolr7ew8st",
        "mochiko_diett", "ricochan_diet", "idol_dol1920"
    ].map(u => u.toLowerCase());

    // 2. 「X兵隊」グループのアカウントを取得
    const xSoldiers = query(`
        SELECT DISTINCT cgm.container_id, xa.x_username, cg.name as group_name
        FROM container_group_members cgm
        JOIN container_groups cg ON cgm.group_id = cg.id
        LEFT JOIN x_accounts xa ON cgm.container_id = xa.container_id
        WHERE cg.name LIKE '%X兵隊%'
        AND cg.name NOT LIKE '%Ban%'
        AND cg.name NOT LIKE '%凍結%'
    `, []) as any[];

    // 3. フィルタリング
    const finalTargets = xSoldiers.filter(s => {
        const cid = (s.container_id || "").toLowerCase();
        const uname = (s.x_username || "").toLowerCase();
        // コンテナIDまたはユーザー名が除外リストに含まれていたら除外
        return !excludeList.includes(cid) && !excludeList.includes(uname);
    });

    console.log(`Initial X Soldiers: ${xSoldiers.length}`);
    console.log(`After Exclusions: ${finalTargets.length}`);

    if (finalTargets.length === 0) {
        console.log("No targets found. Check group names or exclusion logic.");
        return;
    }

    // 4. スケジュール作成 (本日、2日後、4日後)
    const days = [0, 2, 4];
    const now = Date.now();
    const tasksToRegister: any[] = [];

    // 分散のためのジッター設定 (1アカウントあたり30秒ずつずらす)
    const jitterSeconds = 30;

    for (let i = 0; i < finalTargets.length; i++) {
        const target = finalTargets[i];

        for (const dayOffset of days) {
            const scheduledAt = now + (dayOffset * 24 * 3600 * 1000) + (i * jitterSeconds * 1000);

            tasksToRegister.push({
                presetId: PRESET_ID,
                containerId: target.container_id,
                queueName: QUEUE_NAME,
                scheduledAt: scheduledAt,
                timeStr: new Date(scheduledAt).toLocaleString('ja-JP')
            });
        }
    }

    // 5. JSONファイルとして保存 (デバッグ/証跡用)
    const outputPath = "tmp/x_soldier_weekly_tasks.json";
    fs.writeFileSync(outputPath, JSON.stringify(tasksToRegister, null, 2));

    console.log(`\n### Registration Plan ###`);
    console.log(`Total Tasks to Register: ${tasksToRegister.length} (${finalTargets.length} accounts x ${days.length} days)`);
    console.log(`Wait 30s jitter between accounts to spread load.`);
    console.log(`Plan saved to: ${outputPath}`);

    // 例を表示
    console.log(`\nExample entries:`);
    tasksToRegister.slice(0, 3).forEach(t => console.log(`- ${t.containerId} at ${t.timeStr}`));
    if (tasksToRegister.length > 3) {
        const last = tasksToRegister[tasksToRegister.length - 1];
        console.log(`...`);
        console.log(`- ${last.containerId} at ${last.timeStr}`);
    }
}

main().catch(console.error);
