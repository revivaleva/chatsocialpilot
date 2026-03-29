import { initDb, query } from "../src/drivers/db.js";

async function main() {
    initDb();

    console.log("--- Past Tasks with Different Overrides ---");
    const taskGroups = query(`
    SELECT 
      overrides_json, 
      COUNT(*) as count, 
      MIN(created_at) as first_seen, 
      MAX(created_at) as last_seen
    FROM tasks 
    WHERE preset_id = 28
    GROUP BY overrides_json
    ORDER BY last_seen DESC
  `);
    console.log(JSON.stringify(taskGroups, null, 2));

    console.log("\n--- Task Run Status and Results ---");
    const runResults = query(`
    SELECT 
      tr.id, 
      tr.runId, 
      tr.status, 
      tr.result_json, 
      t.overrides_json, 
      tr.started_at
    FROM task_runs tr
    JOIN tasks t ON tr.task_id = t.id
    WHERE t.preset_id = 28
    ORDER BY tr.started_at DESC
    LIMIT 20
  `);
    console.log(JSON.stringify(runResults, null, 2));

    console.log("\n--- Post Library Sampling ---");
    const postSamples = query(`
    SELECT content, created_at 
    FROM post_library 
    ORDER BY created_at DESC 
    LIMIT 5
  `);
    console.log(JSON.stringify(postSamples, null, 2));
}

main().catch(console.error);
