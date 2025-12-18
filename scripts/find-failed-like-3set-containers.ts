import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.resolve('storage', 'app.db');

try {
  const db = new Database(DB_PATH, { readonly: true });
  
  // まず、プリセット名に「いいね3点セット」が含まれるプリセットを探す
  const presetRows = db.prepare(`
    SELECT id, name 
    FROM presets 
    WHERE name LIKE '%いいね%3点%' OR name LIKE '%いいね%三点%' OR name LIKE '%3点%いいね%' OR name LIKE '%三点%いいね%'
  `).all() as Array<{ id: number; name: string }>;
  
  console.log('見つかったプリセット:');
  presetRows.forEach(p => console.log(`  ID: ${p.id}, 名前: ${p.name}`));
  
  if (presetRows.length === 0) {
    console.log('\n「いいね3点セット」を含むプリセットが見つかりませんでした。');
    console.log('すべてのプリセット名を確認します...\n');
    const allPresets = db.prepare('SELECT id, name FROM presets ORDER BY name').all() as Array<{ id: number; name: string }>;
    allPresets.forEach(p => console.log(`  ID: ${p.id}, 名前: ${p.name}`));
    process.exit(0);
  }
  
  const presetIds = presetRows.map(p => p.id);
  const placeholders = presetIds.map(() => '?').join(',');
  
  // 2025年12月14日 00:00:00 ～ 23:59:59 のタイムスタンプ（ミリ秒）
  const dec14Start = new Date('2025-12-14T00:00:00+09:00').getTime();
  const dec14End = new Date('2025-12-14T23:59:59.999+09:00').getTime();
  
  console.log(`\n検索条件:`);
  console.log(`  プリセットID: ${presetIds.join(', ')}`);
  console.log(`  日付範囲: 2025-12-14 00:00:00 ～ 23:59:59 JST`);
  console.log(`  タイムスタンプ: ${dec14Start} ～ ${dec14End}\n`);
  
  // 14日に実行されたタスクを取得
  // かつ、過去を含めて「いいね3点セット」系のプリセットで一度も成功していないコンテナを洗い出す
  // task_runsにはcontainer_idがないので、tasksテーブルから取得
  const query = `
    WITH containers_on_14th AS (
      -- 14日に実行されたコンテナ一覧
      SELECT DISTINCT t.container_id
      FROM task_runs tr
      INNER JOIN tasks t ON tr.runId = t.runId
      INNER JOIN presets p ON t.preset_id = p.id
      WHERE t.preset_id IN (${placeholders})
        AND tr.started_at >= ?
        AND tr.started_at <= ?
        AND t.container_id IS NOT NULL
    ),
    container_never_success AS (
      -- 過去を含めて「いいね3点セット」系のプリセットで一度も成功していないコンテナ
      SELECT DISTINCT
        t.container_id
      FROM task_runs tr
      INNER JOIN tasks t ON tr.runId = t.runId
      INNER JOIN presets p ON t.preset_id = p.id
      WHERE t.preset_id IN (${placeholders})
        AND (LOWER(tr.status) = 'ok' OR LOWER(tr.status) = 'done')
        AND t.container_id IS NOT NULL
    ),
    failed_containers_on_14th AS (
      -- 14日に実行されたコンテナの詳細（失敗したタスクのみ）
      -- 過去を含めて一度も成功していないコンテナ
      SELECT 
        t.container_id,
        t.preset_id,
        p.name as preset_name,
        COUNT(*) as total_runs,
        MIN(tr.started_at) as first_run_at,
        MAX(tr.started_at) as last_run_at
      FROM task_runs tr
      INNER JOIN tasks t ON tr.runId = t.runId
      INNER JOIN presets p ON t.preset_id = p.id
      WHERE t.preset_id IN (${placeholders})
        AND tr.started_at >= ?
        AND tr.started_at <= ?
        AND t.container_id IS NOT NULL
        AND t.container_id IN (SELECT container_id FROM containers_on_14th)
        AND t.container_id NOT IN (SELECT container_id FROM container_never_success)
        AND (LOWER(tr.status) != 'ok' AND LOWER(tr.status) != 'done')
      GROUP BY t.container_id, t.preset_id, p.name
    ),
    unique_failed_containers AS (
      -- コンテナごとに集約（複数のプリセットで失敗している場合も1件としてカウント）
      SELECT DISTINCT container_id
      FROM failed_containers_on_14th
    )
    SELECT 
      f.container_id,
      f.preset_id,
      f.preset_name,
      f.total_runs,
      f.first_run_at,
      f.last_run_at,
      datetime(f.first_run_at / 1000, 'unixepoch', 'localtime') as first_run_at_str,
      datetime(f.last_run_at / 1000, 'unixepoch', 'localtime') as last_run_at_str
    FROM failed_containers_on_14th f
    INNER JOIN unique_failed_containers u ON f.container_id = u.container_id
    ORDER BY f.total_runs DESC, f.first_run_at ASC
  `;
  
  // クエリのパラメータ: presetIds (3回), dec14Start (2回), dec14End (2回)
  const failedContainers = db.prepare(query).all(
    ...presetIds, dec14Start, dec14End,  // containers_on_14th
    ...presetIds,                         // container_never_success
    ...presetIds, dec14Start, dec14End    // failed_containers_on_14th
  ) as Array<{
    container_id: string;
    preset_id: number;
    preset_name: string;
    total_runs: number;
    first_run_at: number;
    last_run_at: number;
    first_run_at_str: string;
    last_run_at_str: string;
  }>;
  
  // 14日に実行されたタスクの総数とコンテナの総数を取得
  const statsQuery = `
    SELECT 
      COUNT(DISTINCT tr.runId) as total_tasks,
      COUNT(DISTINCT t.container_id) as total_containers,
      COUNT(*) as total_runs
    FROM task_runs tr
    INNER JOIN tasks t ON tr.runId = t.runId
    INNER JOIN presets p ON t.preset_id = p.id
    WHERE t.preset_id IN (${placeholders})
      AND tr.started_at >= ?
      AND tr.started_at <= ?
      AND t.container_id IS NOT NULL
  `;
  
  const stats = db.prepare(statsQuery).get(...presetIds, dec14Start, dec14End) as {
    total_tasks: number;
    total_containers: number;
    total_runs: number;
  };
  
  console.log(`\n14日に実行されたタスク統計:`);
  console.log(`  タスク総数: ${stats.total_tasks}件`);
  console.log(`  コンテナ総数: ${stats.total_containers}件`);
  console.log(`  実行総数: ${stats.total_runs}件\n`);
  
  // 14日当日に成功したコンテナ数を取得
  const successOn14thQuery = `
    SELECT COUNT(DISTINCT t.container_id) as count
    FROM task_runs tr
    INNER JOIN tasks t ON tr.runId = t.runId
    INNER JOIN presets p ON t.preset_id = p.id
    WHERE t.preset_id IN (${placeholders})
      AND tr.started_at >= ?
      AND tr.started_at <= ?
      AND (LOWER(tr.status) = 'ok' OR LOWER(tr.status) = 'done')
      AND t.container_id IS NOT NULL
  `;
  
  const successOn14thCount = (db.prepare(successOn14thQuery).get(...presetIds, dec14Start, dec14End) as { count: number })?.count || 0;
  console.log(`14日当日に成功したコンテナ数: ${successOn14thCount}件`);
  
  // 14日以前に他のプリセットで成功しているコンテナ数を取得
  const otherSuccessBefore14thQuery = `
    SELECT COUNT(DISTINCT t.container_id) as count
    FROM task_runs tr
    INNER JOIN tasks t ON tr.runId = t.runId
    INNER JOIN presets p ON t.preset_id = p.id
    WHERE t.preset_id IN (${placeholders})
      AND tr.started_at < ?
      AND (LOWER(tr.status) = 'ok' OR LOWER(tr.status) = 'done')
      AND t.container_id IS NOT NULL
  `;
  
  const otherSuccessBefore14thCount = (db.prepare(otherSuccessBefore14thQuery).get(...presetIds, dec14Start) as { count: number })?.count || 0;
  console.log(`14日以前に他の「いいね3点セット」プリセットで成功したことがあるコンテナ数: ${otherSuccessBefore14thCount}件`);
  
  // 14日に実行されたコンテナのうち、14日以前に成功したことがあるコンテナ数
  const containersOn14thQuery = `
    SELECT DISTINCT t.container_id
    FROM task_runs tr
    INNER JOIN tasks t ON tr.runId = t.runId
    INNER JOIN presets p ON t.preset_id = p.id
    WHERE t.preset_id IN (${placeholders})
      AND tr.started_at >= ?
      AND tr.started_at <= ?
      AND t.container_id IS NOT NULL
  `;
  
  const containersOn14th = db.prepare(containersOn14thQuery).all(...presetIds, dec14Start, dec14End) as Array<{ container_id: string }>;
  const containerIdsOn14th = containersOn14th.map(c => c.container_id);
  
  if (containerIdsOn14th.length > 0) {
    const placeholders14th = containerIdsOn14th.map(() => '?').join(',');
    const successBefore14thForContainersQuery = `
      SELECT COUNT(DISTINCT t.container_id) as count
      FROM task_runs tr
      INNER JOIN tasks t ON tr.runId = t.runId
      INNER JOIN presets p ON t.preset_id = p.id
      WHERE t.preset_id IN (${placeholders})
        AND t.container_id IN (${placeholders14th})
        AND tr.started_at < ?
        AND (LOWER(tr.status) = 'ok' OR LOWER(tr.status) = 'done')
        AND t.container_id IS NOT NULL
    `;
    
    const successBefore14thForContainersCount = (db.prepare(successBefore14thForContainersQuery).get(...presetIds, ...containerIdsOn14th, dec14Start) as { count: number })?.count || 0;
    console.log(`14日に実行されたコンテナのうち、14日以前に成功したことがあるコンテナ数: ${successBefore14thForContainersCount}件\n`);
  } else {
    console.log(`14日に実行されたコンテナのうち、14日以前に成功したことがあるコンテナ数: 0件\n`);
  }
  
  // 14日に実行されたコンテナのうち、14日当日に失敗したコンテナ数を取得
  const failedOn14thQuery = `
    SELECT COUNT(DISTINCT t.container_id) as count
    FROM task_runs tr
    INNER JOIN tasks t ON tr.runId = t.runId
    INNER JOIN presets p ON t.preset_id = p.id
    WHERE t.preset_id IN (${placeholders})
      AND tr.started_at >= ?
      AND tr.started_at <= ?
      AND t.container_id IS NOT NULL
      AND (LOWER(tr.status) != 'ok' AND LOWER(tr.status) != 'done')
      AND t.container_id NOT IN (
        SELECT DISTINCT t2.container_id
        FROM task_runs tr2
        INNER JOIN tasks t2 ON tr2.runId = t2.runId
        INNER JOIN presets p2 ON t2.preset_id = p2.id
        WHERE t2.preset_id IN (${placeholders})
          AND tr2.started_at >= ?
          AND tr2.started_at <= ?
          AND (LOWER(tr2.status) = 'ok' OR LOWER(tr2.status) = 'done')
          AND t2.container_id IS NOT NULL
      )
  `;
  
  const failedOn14thCount = (db.prepare(failedOn14thQuery).get(...presetIds, dec14Start, dec14End, ...presetIds, dec14Start, dec14End) as { count: number })?.count || 0;
  console.log(`14日当日に失敗し、かつ14日当日に成功していないコンテナ数: ${failedOn14thCount}件\n`);
  
  // 14日当日に失敗し、かつ14日当日に成功していないコンテナの詳細を取得
  const failedOn14thDetailQuery = `
    SELECT DISTINCT
      t.container_id,
      COUNT(DISTINCT tr.runId) as failed_task_count,
      MIN(tr.started_at) as first_failed_at,
      MAX(tr.started_at) as last_failed_at,
      datetime(MIN(tr.started_at) / 1000, 'unixepoch', 'localtime') as first_failed_at_str,
      datetime(MAX(tr.started_at) / 1000, 'unixepoch', 'localtime') as last_failed_at_str
    FROM task_runs tr
    INNER JOIN tasks t ON tr.runId = t.runId
    INNER JOIN presets p ON t.preset_id = p.id
    WHERE t.preset_id IN (${placeholders})
      AND tr.started_at >= ?
      AND tr.started_at <= ?
      AND t.container_id IS NOT NULL
      AND (LOWER(tr.status) != 'ok' AND LOWER(tr.status) != 'done')
      AND t.container_id NOT IN (
        SELECT DISTINCT t2.container_id
        FROM task_runs tr2
        INNER JOIN tasks t2 ON tr2.runId = t2.runId
        INNER JOIN presets p2 ON t2.preset_id = p2.id
        WHERE t2.preset_id IN (${placeholders})
          AND tr2.started_at >= ?
          AND tr2.started_at <= ?
          AND (LOWER(tr2.status) = 'ok' OR LOWER(tr2.status) = 'done')
          AND t2.container_id IS NOT NULL
      )
    GROUP BY t.container_id
    ORDER BY failed_task_count DESC, first_failed_at ASC
  `;
  
  const failedOn14thDetail = db.prepare(failedOn14thDetailQuery).all(...presetIds, dec14Start, dec14End, ...presetIds, dec14Start, dec14End) as Array<{
    container_id: string;
    failed_task_count: number;
    first_failed_at: number;
    last_failed_at: number;
    first_failed_at_str: string;
    last_failed_at_str: string;
  }>;
  
  if (failedOn14thDetail.length > 0) {
    console.log('14日当日に失敗し、かつ14日当日に成功していないコンテナ詳細:');
    console.log('コンテナID | 失敗タスク数 | 初回失敗日時 | 最終失敗日時');
    console.log('-' + '-'.repeat(80));
    failedOn14thDetail.forEach(c => {
      console.log(
        `${c.container_id.padEnd(36)} | ${String(c.failed_task_count).padStart(10)} | ${c.first_failed_at_str} | ${c.last_failed_at_str}`
      );
    });
    console.log('');
  }
  
  console.log(`\n14日に実行され、かつ過去に一度も成功していないコンテナ: ${failedContainers.length}件\n`);
  
  if (failedContainers.length === 0) {
    console.log('該当するコンテナはありませんでした。');
  } else {
    console.log('コンテナID | プリセット名 | 実行回数 | 初回実行日時 | 最終実行日時');
    console.log('-' + '-'.repeat(80));
    failedContainers.forEach(c => {
      console.log(
        `${c.container_id.padEnd(36)} | ${c.preset_name.padEnd(20)} | ${String(c.total_runs).padStart(6)} | ${c.first_run_at_str} | ${c.last_run_at_str}`
      );
    });
    
    // JSON形式でも出力
    console.log('\n\nJSON形式:');
    console.log(JSON.stringify({
      ok: true,
      presetIds,
      presetNames: presetRows.map(p => p.name),
      failedContainers: failedContainers.map(c => ({
        container_id: c.container_id,
        preset_id: c.preset_id,
        preset_name: c.preset_name,
        total_runs: c.total_runs,
        first_run_at: c.first_run_at,
        last_run_at: c.last_run_at,
        first_run_at_str: c.first_run_at_str,
        last_run_at_str: c.last_run_at_str
      }))
    }, null, 2));
  }
  
  db.close();
} catch (e: any) {
  console.error(JSON.stringify({ ok: false, error: String(e?.message || e) }, null, 2));
  process.exit(1);
}

