
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    const taskOverrides = query(`
        SELECT DISTINCT overrides_json
        FROM tasks
        WHERE preset_id = 28
        ORDER BY created_at DESC
        LIMIT 10
    `);

    console.log("Actually used overrides in recent tasks:");
    taskOverrides.forEach((t: any) => console.log(t.overrides_json));
}

main().catch(console.error);
