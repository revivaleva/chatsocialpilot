#!/usr/bin/env tsx
/**
 * タスク一括登録（dry-run → 本実行 → 件数/runId 照合）
 * 入力: JSON 配列（presetId, containerId?, overrides?, waitMinutes?, queueName?）
 * 安全: --dry-run がデフォルト。--execute で初めて DB に書き込む。
 * シークレット: overrides はログに値を含めずキー名のみ表示する。
 */

import fs from 'node:fs';
import { initDb, query } from '../src/drivers/db.js';
import { enqueueTask } from '../src/services/taskQueue.js';

const DEFAULT_QUEUE = 'default';

interface TaskInput {
  presetId: number;
  containerId?: string | null;
  overrides?: Record<string, unknown>;
  waitMinutes?: number;
  queueName?: string;
  scheduledAt?: number;
  groupId?: string | null;
}

function loadPayload(pathOrStdin: string): Promise<TaskInput[]> {
  if (pathOrStdin === '-' || !pathOrStdin) {
    const chunks: string[] = [];
    process.stdin.setEncoding('utf8');
    return new Promise<TaskInput[]>((resolve, reject) => {
      process.stdin.on('data', (c) => chunks.push(c));
      process.stdin.on('end', () => {
        try {
          const raw = chunks.join('').trim();
          const data = raw ? JSON.parse(raw) : [];
          resolve(Array.isArray(data) ? data : [data]);
        } catch (e) {
          reject(e);
        }
      });
      process.stdin.on('error', reject);
    });
  }
  const raw = fs.readFileSync(pathOrStdin, 'utf8');
  const data = JSON.parse(raw);
  return Promise.resolve(Array.isArray(data) ? data : [data]);
}

function maskOverridesKeys(overrides?: Record<string, unknown>): string {
  if (!overrides || typeof overrides !== 'object') return '{}';
  const keys = Object.keys(overrides);
  return keys.length ? `{ ${keys.join(', ')} }` : '{}';
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || (!args.includes('--execute') && args.length > 0 && !args[0].startsWith('-'));
  const execute = args.includes('--execute');
  const pathArg = args.find((a) => a !== '--dry-run' && a !== '--execute' && !a.startsWith('--')) || '-';

  if (execute && dryRun) {
    console.error('--execute と --dry-run は同時に指定できません。');
    process.exit(1);
  }

  const runSync = async () => {
    let payload: TaskInput[];
    try {
      payload = await loadPayload(pathArg);
    } catch (e: unknown) {
      console.error('入力の読み込みに失敗しました:', e);
      process.exit(1);
    }

    if (!payload.length) {
      console.error('タスクが 0 件です。');
      process.exit(1);
    }

    initDb();

    const beforeCount = query<{ count: number }>('SELECT COUNT(*) as count FROM tasks')[0]?.count ?? 0;

    if (dryRun) {
      console.log('[dry-run] 登録は行いません。件数と例のみ表示します。');
      console.log(`対象件数: ${payload.length}`);
      const q = payload[0].queueName || DEFAULT_QUEUE;
      console.log(`例 runId 形式: run-${payload[0].presetId}-<timestamp>`);
      console.log(`例 overrides キー: ${maskOverridesKeys(payload[0].overrides)}`);
      if (payload.length > 1) {
        console.log(`2件目 overrides キー: ${maskOverridesKeys(payload[1].overrides)}`);
      }
      console.log(`現在の tasks 件数: ${beforeCount}`);
      console.log(`実行後のおおよその件数: ${beforeCount + payload.length}`);
      return;
    }

    if (!execute) {
      console.error('登録するには --execute を指定してください。事前確認は --dry-run で行います。');
      process.exit(1);
    }

    if (process.env.CONFIRM_EXECUTE !== '1') {
      console.error('本番登録の安全のため、--execute 実行時は環境変数 CONFIRM_EXECUTE=1 を設定してください。');
      console.error('例: CONFIRM_EXECUTE=1 npm run ops:register -- --execute path/to/tasks.json');
      process.exit(1);
    }

    const runIds: string[] = [];
    for (let i = 0; i < payload.length; i++) {
      const t = payload[i];
      const queueName = t.queueName || DEFAULT_QUEUE;
      try {
        const runId = enqueueTask(
          {
            presetId: t.presetId,
            containerId: t.containerId ?? undefined,
            overrides: t.overrides ?? {},
            waitMinutes: t.waitMinutes,
            scheduledAt: t.scheduledAt,
            groupId: t.groupId ?? undefined,
          },
          queueName
        );
        runIds.push(runId);
        if (i < 5) {
          console.log(`登録 ${i + 1}: runId=${runId} presetId=${t.presetId} overrides=${maskOverridesKeys(t.overrides)}`);
        }
      } catch (e: unknown) {
        console.error(`登録失敗 ${i + 1}:`, e);
        process.exit(1);
      }
    }
    if (payload.length > 5) {
      console.log(`... 他 ${payload.length - 5} 件`);
    }

    const afterCount = query<{ count: number }>('SELECT COUNT(*) as count FROM tasks')[0]?.count ?? 0;
    const expectedCount = beforeCount + payload.length;
    if (afterCount !== expectedCount) {
      console.error(`検証失敗: 期待件数 ${expectedCount}、実際 ${afterCount}`);
      process.exit(1);
    }

    const foundRunIds = query<{ runId: string }>(
      'SELECT runId FROM tasks WHERE runId IN (' + runIds.map(() => '?').join(',') + ')',
      runIds
    ).map((r) => r.runId);
    const missing = runIds.filter((id) => !foundRunIds.includes(id));
    if (missing.length > 0) {
      console.error('検証失敗: 以下の runId が DB に存在しません:', missing.slice(0, 5));
      if (missing.length > 5) console.error('... 他', missing.length - 5, '件');
      process.exit(1);
    }

    console.log(`登録完了: ${runIds.length} 件。tasks 総数: ${afterCount}。runId 照合 OK。`);
  };

  runSync().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

main();
