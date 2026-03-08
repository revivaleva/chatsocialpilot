#!/usr/bin/env tsx
/**
 * ログ収集・要約（期間指定、エラー TopN、件数・増加傾向）
 * データソース: task_runs, run_history（storage/app.db）
 * シークレット: result_json / args_json は要約のみ表示（値は出さない）。
 */

import { initDb, query } from '../src/drivers/db.js';

interface AuditOptions {
  fromTs: number;
  toTs: number;
  topErrors: number;
  format: 'text' | 'json';
}

function parseDate(s: string): number {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${s}`);
  return d.getTime();
}

function parseArgs(): AuditOptions {
  const args = process.argv.slice(2);
  let fromTs = Date.now() - 24 * 60 * 60 * 1000;
  let toTs = Date.now();
  let topErrors = 10;
  let format: 'text' | 'json' = 'text';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from' && args[i + 1]) {
      fromTs = parseDate(args[++i]);
    } else if (args[i] === '--to' && args[i + 1]) {
      toTs = parseDate(args[++i]);
    } else if (args[i] === '--top' && args[i + 1]) {
      topErrors = Math.max(1, parseInt(args[++i], 10) || 10);
    } else if (args[i] === '--json') {
      format = 'json';
    }
  }

  return { fromTs, toTs, topErrors, format };
}

function main() {
  initDb();
  const opts = parseArgs();

  const taskRuns = query<{ status: string; count: number }>(
    `SELECT status, COUNT(*) as count FROM task_runs
     WHERE started_at >= ? AND started_at <= ?
     GROUP BY status`,
    [opts.fromTs, opts.toTs]
  );

  const runHistoryErrors = query<{ capability_key: string; outcome: string; count: number }>(
    `SELECT capability_key, outcome, COUNT(*) as count FROM run_history
     WHERE created_at >= ? AND created_at <= ? AND (outcome = 'error' OR outcome = 'unsupported')
     GROUP BY capability_key, outcome
     ORDER BY count DESC
     LIMIT ?`,
    [opts.fromTs, opts.toTs, opts.topErrors]
  );

  const totalTaskRuns = taskRuns.reduce((s, r) => s + r.count, 0);
  const byStatus: Record<string, number> = {};
  taskRuns.forEach((r) => {
    byStatus[r.status || 'unknown'] = r.count;
  });

  const prevFrom = opts.fromTs - (opts.toTs - opts.fromTs);
  const prevCount = query<{ count: number }>(
    'SELECT COUNT(*) as count FROM task_runs WHERE started_at >= ? AND started_at <= ?',
    [prevFrom, opts.fromTs - 1]
  )[0]?.count ?? 0;
  const trend = totalTaskRuns > prevCount ? 'up' : totalTaskRuns < prevCount ? 'down' : 'same';

  const summary = {
    period: { from: new Date(opts.fromTs).toISOString(), to: new Date(opts.toTs).toISOString() },
    task_runs: { total: totalTaskRuns, by_status: byStatus, trend, previous_period_count: prevCount },
    run_history_error_top: runHistoryErrors.map((r) => ({
      capability_key: r.capability_key,
      outcome: r.outcome,
      count: r.count,
    })),
  };

  if (opts.format === 'json') {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log('--- 監査ログ要約 ---');
  console.log(`期間: ${summary.period.from} 〜 ${summary.period.to}`);
  console.log(`task_runs 合計: ${summary.task_runs.total} (前期間: ${summary.task_runs.previous_period_count}, 傾向: ${summary.task_runs.trend})`);
  console.log('status 別:', summary.task_runs.by_status);
  console.log(`run_history エラー Top${opts.topErrors}:`);
  summary.run_history_error_top.forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.capability_key} (${r.outcome}): ${r.count}`);
  });
}

main();
