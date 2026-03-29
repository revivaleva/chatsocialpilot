import { initDb, query } from "../src/drivers/db.js";

/**
 * Transient script for one-off investigations and trials.
 * Use 'npm run ops:scratch' to execute.
 * This file can be overwritten as needed.
 */
async function main() {
    console.log("--- Scratch Script Execution Start ---");

    // Initialize Database (if needed)
    initDb();

    // example: const counts = query("SELECT count(*) as count FROM tasks");
    // console.log("Tasks count:", counts);

    console.log("--- Scratch Script Execution End ---");
}

main().catch((err) => {
    console.error("Error in scratch script:", err);
    process.exit(1);
});
