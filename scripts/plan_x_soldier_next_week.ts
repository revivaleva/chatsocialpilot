
import { initDb, query } from "../src/drivers/db";
import fs from "node:fs";

async function main() {
    initDb();

    const PRESET_ID = 40;
    const QUEUE_NAME = "default";

    const excludeList = [
        "an_cosme_beauty", "miyu_biyou", "iroyuru_", "kui_nyan_", "miyu_bgnr",
        "hana_beatbabe", "rin_g_bx", "nemu_bloom", "hinata_w_cosme", "n7_cos",
        "c1115Sarah", "rutho0vazy0", "donna2010ir2lzv", "momoka_coswalk",
        "onaka_no_yuki", "ElizabethG76409", "barbara1fz0w3n", "carolr7ew8st",
        "mochiko_diett", "ricochan_diet", "idol_dol1920"
    ].map(u => u.toLowerCase());

    const xSoldiers = query(`
        SELECT DISTINCT cgm.container_id, xa.x_username
        FROM container_group_members cgm
        JOIN container_groups cg ON cgm.group_id = cg.id
        LEFT JOIN x_accounts xa ON cgm.container_id = xa.container_id
        WHERE cg.name = 'X兵隊'
    `, []) as any[];

    const finalTargets = xSoldiers.filter(s => {
        const cid = (s.container_id || "").toLowerCase();
        const uname = (s.x_username || "").toLowerCase();
        return !excludeList.includes(cid) && !excludeList.includes(uname);
    });

    // 1週間分 (中2日空け = 4回分)
    // 3/24, 3/26, 3/28, 3/30
    // 今が 3/22 23:35 なので、+1日後、+3日後、+5日後、+7日後
    const days = [1, 3, 5, 7];
    const nowBase = new Date('2026-03-23T00:00:00+09:00').getTime(); // 3/23 00:00 start
    const tasksToRegister: any[] = [];
    const jitterSeconds = 30;

    for (let i = 0; i < finalTargets.length; i++) {
        const target = finalTargets[i];
        for (const dayOffset of days) {
            const scheduledAt = nowBase + (dayOffset * 24 * 3600 * 1000) + (i * jitterSeconds * 1000);
            tasksToRegister.push({
                presetId: PRESET_ID,
                containerId: target.container_id,
                queueName: QUEUE_NAME,
                scheduledAt: scheduledAt,
                timeStr: new Date(scheduledAt).toLocaleString('ja-JP')
            });
        }
    }

    const outputPath = "tmp/x_soldier_next_week_plan.json";
    fs.writeFileSync(outputPath, JSON.stringify(tasksToRegister, null, 2));

    console.log(`### Registration Plan (Next Week) ###`);
    console.log(`Group: X兵隊`);
    console.log(`Total Targets: ${finalTargets.length}`);
    console.log(`Days Offset: ${days.join(", ")} days from 3/23`);
    console.log(`Total Tasks: ${tasksToRegister.length}`);
    console.log(`First task: ${tasksToRegister[0].timeStr}`);
    console.log(`Last task: ${tasksToRegister[tasksToRegister.length - 1].timeStr}`);
    console.log(`Plan saved to: ${outputPath}`);
}

main().catch(console.error);
