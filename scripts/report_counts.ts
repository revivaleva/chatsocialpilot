
import { initDb, query } from "../src/drivers/db";

async function main() {
    initDb();

    const dates = ['2026-03-24', '2026-03-26'];
    for (const dateStr of dates) {
        const start = new Date(dateStr + 'T00:00:00+09:00').getTime();
        const end = new Date(dateStr + 'T23:59:59+09:00').getTime();
        const rows = query<{ status: string; count: number }>(
            'SELECT status, COUNT(*) as count FROM tasks WHERE scheduled_at BETWEEN ? AND ? GROUP BY status',
            [start, end]
        );
        console.log(`${dateStr} (JST):`);
        if (rows.length === 0) {
            console.log("  No tasks found.");
        } else {
            console.table(rows);
        }
    }

    // Double check preset 40 name
    const preset40 = query<{ name: string }>('SELECT name FROM presets WHERE id = 40');
    console.log(`Preset 40 name: ${preset40[0]?.name}`);
}

main().catch(console.error);
