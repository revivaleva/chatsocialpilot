
import { initDb, query } from "../src/drivers/db";

async function main() {
    initDb();
    const presets = query("SELECT id, name, description FROM presets");
    console.log("Presets:");
    console.table(presets);

    // Check tasks for March 24 and 26
    // March 24, 2026: 1742742000000 (Start) - 1742828399999 (End) approx
    // March 26, 2026: 1742914800000 (Start) - 1743001199999 (End) approx

    // Use date functions in SQLite if possible, or just calculate in TS
    const start24 = new Date("2026-03-24T00:00:00+09:00").getTime();
    const end24 = new Date("2026-03-24T23:59:59+09:00").getTime();
    const start26 = new Date("2026-03-26T00:00:00+09:00").getTime();
    const end26 = new Date("2026-03-26T23:59:59+09:00").getTime();

    console.log(`March 24 range: ${start24} - ${end24}`);
    console.log(`March 26 range: ${start26} - ${end26}`);

    const tasks24 = query<{ count: number }>("SELECT COUNT(*) as count FROM tasks WHERE scheduled_at BETWEEN ? AND ?", [start24, end24]);
    const tasks26 = query<{ count: number }>("SELECT COUNT(*) as count FROM tasks WHERE scheduled_at BETWEEN ? AND ?", [start26, end26]);

    console.log(`Tasks scheduled for March 24: ${tasks24[0].count}`);
    console.log(`Tasks scheduled for March 26: ${tasks26[0].count}`);

    // Also check with preset filter if we find which one is "Task 1"
    const allTasksInRange = query("SELECT id, preset_id, scheduled_at, status FROM tasks WHERE (scheduled_at BETWEEN ? AND ?) OR (scheduled_at BETWEEN ? AND ?)", [start24, end24, start26, end26]);
    console.log("Sample tasks in range:");
    console.table(allTasksInRange.slice(0, 10));
}

main().catch(console.error);
