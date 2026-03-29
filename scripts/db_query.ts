import { initDb, query } from '../src/drivers/db.js';
import { logger } from '../src/utils/logger.js';

async function main() {
    const sql = process.argv[2];
    if (!sql) {
        console.error("No SQL query provided.");
        process.argv[2] = 'SELECT 1'; // Default
    }

    // initDb with WAL=true by default
    initDb();

    try {
        const res = query(process.argv[2], []);
        console.log(JSON.stringify(res, null, 2));
    } catch (e: any) {
        console.error("Query failed:", e.message);
        process.exit(1);
    }
}

main().catch(err => {
    console.error("Script failed:", err);
    process.exit(1);
});
