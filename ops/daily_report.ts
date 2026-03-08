#!/usr/bin/env tsx
/**
 * 定例報告用 Markdown 雛形生成
 * オプションで audit データを組み込み可能（--with-audit で前日分を取得）。
 * 出力: 標準出力または --output でファイルへ。Discord 用短縮は --short。
 */

import { initDb, query } from '../src/drivers/db.js';
import { writeFileSync } from 'node:fs';

function parseArgs(): {
  date: string;
  output?: string;
  short: boolean;
  withAudit: boolean;
} {
  const args = process.argv.slice(2);
  const now = new Date();
  let date = now.toISOString().slice(0, 10);
  let output: string | undefined;
  let short = false;
  let withAudit = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date' && args[i + 1]) {
      date = args[++i];
    } else if (args[i] === '--output' && args[i + 1]) {
      output = args[++i];
    } else if (args[i] === '--short') {
      short = true;
    } else if (args[i] === '--with-audit') {
      withAudit = true;
    }
  }

  return { date, output, short, withAudit };
}

function main() {
  initDb();
  const { date, output, short: useShort, withAudit } = parseArgs();

  const dayStart = new Date(date + 'T00:00:00.000Z').getTime();
  const dayEnd = new Date(date + 'T23:59:59.999Z').getTime();

  let completed = 0;
  let failed = 0;
  let stopped = 0;
  let pending = 0;

  if (withAudit) {
    const rows = query<{ status: string; count: number }>(
      `SELECT status, COUNT(*) as count FROM task_runs
       WHERE started_at >= ? AND started_at <= ?
       GROUP BY status`,
      [dayStart, dayEnd]
    );
    rows.forEach((r) => {
      const s = (r.status || '').toLowerCase();
      if (s === 'ok') completed = r.count;
      else if (s === 'failed') failed = r.count;
      else if (s === 'stopped') stopped = r.count;
    });
    const pendingRow = query<{ count: number }>(
      'SELECT COUNT(*) as count FROM tasks WHERE status = ? AND created_at <= ?',
      ['pending', dayEnd]
    )[0];
    pending = pendingRow?.count ?? 0;
  }

  const lines: string[] = [];

  if (useShort) {
    lines.push(`【定例 ${date}】`);
    if (withAudit) {
      lines.push(`完了: ${completed} / 失敗: ${failed} / 停止: ${stopped} / 待機中: ${pending}`);
    } else {
      lines.push('（--with-audit で件数サマリを出力）');
    }
  } else {
    lines.push(`# 定例報告 ${date}`);
    lines.push('');
    lines.push('## サマリ');
    if (withAudit) {
      lines.push(`- 完了: ${completed}`);
      lines.push(`- 失敗: ${failed}`);
      lines.push(`- 停止: ${stopped}`);
      lines.push(`- 待機中: ${pending}`);
    } else {
      lines.push('- （`--with-audit` を付けると前日分の件数サマリを埋めます）');
    }
    lines.push('');
    lines.push('## 所感・対応');
    lines.push('- ');
    lines.push('');
    lines.push('## 次回予定');
    lines.push('- ');
  }

  const out = lines.join('\n');
  if (output) {
    writeFileSync(output, out, 'utf8');
    console.log(`書き出し: ${output}`);
  } else {
    console.log(out);
  }
}

main();
