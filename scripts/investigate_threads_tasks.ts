import { initDb, query } from "../src/drivers/db.js";

async function main() {
  initDb();

  console.log("--- Tables ---");
  const tables = query("SELECT name FROM sqlite_master WHERE type='table'");
  console.log(JSON.stringify(tables, null, 2));

  console.log("\n--- Tasks Schema ---");
  const tasksSchema = query("PRAGMA table_info(tasks)");
  console.log(JSON.stringify(tasksSchema, null, 2));

  console.log("\n--- Presets ---");
  const presets = query("SELECT id, name, description FROM presets WHERE name LIKE '%Threads%' OR description LIKE '%Threads%'");
  console.log(JSON.stringify(presets, null, 2));

  console.log("\n--- Container Group for loureiroalbuquerqueqd556 ---");
  const group = query(`
    SELECT cg.id, cg.name
    FROM container_groups cg
    JOIN container_group_members cgm ON cg.id = cgm.group_id
    WHERE cgm.container_id = 'loureiroalbuquerqueqd556' OR cgm.container_id IN (
      SELECT id FROM runs WHERE name = 'loureiroalbuquerqueqd556' -- In case it's UUID/Name mix
    )
  `);
  console.log(JSON.stringify(group, null, 2));

  console.log("\n--- All Unique Keywords in Threads Tasks ---");
  const uniqueKeywords = query(`
    SELECT DISTINCT json_extract(overrides_json, '$.keyword') as keyword
    FROM tasks
    WHERE preset_id = 28
  `);
  console.log(JSON.stringify(uniqueKeywords, null, 2));
}

main().catch(console.error);
