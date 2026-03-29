
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const groupId = '6df1aacd-4623-4908-9e2d-9fa1d9990109';

    // すでに run-60* 系のタスクが割り当てられているコンテナIDを取得
    const usedContainers = query("SELECT DISTINCT container_id FROM tasks WHERE runId LIKE 'run-60%'");
    const usedIds = usedContainers.map(c => c.container_id);

    // X兵隊グループの全メンバーを取得
    const members = query("SELECT container_id FROM container_group_members WHERE group_id = ?", [groupId]);
    const memberIds = members.map(m => m.container_id);

    // 未使用のアカウントを抽出
    const availableIds = memberIds.filter(id => !usedIds.includes(id));

    console.log('Total X兵隊 accounts:', memberIds.length);
    console.log('Used X兵隊 accounts (for run-60*):', usedIds.filter(id => memberIds.includes(id)).length);
    console.log('Available X兵隊 accounts:', availableIds.length);

    // 詳細情報取得
    if (availableIds.length > 0) {
        const details = query(`
      SELECT container_id, proxy_id 
      FROM x_accounts 
      WHERE container_id IN (\${availableIds.map(() => '?').join(',')})
    `, availableIds);
        console.log('Sample available details:', JSON.stringify(details.slice(0, 5), null, 2));
    }
}

main().catch(console.error);
