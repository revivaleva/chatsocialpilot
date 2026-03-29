
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const rows = query('SELECT * FROM presets WHERE steps_json LIKE ? OR name LIKE ?', ["%humanClick%", "%認証%"]) as any[];
    for (const r of rows) {
        console.log(`\n--- Preset ${r.id}: ${r.name} ---`);
        console.log(r.steps_json);
    }
}

main().catch(console.error);
