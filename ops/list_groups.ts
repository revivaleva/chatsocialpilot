import { initDb, query } from '../src/drivers/db.js';

initDb();
const groupStatus = query(`
  SELECT cg.id, cg.name, COUNT(cgm.container_id) as count
  FROM container_groups cg
  LEFT JOIN container_group_members cgm ON cg.id = cgm.group_id
  GROUP BY cg.id
  ORDER BY cg.created_at DESC
`);
console.log(JSON.stringify(groupStatus, null, 2));
