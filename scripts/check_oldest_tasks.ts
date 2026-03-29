
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const oldest28 = query("SELECT created_at FROM tasks WHERE status = 'pending' AND preset_id = 28 ORDER BY created_at ASC LIMIT 1", [])[0] as any;
    const oldest29 = query("SELECT created_at FROM tasks WHERE status = 'pending' AND preset_id = 29 ORDER BY created_at ASC LIMIT 1", [])[0] as any;
    console.log(`Oldest Preset 28 created_at: ${oldest28?.created_at}`);
    console.log(`Oldest Preset 29 created_at: ${oldest29?.created_at}`);
}

main().catch(console.error);
