import Database from "better-sqlite3";
const db = new Database("storage/app.db");
const stats = db
  .prepare(
    "SELECT queue_name, status, COUNT(*) as count FROM tasks WHERE status = 'running' GROUP BY queue_name, status",
  )
  .all();
console.log("Running tasks per queue:", stats);

const total = db
  .prepare("SELECT status, COUNT(*) as count FROM tasks GROUP BY status")
  .all();
console.log("Total tasks per status:", total);
