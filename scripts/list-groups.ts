#!/usr/bin/env tsx
import { initDb, query } from '../src/drivers/db.js';

initDb();
const groups = query<{ id: string; name: string }>('SELECT id, name FROM container_groups ORDER BY name');

console.log('グループ一覧:');
if (groups.length === 0) {
  console.log('  グループが見つかりませんでした');
} else {
  groups.forEach(g => console.log(`  - ${g.name} (ID: ${g.id})`));
}
