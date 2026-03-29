
import { initDb, query } from "../src/drivers/db";
import fs from "node:fs";

async function main() {
    initDb();

    // 2026-03-10 以降のログインタスク対象者
    const startAt = new Date("2026-03-10T00:00:00+09:00").getTime();

    // 成功したアカウント または 特定の失敗（helenm3fs0ux）以外を取得
    // 前回の結果に基づき、259件を抽出
    const targets = query(`
        SELECT DISTINCT container_id 
        FROM tasks 
        WHERE preset_id IN (17, 39, 42) 
        AND created_at >= ?
        AND container_id != 'helenm3fs0ux'
    `, [startAt]) as any[];

    console.log(`Targeting ${targets.length} containers for X Post (Preset 40).`);

    const payload = targets.map(t => ({
        presetId: 40,
        containerId: t.container_id,
        queueName: "default"
    }));

    const outputPath = "tmp/register_xpost_20260314.json";
    fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
    console.log(`Generated JSON payload for registration: ${outputPath}`);
}

main().catch(console.error);
