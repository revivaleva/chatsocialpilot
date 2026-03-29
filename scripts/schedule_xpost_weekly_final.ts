
import { initDb, query } from "../src/drivers/db";
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

    // 2. 作成した「X兵隊」グループのアカウントをDBから取得
    const xSoldiers = query(`
        SELECT DISTINCT cgm.container_id, xa.x_username
        FROM container_group_members cgm
        JOIN container_groups cg ON cgm.group_id = cg.id
        LEFT JOIN x_accounts xa ON cgm.container_id = xa.container_id
        WHERE cg.name = 'X兵隊'
    `, []) as any[];

    // 3. 除外リスト適用
    const finalTargets = xSoldiers.filter(s => {
        const cid = (s.container_id || "").toLowerCase();
        const uname = (s.x_username || "").toLowerCase();
        return !excludeList.includes(cid) && !excludeList.includes(uname);
    });

    console.log(`Initial X Soldiers in group: ${xSoldiers.length}`);
    console.log(`After Exclusions: ${finalTargets.length}`);

    if (finalTargets.length === 0) {
        console.log("No targets found.");
        return;
    }

    // 4. スケジュール作成 (本日分は、既にある程度時間が過ぎている可能性を考慮し、微調整)
    // 1週間分 (本日、2日後、4日後)
    const days = [0, 2, 4];
    const now = Date.now();
    const tasksToRegister: any[] = [];

    // 分散のためのジッター設定 (30秒間隔)
    const jitterSeconds = 30;

    for (let i = 0; i < finalTargets.length; i++) {
        const target = finalTargets[i];

        for (const dayOffset of days) {
            // 本日分(dayOffset=0)は今すぐ開始されるようにジッターのみ加算
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

    // 証跡保存
    const outputPath = "tmp/x_soldier_weekly_tasks_final.json";
    fs.writeFileSync(outputPath, JSON.stringify(tasksToRegister, null, 2));

    console.log(`\n### Registration Plan ###`);
    console.log(`Group: X兵隊`);
    console.log(`Total Tasks to Register: ${tasksToRegister.length} (${finalTargets.length} accounts x ${days.length} days)`);
    console.log(`Plan saved to: ${outputPath}`);

    console.log(`\nExample first 3 tasks:`);
    tasksToRegister.slice(0, 3).forEach(t => console.log(`- ${t.containerId} at ${t.timeStr}`));
}

main().catch(console.error);
