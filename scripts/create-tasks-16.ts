import Database from 'better-sqlite3';
import path from 'node:path';

const DB_PATH = path.resolve('storage', 'app.db');
const db = new Database(DB_PATH);

// プリセットIDマッピング
const PRESETS = {
  P23: 23, // #コスメ垢さんと繋がりたい
  P24: 24, // #コスメ好きさんと繋がりたい
  P25: 25, // #コスメ好きな人と繋がりたい
  P26: 26, // #美容垢さんと繋がりたい
  P27: 27, // #美容好きな人と繋がりたい
  P19: 19, // #フォロバ100
  P15: 15, // #コスメプロフ
  P14: 14, // #コスメオタクプロフ
};

// スケジュール（JST 9:00 = UTC 0:00, JST 17:00 = UTC 8:00）
const SCHEDULES = {
  '2025-12-16_09:00': new Date('2025-12-16T00:00:00Z').getTime(),
  '2025-12-16_17:00': new Date('2025-12-16T08:00:00Z').getTime(),
};

// タスクキュー名
const QUEUES = {
  TASK1: 'default',
  TASK2: 'queue2',
  TASK3: 'queue3',
};

// グループ1（12/6-7作成）を統合
const GROUP1_NAMES = [
  'X兵隊12/6作成、プロフィール変更済、メール設定済',
  'X兵隊12/7作成、プロフィール変更済',
];

// 16日の実行計画
const EXECUTION_PLAN = [
  { date: '2025-12-16', time: '09:00', group: 'G1', preset: 'P19' },
  { date: '2025-12-16', time: '09:00', group: 'G2', preset: 'P27' },
  { date: '2025-12-16', time: '09:00', group: 'G3', preset: 'P19' },
  { date: '2025-12-16', time: '17:00', group: 'G1', preset: 'P23' },
  { date: '2025-12-16', time: '17:00', group: 'G2', preset: 'P24' },
  { date: '2025-12-16', time: '17:00', group: 'G3', preset: 'P27' },
];

// グループIDを名前から取得
function getGroupIdByName(name: string): string | null {
  const row = db.prepare('SELECT id FROM container_groups WHERE name = ?').get(name) as { id: string } | undefined;
  return row?.id || null;
}

// グループ1（12/6-7作成）のコンテナIDリストを取得
function getGroup1ContainerIds(): string[] {
  const groupIds: string[] = [];
  for (const name of GROUP1_NAMES) {
    const groupId = getGroupIdByName(name);
    if (groupId) {
      groupIds.push(groupId);
    }
  }
  if (groupIds.length === 0) return [];
  
  const placeholders = groupIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT container_id FROM container_group_members WHERE group_id IN (${placeholders}) ORDER BY container_id`).all(...groupIds) as { container_id: string }[];
  return rows.map(r => r.container_id);
}

// グループ2（12/8作成）のコンテナIDリストを取得
function getGroup2ContainerIds(): string[] {
  const groupId = getGroupIdByName('X兵隊12/8作成、プロフィール変更済');
  if (!groupId) return [];
  const rows = db.prepare('SELECT container_id FROM container_group_members WHERE group_id = ? ORDER BY container_id').all(groupId) as { container_id: string }[];
  return rows.map(r => r.container_id);
}

// グループ3（12/9作成）のコンテナIDリストを取得
function getGroup3ContainerIds(): string[] {
  const groupId = getGroupIdByName('X兵隊12/9作成、プロフィール変更済');
  if (!groupId) return [];
  const rows = db.prepare('SELECT container_id FROM container_group_members WHERE group_id = ? ORDER BY container_id').all(groupId) as { container_id: string }[];
  return rows.map(r => r.container_id);
}

// コンテナリストを3分割
function splitContainers(containers: string[]): { task1: string[], task2: string[], task3: string[] } {
  const total = containers.length;
  const task1Count = Math.ceil(total / 3);
  const task2Count = Math.ceil((total - task1Count) / 2);
  const task3Count = total - task1Count - task2Count;
  
  return {
    task1: containers.slice(0, task1Count),
    task2: containers.slice(task1Count, task1Count + task2Count),
    task3: containers.slice(task1Count + task2Count),
  };
}

// 既存のタスクをチェック（重複防止）
function taskExists(presetId: number, containerId: string, scheduledAt: number): boolean {
  const row = db.prepare('SELECT COUNT(*) as count FROM tasks WHERE preset_id = ? AND container_id = ? AND scheduled_at = ?').get(presetId, containerId, scheduledAt) as { count: number };
  return row.count > 0;
}

// タスクを登録
function createTask(
  presetId: number,
  containerId: string,
  scheduledAt: number,
  queueName: string,
  groupId: string | null
): string | null {
  // 重複チェック
  if (taskExists(presetId, containerId, scheduledAt)) {
    return null;
  }
  
  const runId = `run-${presetId}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const now = Date.now();
  
  db.prepare(
    'INSERT INTO tasks(runId, preset_id, container_id, overrides_json, scheduled_at, status, created_at, updated_at, group_id, wait_minutes, queue_name) VALUES(?,?,?,?,?,?,?,?,?,?,?)'
  ).run(
    runId,
    presetId,
    containerId,
    '{}',
    scheduledAt,
    'pending',
    now,
    now,
    groupId,
    0,
    queueName
  );
  
  return runId;
}

