import { initDb, query } from '../src/drivers/db';

/**
 * いいね3点セット#コスメオタクプロフで失敗したタスクの対象コンテナをリストアップ
 */

type TaskRow = {
  runId: string;
  preset_id: number;
  container_id: string | null;
  group_id: string | null;
  created_at: number;
  status: string;
  preset_name?: string;
};

type TaskRunRow = {
  runId: string;
  started_at: number;
  ended_at: number;
  status: string;
  result_json: string;
};

type ContainerInfo = {
  containerId: string;
  groupId: string | null;
  groupName: string | null;
  runId: string;
  taskStatus: string;
  runStatus: string;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  errorMessage: string | null;
};

async function main() {
  initDb({ wal: true });
  
  console.log('=== いいね3点セット#コスメオタクプロフ 失敗タスクの対象コンテナ ===\n');
  
  // 1. いいね3点セット#コスメオタクプロフのpreset IDを取得
  const presetRows = query<{ id: number; name: string }>(
    'SELECT id, name FROM presets WHERE name = ?',
    ['いいね3点セット#コスメオタクプロフ']
  );
  
  if (presetRows.length === 0) {
    console.log('いいね3点セット#コスメオタクプロフのpresetが見つかりませんでした。');
    return;
  }
  
  const presetId = presetRows[0].id;
  console.log(`Preset ID: ${presetId} (${presetRows[0].name})\n`);
  
  // 対象グループを取得
  const targetGroupName = 'X兵隊12/5作成、プロフィール変更済、メール設定済';
  const targetGroup = query<{ id: string; name: string }>(
    'SELECT id, name FROM container_groups WHERE name = ?',
    [targetGroupName]
  )[0];
  
  if (!targetGroup) {
    console.log(`対象グループ「${targetGroupName}」が見つかりませんでした。`);
    return;
  }
  
  console.log(`対象グループ: ${targetGroup.name} (ID: ${targetGroup.id})\n`);
  
  // 今日の18時のタイムスタンプを計算
  const now = new Date();
  const today18h = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 18, 0, 0, 0);
  const today18hTimestamp = today18h.getTime();
  
  console.log(`対象期間: 今日の18時以降 (${today18h.toLocaleString('ja-JP')} 以降)\n`);
  
  // 2. 失敗したタスクを取得（対象グループ、今日の18時以降）
  // statusが 'failed' または 'stopped' のタスク
  const failedTasks = query<TaskRow>(
    `SELECT t.runId, t.preset_id, t.container_id, t.group_id, t.created_at, t.status, p.name as preset_name
     FROM tasks t
     LEFT JOIN presets p ON t.preset_id = p.id
     WHERE t.preset_id = ? 
       AND t.group_id = ?
       AND t.created_at >= ?
       AND (t.status = 'failed' OR t.status = 'stopped')
     ORDER BY t.created_at DESC`,
    [presetId, targetGroup.id, today18hTimestamp]
  );
  
  // 3. task_runsからも失敗したタスクを取得（対象グループ、今日の18時以降）
  const failedTaskRuns = query<TaskRunRow>(
    `SELECT tr.runId, tr.started_at, tr.ended_at, tr.status, tr.result_json
     FROM task_runs tr
     INNER JOIN tasks t ON tr.runId = t.runId
     WHERE t.preset_id = ? 
       AND t.group_id = ?
       AND t.created_at >= ?
       AND tr.status = 'failed'
     ORDER BY tr.started_at DESC`,
    [presetId, targetGroup.id, today18hTimestamp]
  );
  
  // 4. 失敗したタスクのrunIdを収集
  const failedRunIds = new Set<string>();
  for (const task of failedTasks) {
    failedRunIds.add(task.runId);
  }
  for (const run of failedTaskRuns) {
    failedRunIds.add(run.runId);
  }
  
  // 5. 失敗したタスクの詳細情報を取得（失敗後に成功したタスクがある場合は除外）
  const containerInfos: ContainerInfo[] = [];
  const containerIdSet = new Set<string>();
  
  for (const runId of failedRunIds) {
    const task = query<TaskRow>(
      `SELECT t.runId, t.preset_id, t.container_id, t.group_id, t.created_at, t.status, p.name as preset_name
       FROM tasks t
       LEFT JOIN presets p ON t.preset_id = p.id
       WHERE t.runId = ?`,
      [runId]
    )[0];
    
    if (!task || !task.container_id) continue;
    
    const taskRun = query<TaskRunRow>(
      `SELECT runId, started_at, ended_at, status, result_json
       FROM task_runs
       WHERE runId = ?`,
      [runId]
    )[0];
    
    // 失敗したタスクの日時を取得（started_atがあればそれを使用、なければcreated_at）
    const failedTaskTime = taskRun?.started_at || task.created_at;
    
    // 同じコンテナIDで同じpreset IDのタスクが、失敗したタスクの後に成功しているかチェック
    // 対象グループ内でチェック
    const laterSuccessTasks = query<{ runId: string; status: string }>(
      `SELECT t.runId, tr.status
       FROM tasks t
       LEFT JOIN task_runs tr ON t.runId = tr.runId
       WHERE t.preset_id = ? 
         AND t.container_id = ?
         AND t.group_id = ?
         AND (tr.started_at > ? OR (tr.started_at IS NULL AND t.created_at > ?))
         AND (tr.status = 'ok' OR (t.status = 'done' AND tr.status = 'ok'))
       LIMIT 1`,
      [presetId, task.container_id, targetGroup.id, failedTaskTime, failedTaskTime]
    );
    
    // 失敗後に成功したタスクがある場合は除外
    if (laterSuccessTasks.length > 0) {
      console.log(`[除外] コンテナ ${task.container_id}: 失敗後に成功したタスクあり (Run ID: ${laterSuccessTasks[0].runId})`);
      continue;
    }
    
    // グループ名を取得
    let groupName: string | null = null;
    if (task.group_id) {
      const group = query<{ name: string }>(
        'SELECT name FROM container_groups WHERE id = ?',
        [task.group_id]
      )[0];
      if (group) {
        groupName = group.name;
      }
    }
    
    // エラーメッセージを取得（result_jsonから）
    let errorMessage: string | null = null;
    if (taskRun && taskRun.result_json) {
      try {
        const result = JSON.parse(taskRun.result_json);
        if (result.error) {
          errorMessage = result.error;
        } else if (result.steps && Array.isArray(result.steps)) {
          // 最後の失敗したステップのエラーを取得
          for (let i = result.steps.length - 1; i >= 0; i--) {
            const step = result.steps[i];
            if (step.error) {
              errorMessage = step.error;
              break;
            } else if (step.result && step.result.body && step.result.body.error) {
              errorMessage = step.result.body.error;
              break;
            }
          }
        }
      } catch (e) {
        // JSON解析エラーは無視
      }
    }
    
    const containerId = task.container_id;
    if (!containerIdSet.has(containerId)) {
      containerIdSet.add(containerId);
      containerInfos.push({
        containerId,
        groupId: task.group_id,
        groupName,
        runId: task.runId,
        taskStatus: task.status,
        runStatus: taskRun?.status || 'unknown',
        createdAt: task.created_at,
        startedAt: taskRun?.started_at || null,
        endedAt: taskRun?.ended_at || null,
        errorMessage
      });
    }
  }
  
  // 6. 結果を表示
  console.log(`\n失敗したタスク数: ${failedRunIds.size}件`);
  console.log(`対象コンテナ数（失敗後に成功なし）: ${containerInfos.length}件\n`);
  
  if (containerInfos.length === 0) {
    console.log('失敗したタスクの対象コンテナが見つかりませんでした。');
    return;
  }
  
  console.log('【対象コンテナ一覧】\n');
  
  // グループごとにグループ化
  const byGroup = new Map<string | null, ContainerInfo[]>();
  for (const info of containerInfos) {
    const key = info.groupName || '(グループ未設定)';
    if (!byGroup.has(key)) {
      byGroup.set(key, []);
    }
    byGroup.get(key)!.push(info);
  }
  
  for (const [groupName, containers] of byGroup.entries()) {
    console.log(`【${groupName}】`);
    console.log(`  コンテナ数: ${containers.length}件\n`);
    
    for (const info of containers) {
      const createdDate = new Date(info.createdAt).toLocaleString('ja-JP');
      const startedDate = info.startedAt ? new Date(info.startedAt).toLocaleString('ja-JP') : '未開始';
      const endedDate = info.endedAt ? new Date(info.endedAt).toLocaleString('ja-JP') : '未終了';
      
      console.log(`  コンテナID: ${info.containerId}`);
      console.log(`    Run ID: ${info.runId}`);
      console.log(`    タスクステータス: ${info.taskStatus}`);
      console.log(`    実行ステータス: ${info.runStatus}`);
      console.log(`    作成日時: ${createdDate}`);
      console.log(`    開始日時: ${startedDate}`);
      console.log(`    終了日時: ${endedDate}`);
      if (info.errorMessage) {
        const shortError = info.errorMessage.length > 100 
          ? info.errorMessage.substring(0, 100) + '...'
          : info.errorMessage;
        console.log(`    エラー: ${shortError}`);
      }
      console.log('');
    }
  }
  
  // 7. コンテナIDのみのリスト（コピー用）
  console.log('\n【コンテナID一覧（コピー用）】\n');
  const containerIds = containerInfos.map(info => info.containerId);
  for (let i = 0; i < containerIds.length; i++) {
    console.log(containerIds[i]);
  }
  
  // 8. グループ別の集計
  console.log('\n【グループ別集計】\n');
  for (const [groupName, containers] of byGroup.entries()) {
    console.log(`  ${groupName}: ${containers.length}件`);
  }
}

main().catch((e) => {
  console.error('エラーが発生しました:', e);
  process.exit(1);
});

