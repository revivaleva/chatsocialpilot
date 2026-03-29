import Database from "better-sqlite3";
const db = new Database("storage/app.db");

const groups = db
  .prepare("SELECT id, name FROM container_groups WHERE name LIKE 'X兵隊%'")
  .all();
console.log("Groups:", groups);

if (groups.length > 0) {
  const groupId = groups[0].id;
  const members = db
    .prepare("SELECT * FROM container_group_members WHERE group_id = ? LIMIT 5")
    .all(groupId);
  console.log(`Members of group ${groups[0].name} (${groupId}):`, members);

  const accounts = db
    .prepare("SELECT container_id FROM x_accounts LIMIT 5")
    .all();
  console.log("Sample x_accounts.container_id:", accounts);
}
