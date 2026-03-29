
import { initDb, query, run } from '../src/drivers/db.js';
import { v4 as uuidv4 } from 'uuid';

async function main() {
    initDb();

    const PRESET_ID = 29;
    const GROUP_NAME = 'X兵隊';

    const groupRows = query("SELECT id FROM container_groups WHERE name = ? LIMIT 1", [GROUP_NAME]);
    if (!groupRows || groupRows.length === 0) {
        console.error(`Group ${GROUP_NAME} not found`);
        return;
    }
    const groupId = (groupRows[0] as any).id;

    const members = query("SELECT container_id FROM container_group_members WHERE group_id = ?", [groupId]);
    console.log(`Found ${members.length} accounts in group ${GROUP_NAME}`);

    const now = Date.now();
    let registeredCount = 0;

    for (const member of members as any[]) {
        const containerId = member.container_id;
        const runId = `run-${PRESET_ID}-${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).substring(2, 7)}`;

        // Check if task already pending for this container and preset
        const existing = query("SELECT id FROM tasks WHERE container_id = ? AND preset_id = ? AND status = 'pending' LIMIT 1", [containerId, PRESET_ID]);
        if (existing && existing.length > 0) {
            console.log(`Task already pending for ${containerId}, skipping`);
            continue;
        }

        run(`INSERT INTO tasks (runId, preset_id, container_id, status, queue_name, group_id, created_at, updated_at) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [runId, PRESET_ID, containerId, 'pending', 'default', groupId, now, now]);

        registeredCount++;
    }

    console.log(`Successfully registered ${registeredCount} tasks for Preset 29 in group ${GROUP_NAME}`);
}

main().catch(console.error);
