import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const terms = ['田中', '誠', '1988-11-20'];
    for (const term of terms) {
        console.log(`--- Searching for ${term} ---`);
        const tables = query("SELECT name FROM sqlite_master WHERE type='table'");
        for (const table of tables) {
            const table_name = table.name;
            try {
                const cols = query(`PRAGMA table_info(${table_name})`);
                for (const col of cols) {
                    const col_name = col.name;
                    const results = query(`SELECT * FROM ${table_name} WHERE ${col_name} LIKE '%${term}%' LIMIT 1`);
                    if (results.length > 0) {
                        console.log(`Match in Table: ${table_name}, Column: ${col_name}`);
                    }
                }
            } catch (e) { }
        }
    }
}

main().catch(console.error);
