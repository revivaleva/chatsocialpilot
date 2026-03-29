
import { initDb, query } from "../src/drivers/db";

async function main() {
    initDb();
    const result = query(`
        SELECT queue_name, count(*) as count 
        FROM tasks 
        WHERE created_at > ? 
        GROUP BY queue_name
    `, [Date.now() - 7 * 24 * 3600 * 1000]) as any[];
    console.table(result);
}

main().catch(console.error);