// メイン処理
function main() {
  console.log('=== 16日のタスク登録スクリプト開始 ===\n');
  
  // グループのコンテナIDリストを取得
  const g1Containers = getGroup1ContainerIds();
  const g2Containers = getGroup2ContainerIds();
  const g3Containers = getGroup3ContainerIds();
  
  console.log(`グループ1（12/6-7作成）: ${g1Containers.length}件`);
  console.log(`グループ2（12/8作成）: ${g2Containers.length}件`);
  console.log(`グループ3（12/9作成）: ${g3Containers.length}件\n`);
  
  if (g1Containers.length === 0 || g2Containers.length === 0 || g3Containers.length === 0) {
    console.error('エラー: グループのコンテナが見つかりません');
    return;
  }
  
  // 各グループを3分割
  const g1Split = splitContainers(g1Containers);
  const g2Split = splitContainers(g2Containers);
  const g3Split = splitContainers(g3Containers);
  
  console.log('グループ1の分割:');
  console.log(`  タスク1: ${g1Split.task1.length}件`);
  console.log(`  タスク2: ${g1Split.task2.length}件`);
  console.log(`  タスク3: ${g1Split.task3.length}件`);
  console.log('グループ2の分割:');
  console.log(`  タスク1: ${g2Split.task1.length}件`);
  console.log(`  タスク2: ${g2Split.task2.length}件`);
  console.log(`  タスク3: ${g2Split.task3.length}件`);
  console.log('グループ3の分割:');
  console.log(`  タスク1: ${g3Split.task1.length}件`);
  console.log(`  タスク2: ${g3Split.task2.length}件`);
  console.log(`  タスク3: ${g3Split.task3.length}件\n`);
  
  // グループIDを取得
  const g1GroupId = getGroupIdByName(GROUP1_NAMES[0]) || getGroupIdByName(GROUP1_NAMES[1]);
  const g2GroupId = getGroupIdByName('X兵隊12/8作成、プロフィール変更済');
  const g3GroupId = getGroupIdByName('X兵隊12/9作成、プロフィール変更済');
  
  let totalTasks = 0;
  let skippedTasks = 0;
  
  // 実行計画に基づいてタスクを登録
  for (const plan of EXECUTION_PLAN) {
    const scheduleKey = `${plan.date}_${plan.time}`;
    const scheduledAt = SCHEDULES[scheduleKey as keyof typeof SCHEDULES];
    const presetId = PRESETS[plan.preset as keyof typeof PRESETS];
    
    if (!scheduledAt || !presetId) {
      console.error(`エラー: スケジュールまたはプリセットが見つかりません: ${scheduleKey}, ${plan.preset}`);
      continue;
    }
    
    // グループに応じたコンテナリストと分割を選択
    let containers: { task1: string[], task2: string[], task3: string[] };
    let groupId: string | null;
    
    if (plan.group === 'G1') {
      containers = g1Split;
      groupId = g1GroupId;
    } else if (plan.group === 'G2') {
      containers = g2Split;
      groupId = g2GroupId;
    } else {
      containers = g3Split;
      groupId = g3GroupId;
    }
    
    // 3つのタスクキューに登録
    let created = 0;
    let skipped = 0;
    
    for (const containerId of containers.task1) {
      const runId = createTask(presetId, containerId, scheduledAt, QUEUES.TASK1, groupId);
      if (runId) {
        totalTasks++;
        created++;
      } else {
        skipped++;
        skippedTasks++;
      }
    }
    for (const containerId of containers.task2) {
      const runId = createTask(presetId, containerId, scheduledAt, QUEUES.TASK2, groupId);
      if (runId) {
        totalTasks++;
        created++;
      } else {
        skipped++;
        skippedTasks++;
      }
    }
    for (const containerId of containers.task3) {
      const runId = createTask(presetId, containerId, scheduledAt, QUEUES.TASK3, groupId);
      if (runId) {
        totalTasks++;
        created++;
      } else {
        skipped++;
        skippedTasks++;
      }
    }
    
    console.log(`✓ ${plan.date} ${plan.time} ${plan.group} ${plan.preset}: ${created}件登録${skipped > 0 ? ` (${skipped}件スキップ)` : ''}`);
  }
  
  console.log(`\n=== 完了: 合計 ${totalTasks}件のタスクを登録しました ===`);
  if (skippedTasks > 0) {
    console.log(`重複により ${skippedTasks}件をスキップしました`);
  }
  
  db.close();
}

main();

