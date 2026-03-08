import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import * as PresetService from './presets.js';
import { logger } from '../utils/logger.js';
import { run as dbRun, query as dbQuery, memGet, memSet, transaction } from '../drivers/db.js';
import { loadSettings } from './appSettings.js';

/**
 * コンテナID（UUID）からコンテナ名（XID）を取得する
 * @param containerId コンテナID（UUID）
 * @returns コンテナ名（XID）、見つからない場合はnull
 */
function getContainerNameFromId(containerId: string): string | null {
  try {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const containerDbPath = process.env.DEFAULT_CB_DB || path.join(appData, 'container-browser', 'data.db');

    if (!fs.existsSync(containerDbPath)) {
      logger.event('task.container_name_from_id.db_not_found', { containerId, dbPath: containerDbPath }, 'warn');
      return null;
    }

    const containerDb = new Database(containerDbPath, { readonly: true });
    const containerRow = containerDb.prepare('SELECT name FROM containers WHERE id = ? LIMIT 1').get(containerId) as { name?: string } | undefined;
    containerDb.close();

    if (containerRow && containerRow.name) {
      const containerName = String(containerRow.name);
      logger.event('task.container_name_from_id.resolved', { containerId, containerName }, 'debug');
      return containerName;
    }

    logger.event('task.container_name_from_id.not_found', { containerId }, 'warn');
    return null;
  } catch (e: any) {
    logger.event('task.container_name_from_id.err', { containerId, err: String(e?.message || e) }, 'warn');
    return null;
  }
}

/**
 * グループ移動時にx_accountsテーブルを更新する共通関数
 * @param containerId コンテナID（UUID形式またはコンテナ名形式）
 * @param newGroupId 新しいグループID（nullの場合はグループ未所属）
 * @param movedAt 移動日時（UNIXタイムスタンプ）
 * @param previousGroupName 移動前のグループ名（指定されていない場合は自動取得）
 */
function updateXAccountGroupMoveInfo(containerId: string, newGroupId: string | null, movedAt: number, previousGroupName?: string | null): void {
  try {
    // 移動前のグループ情報を取得（引数で指定されていない場合のみ）
    let previousGroupNameValue = previousGroupName;
    if (previousGroupNameValue === undefined || previousGroupNameValue === null) {
      const previousMembership = dbQuery<any>(
        'SELECT cgm.group_id, cg.name as group_name FROM container_group_members cgm LEFT JOIN container_groups cg ON cgm.group_id = cg.id WHERE cgm.container_id = ? LIMIT 1',
        [String(containerId)]
      )[0];
      previousGroupNameValue = previousMembership?.group_name || '(グループ未所属)';
    }

    // container_idがUUID形式かコンテナ名形式かを判定
    const isUuidFormat = containerId.length === 36 && containerId.includes('-');

    // x_accountsテーブルを検索（UUID形式とコンテナ名形式の両方で試行）
    let xAccount = dbQuery<any>(
      'SELECT id FROM x_accounts WHERE container_id = ? LIMIT 1',
      [containerId]
    )[0];

    // 見つからない場合、形式を変換して再検索
    if (!xAccount) {
      if (isUuidFormat) {
        // UUID形式の場合、コンテナ名に変換して検索
        const containerName = getContainerNameFromId(containerId);
        if (containerName) {
          xAccount = dbQuery<any>(
            'SELECT id FROM x_accounts WHERE container_id = ? LIMIT 1',
            [containerName]
          )[0];
        }
      } else {
        // コンテナ名形式の場合、UUID形式に変換して検索
        const containerUuid = getContainerIdFromName(containerId);
        if (containerUuid) {
          xAccount = dbQuery<any>(
            'SELECT id FROM x_accounts WHERE container_id = ? LIMIT 1',
            [containerUuid]
          )[0];
        }
      }
    }

    if (xAccount) {
      dbRun(
        'UPDATE x_accounts SET last_group_name = ?, last_group_moved_at = ?, updated_at = ? WHERE id = ?',
        [previousGroupNameValue, movedAt, movedAt, xAccount.id]
      );
      logger.event('x_account.group_move_info.updated', {
        containerId,
        previousGroupName: previousGroupNameValue,
        newGroupId,
        movedAt
      }, 'debug');
    } else {
      logger.event('x_account.group_move_info.not_found', {
        containerId,
        isUuidFormat
      }, 'warn');
    }
  } catch (e: any) {
    logger.event('x_account.group_move_info.update_failed', {
      containerId,
      newGroupId,
      error: String(e?.message || e)
    }, 'error');
  }
}

/**
 * コンテナ名（XID）からコンテナID（UUID）を取得する
 * @param containerName コンテナ名（XID）
 * @returns コンテナID（UUID）、見つからない場合はnull
 */
function getContainerIdFromName(containerName: string): string | null {
  try {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const containerDbPath = process.env.DEFAULT_CB_DB || path.join(appData, 'container-browser', 'data.db');

    if (!fs.existsSync(containerDbPath)) {
      logger.event('task.container_id_from_name.db_not_found', { containerName, dbPath: containerDbPath }, 'warn');
      return null;
    }

    const containerDb = new Database(containerDbPath, { readonly: true });
    const containerRow = containerDb.prepare('SELECT id FROM containers WHERE name = ? LIMIT 1').get(containerName) as { id?: string } | undefined;
    containerDb.close();

    if (containerRow && containerRow.id) {
      const containerId = String(containerRow.id);
      logger.event('task.container_id_from_name.resolved', { containerName, containerId }, 'debug');
      return containerId;
    }

    logger.event('task.container_id_from_name.not_found', { containerName }, 'warn');
    return null;
  } catch (e: any) {
    logger.event('task.container_id_from_name.err', { containerName, err: String(e?.message || e) }, 'warn');
    return null;
  }
}

// Discord通知を送信する関数（連続失敗用）
async function sendDiscordNotification(webhookUrl: string, queueName: string, failureCount: number): Promise<void> {
  try {
    const queueDisplayName = getQueueDisplayName(queueName);
    const message = {
      content: `⚠️ **タスク実行が自動停止されました**\n\n` +
        `**キュー**: ${queueDisplayName}\n` +
        `**連続失敗回数**: ${failureCount}回\n` +
        `**停止時刻**: ${new Date().toLocaleString('ja-JP')}\n\n` +
        `設定画面から実行を再有効化してください。`
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      const text = await response.text();
      logger.event('task.discord_notification.error', {
        queueName,
        status: response.status,
        statusText: response.statusText,
        body: text.substring(0, 200),
      }, 'warn');
    } else {
      logger.event('task.discord_notification.sent', { queueName, failureCount }, 'info');
    }
  } catch (e: any) {
    logger.event('task.discord_notification.exception', {
      queueName,
      err: String(e?.message || e),
    }, 'error');
  }
}

// Discord通知を送信する関数（コンテナブラウザ接続失敗用）
async function sendDiscordNotificationForContainerBrowser(webhookUrl: string, queueName: string, stoppedTaskCount: number, host: string, port: number): Promise<void> {
  try {
    const queueDisplayName = getQueueDisplayName(queueName);
    const message = {
      content: `🔴 **コンテナブラウザ接続失敗によりタスクを停止しました**\n\n` +
        `**キュー**: ${queueDisplayName}\n` +
        `**停止したタスク数**: ${stoppedTaskCount}件\n` +
        `**接続先**: ${host}:${port}\n` +
        `**停止時刻**: ${new Date().toLocaleString('ja-JP')}\n\n` +
        `コンテナブラウザが起動していることを確認し、設定画面から実行を再有効化してください。`
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      const text = await response.text();
      logger.event('task.discord_notification.cb_conn.error', {
        queueName,
        status: response.status,
        statusText: response.statusText,
        body: text.substring(0, 200),
      }, 'warn');
    } else {
      logger.event('task.discord_notification.cb_conn.sent', { queueName, stoppedTaskCount }, 'info');
    }
  } catch (e: any) {
    logger.event('task.discord_notification.cb_conn.exception', {
      queueName,
      err: String(e?.message || e),
    }, 'error');
  }
}
import { createContainer, buildTypeAsEvalCode } from '../drivers/browser.js';
import { fetchVerificationCode } from './emailFetcher.js';
import type { RuntimeConfig } from '../types.js';
const cfg = loadSettings();
// Use variables so settings can be reloaded at runtime.
let CB_HOST = cfg.containerBrowserHost || '127.0.0.1';
let CB_PORT = Number(cfg.containerBrowserPort || 3001);

// 全タスク共通の待機時間を取得（KVストレージ優先、なければ runtime.json から読み込み）
// 設定がない場合や0の場合は待機しない（デフォルト0）
function getGlobalWaitMinutes(): number {
  // まずKVストレージを確認（UIから変更された値が即座に反映される）
  try {
    const kvValue = memGet('taskListBulkWaitMinutes');
    if (typeof kvValue === 'number' && Number.isFinite(kvValue) && kvValue >= 0) {
      logger.event('task.global_wait.kv', { value: kvValue, source: 'kv_number' }, 'debug');
      return kvValue;
    }
    // 文字列の場合も数値に変換を試みる
    if (typeof kvValue === 'string') {
      const parsed = Number(kvValue);
      if (Number.isFinite(parsed) && parsed >= 0) {
        logger.event('task.global_wait.kv', { value: parsed, source: 'kv_string', original: kvValue }, 'debug');
        return parsed;
      }
    }
    if (kvValue !== null && kvValue !== undefined) {
      logger.event('task.global_wait.kv.invalid', { value: kvValue, type: typeof kvValue }, 'warn');
    }
  } catch (e: any) {
    logger.event('task.global_wait.kv.err', { err: String(e?.message || e) }, 'warn');
  }
  // KVストレージに値がない場合、runtime.json から読み込む
  try {
    const runtimePath = path.resolve('config', 'runtime.json');
    if (fs.existsSync(runtimePath)) {
      const raw = fs.readFileSync(runtimePath, 'utf8');
      const config: RuntimeConfig = JSON.parse(raw);
      // defaultWaitMinutes が明示的に設定されている場合のみ使用、それ以外は0（待機しない）
      if (typeof config.defaultWaitMinutes === 'number' && Number.isFinite(config.defaultWaitMinutes) && config.defaultWaitMinutes >= 0) {
        logger.event('task.global_wait.runtime', { value: config.defaultWaitMinutes, source: 'runtime.json' }, 'debug');
        return config.defaultWaitMinutes;
      }
    }
  } catch (e: any) {
    logger.event('task.global_wait.load.err', { err: String(e?.message || e) }, 'warn');
  }
  logger.event('task.global_wait.default', { value: 0, source: 'default' }, 'debug');
  return 0; // デフォルト値：待機しない
}

export function reloadContainerBrowserConfig() {
  try {
    const s = loadSettings();
    CB_HOST = s.containerBrowserHost || '127.0.0.1';
    CB_PORT = Number(s.containerBrowserPort || 3001);
    logger.event('task.config.reload', { host: CB_HOST, port: CB_PORT }, 'info');
    return { host: CB_HOST, port: CB_PORT };
  } catch (e: any) {
    logger.event('task.config.reload.err', { err: String(e?.message || e) }, 'warn');
    return { host: CB_HOST, port: CB_PORT };
  }
}

function normalizeTimeoutSeconds(raw: unknown, fallback = 10) {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 1) return raw;
  if (typeof raw === 'string') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 1) return parsed;
  }
  return fallback;
}

export async function canConnectToContainerBrowser(timeoutMs = 2000): Promise<boolean> {
  // 瞬間的な再起動/ハング/accept詰まり等で一時的に接続できないケースがあるため、
  // 短い待機を挟んで数回リトライする（既存の呼び出し側はtimeoutMsを指定しているため互換性を維持）
  const attempts = 3;
  const retryDelayMs = 150;
  const perAttemptTimeout = Math.max(
    200,
    Math.floor((Math.max(200, timeoutMs) - retryDelayMs * (attempts - 1)) / attempts)
  );

  const tryOnce = (attemptTimeoutMs: number) =>
    new Promise<boolean>((resolve) => {
      try {
        const sock = net.createConnection({ host: CB_HOST, port: CB_PORT }, () => {
          try { sock.destroy(); } catch { }
          resolve(true);
        });
        sock.setTimeout(attemptTimeoutMs, () => {
          try { sock.destroy(); } catch { }
          resolve(false);
        });
        sock.on('error', () => {
          try { sock.destroy(); } catch { }
          resolve(false);
        });
      } catch (e) {
        resolve(false);
      }
    });

  for (let i = 0; i < attempts; i++) {
    const ok = await tryOnce(perAttemptTimeout);
    if (ok) return true;
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, retryDelayMs));
    }
  }
  return false;
}

function parsePresetStepsJson(stepsJson: string) {
  let parsed: any = [];
  try {
    parsed = JSON.parse(stepsJson || '[]');
  } catch {
    parsed = [];
  }
  let steps: any[] = [];
  let defaultTimeoutSeconds = 30;
  if (Array.isArray(parsed)) {
    steps = parsed;
  } else if (parsed && typeof parsed === 'object') {
    steps = Array.isArray(parsed.steps) ? parsed.steps : [];
    const candidateSecondsRaw = typeof parsed.defaultTimeoutSeconds !== 'undefined'
      ? parsed.defaultTimeoutSeconds
      : (typeof parsed.default_timeout_seconds !== 'undefined'
        ? parsed.default_timeout_seconds
        : undefined);
    let resolvedSeconds = candidateSecondsRaw;
    if (typeof parsed.defaultTimeoutMs === 'number' && Number.isFinite(parsed.defaultTimeoutMs)) {
      resolvedSeconds = Number(parsed.defaultTimeoutMs) / 1000;
    }
    defaultTimeoutSeconds = normalizeTimeoutSeconds(resolvedSeconds, 10);
  }
  return { steps, defaultTimeoutSeconds };
}

function resolveStepTimeoutMs(step: any, presetDefaultSeconds: number) {
  // forステップはサーバー側で処理されるため、タイムアウトを無効化（各内部ステップにタイムアウトがあるため）
  if (step && step.type === 'for') {
    return 0; // 0は無制限を意味する
  }
  if (!step || typeof step !== 'object') {
    return Math.max(1000, Math.round(presetDefaultSeconds * 1000));
  }
  const checkNumber = (val: any): number | null => {
    if (typeof val === 'number' && Number.isFinite(val) && val > 0) return val;
    return null;
  };
  const trySeconds = checkNumber(step.timeoutSeconds);
  if (trySeconds) {
    return Math.max(1000, Math.round(trySeconds * 1000));
  }
  if (step.options && typeof step.options === 'object' && typeof step.options.timeoutMs === 'number' && Number.isFinite(step.options.timeoutMs) && step.options.timeoutMs > 0) {
    return Math.max(1000, Math.round(step.options.timeoutMs));
  }
  const fallbackMs = checkNumber(step.timeoutMs);
  if (fallbackMs) {
    return Math.max(1000, Math.round(fallbackMs));
  }
  return Math.max(1000, Math.round(presetDefaultSeconds * 1000));
}

type Task = {
  id?: number;
  runId: string;
  presetId: number;
  containerId?: string;
  overrides?: any;
  scheduledAt?: number;
  groupId?: string;
  waitMinutes?: number;
  queueName?: string;
};

type WaitingStatus = 'waiting_success' | 'waiting_failed' | 'waiting_stopped';

type QueueState = {
  queue: Task[];
  running: boolean;
  executionEnabled: boolean;
  pendingScheduleTimer: NodeJS.Timeout | null;
  waitingTimers: Map<string, NodeJS.Timeout>;
  waitingResolvers: Map<string, () => void>;
  scheduleCheckRequested: boolean; // タイマー発火時にworkerループにタスクチェックを促すフラグ
};

const queues = new Map<string, QueueState>();
const DEFAULT_QUEUE_NAME = 'default';
const QUEUE_2_NAME = 'queue2';
const QUEUE_3_NAME = 'queue3';
const QUEUE_4_NAME = 'queue4';
const QUEUE_5_NAME = 'queue5';
const QUEUE_6_NAME = 'queue6';
const QUEUE_7_NAME = 'queue7';
const QUEUE_8_NAME = 'queue8';
const QUEUE_9_NAME = 'queue9';
const QUEUE_10_NAME = 'queue10';

// 全キューの名前配列
export const ALL_QUEUE_NAMES = [
  DEFAULT_QUEUE_NAME,
  QUEUE_2_NAME,
  QUEUE_3_NAME,
  QUEUE_4_NAME,
  QUEUE_5_NAME,
  QUEUE_6_NAME,
  QUEUE_7_NAME,
  QUEUE_8_NAME,
  QUEUE_9_NAME,
  QUEUE_10_NAME,
];

// キュー名から表示名へのマップ
const QUEUE_DISPLAY_NAMES: Record<string, string> = {
  [DEFAULT_QUEUE_NAME]: 'タスク1',
  [QUEUE_2_NAME]: 'タスク2',
  [QUEUE_3_NAME]: 'タスク3',
  [QUEUE_4_NAME]: 'タスク4',
  [QUEUE_5_NAME]: 'タスク5',
  [QUEUE_6_NAME]: 'タスク6',
  [QUEUE_7_NAME]: 'タスク7',
  [QUEUE_8_NAME]: 'タスク8',
  [QUEUE_9_NAME]: 'タスク9',
  [QUEUE_10_NAME]: 'タスク10',
};

// キュー名から表示名を取得する関数
function getQueueDisplayName(queueName: string): string {
  return QUEUE_DISPLAY_NAMES[queueName] || queueName;
}

// 各キューごとの連続失敗回数を追跡
const consecutiveFailureCounts = new Map<string, number>();

// 各キューごとのコンテナブラウザ接続失敗の連続回数を追跡
const consecutiveContainerBrowserConnectionFailures = new Map<string, number>();

// キュー状態の初期化
function getQueueState(queueName: string): QueueState {
  if (!queues.has(queueName)) {
    const storedExecutionEnabled = memGet(`executionEnabled_${queueName}`);
    // サーバー起動時は両方のキューを停止状態にする（明示的に有効化されるまで実行しない）
    const executionEnabled = typeof storedExecutionEnabled === 'boolean' ? storedExecutionEnabled : false;
    queues.set(queueName, {
      queue: [],
      running: false,
      executionEnabled,
      pendingScheduleTimer: null,
      waitingTimers: new Map(),
      waitingResolvers: new Map(),
      scheduleCheckRequested: false,
    });
  }
  return queues.get(queueName)!;
}

// 後方互換性のため、デフォルトキューの参照を保持
const defaultQueueState = () => getQueueState(DEFAULT_QUEUE_NAME);
const queue = defaultQueueState().queue;
let running = defaultQueueState().running;
let executionEnabled = defaultQueueState().executionEnabled;
let pendingScheduleTimer = defaultQueueState().pendingScheduleTimer;
const waitingTimers = defaultQueueState().waitingTimers;
const waitingResolvers = defaultQueueState().waitingResolvers;

let executionConnectivityIssue: string | null = null;

export function setExecutionConnectivityIssue(message: string | null) {
  if (message && String(message).trim()) {
    executionConnectivityIssue = String(message);
  } else {
    executionConnectivityIssue = null;
  }
}

export function getExecutionConnectivityIssue() {
  return executionConnectivityIssue;
}

function clearPendingTimer(queueName: string = DEFAULT_QUEUE_NAME) {
  const queueState = getQueueState(queueName);
  if (queueState.pendingScheduleTimer) {
    clearTimeout(queueState.pendingScheduleTimer);
    queueState.pendingScheduleTimer = null;
  }
}
function schedulePendingCheckFor(timeMs?: number, queueName: string = DEFAULT_QUEUE_NAME) {
  if (!timeMs || !Number.isFinite(timeMs)) return;
  const queueState = getQueueState(queueName);
  const delay = Math.max(timeMs - Date.now(), 0);
  if (delay <= 0) {
    // Time has already passed, start worker if not running AND execution is enabled
    if (!queueState.running && queueState.executionEnabled) {
      startWorker(queueName).catch((e) => logger.event('task.worker.err', { err: String(e), queueName }, 'error'));
    } else if (queueState.running) {
      // Worker is already running, request immediate check
      queueState.scheduleCheckRequested = true;
      logger.event('task.schedule.check_requested', { queueName }, 'info');
    }
    return;
  }
  clearPendingTimer(queueName);
  queueState.pendingScheduleTimer = setTimeout(() => {
    queueState.pendingScheduleTimer = null;
    // Start worker if not running AND execution is enabled, otherwise request immediate check
    if (!queueState.running && queueState.executionEnabled) {
      startWorker(queueName).catch((e) => logger.event('task.worker.err', { err: String(e), queueName }, 'error'));
    } else if (queueState.running) {
      // Worker is already running, request immediate check
      queueState.scheduleCheckRequested = true;
      logger.event('task.schedule.check_requested', { queueName }, 'info');
    }
  }, delay);
}

function scheduleNearestPendingTask(queueName: string = DEFAULT_QUEUE_NAME) {
  try {
    const now = Date.now();
    const nextRow: any = dbQuery('SELECT MIN(scheduled_at) AS next FROM tasks WHERE status = ? AND scheduled_at > ? AND queue_name = ?', ['pending', now, queueName]);
    if (nextRow && nextRow.next && Number.isFinite(nextRow.next)) {
      schedulePendingCheckFor(nextRow.next, queueName);
    }
  } catch (e: any) {
    logger.event('task.schedule-next.err', { err: String(e?.message || e), queueName }, 'warn');
  }
}

function hasWaitingTasks(queueName: string = DEFAULT_QUEUE_NAME) {
  try {
    // Before checking if there are waiting tasks, sweep expired ones
    sweepWaitingTasksSync(queueName);
    const rows: any[] = dbQuery('SELECT 1 FROM tasks WHERE status IN (?,?,?) AND queue_name = ? LIMIT 1', ['waiting_success', 'waiting_failed', 'waiting_stopped', queueName]);
    return Array.isArray(rows) && rows.length > 0;
  } catch (e: any) {
    logger.event('task.worker.waiting_check.err', { err: String(e?.message || e), queueName }, 'warn');
    return false;
  }
}

function waitWithCancellation(runId: string, waitMinutes: number, queueName: string = DEFAULT_QUEUE_NAME) {
  const delayMs = Math.max(0, Math.round(waitMinutes * 60000));
  logger.event('task.waiting.cancellation', { runId, waitMinutes, delayMs }, 'info');
  const queueState = getQueueState(queueName);
  return new Promise<void>((resolve) => {
    let timer: NodeJS.Timeout | null = null;
    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      queueState.waitingTimers.delete(runId);
      queueState.waitingResolvers.delete(runId);
      resolve();
    };
    timer = setTimeout(cleanup, delayMs);
    queueState.waitingTimers.set(runId, timer);
    queueState.waitingResolvers.set(runId, cleanup);
  });
}

function nowTs() {
  const base = new Date().toISOString().replace(/[:.]/g, '-');
  const randomSuffix = Math.floor(Math.random() * 900000 + 100000);
  return `${base}-${randomSuffix}`;
}

function ensureLogsDir() {
  const d = path.resolve('logs');
  try { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); } catch { }
  return d;
}

export function enqueueTask(task: Omit<Task, 'runId'>, queueName: string = DEFAULT_QUEUE_NAME) {
  const runId = `run-${task.presetId}-${nowTs()}`;
  // タスクごとの waitMinutes は無視（後方互換のためDBには保存するが使用しない）
  // 実際の待機時間は全タスク共通の設定（getGlobalWaitMinutes）を使用
  // DB保存用の値（実際の待機時間には使用されない）
  const normalizedWaitMinutes = Number.isFinite(task.waitMinutes ?? NaN) ? task.waitMinutes : 0;
  const t: Task = Object.assign({ runId, waitMinutes: normalizedWaitMinutes, queueName }, task);
  const queueState = getQueueState(queueName);
  const now = Date.now();
  const shouldQueue = !t.scheduledAt || t.scheduledAt <= now;
  if (shouldQueue) {
    queueState.queue.push(t);
  } else {
    schedulePendingCheckFor(t.scheduledAt, queueName);
  }
  // Reduced noisy logging: only record enqueue at debug level. Keep DB/error logs as warnings/errors.
  logger.event('task.enqueue', { runId, presetId: task.presetId, queueName }, 'debug');
  // persist task to DB
  try {
    dbRun(
      'INSERT INTO tasks(runId, preset_id, container_id, overrides_json, scheduled_at, status, created_at, updated_at, group_id, wait_minutes, queue_name) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      [runId, task.presetId, task.containerId || null, JSON.stringify(task.overrides || {}), task.scheduledAt || null, 'pending', Date.now(), Date.now(), task.groupId || null, normalizedWaitMinutes, queueName]
    );
  } catch (e: any) {
    logger.event('task.enqueue.db.err', { err: String(e?.message || e), runId, queueName }, 'warn');
  }
  // start worker if not running AND execution is enabled
  if (!queueState.running && queueState.executionEnabled) {
    startWorker(queueName).catch((e) => logger.event('task.worker.err', { err: String(e), queueName }, 'error'));
  }
  return runId;
}

export function setExecutionEnabled(enabled: boolean, queueName: string = DEFAULT_QUEUE_NAME) {
  const queueState = getQueueState(queueName);
  queueState.executionEnabled = !!enabled;
  logger.event('task.execution.toggle', { enabled: queueState.executionEnabled, queueName }, queueState.executionEnabled ? 'info' : 'warn');
  try { memSet(`executionEnabled_${queueName}`, queueState.executionEnabled); } catch (e) { logger.event('kv.set.err', { err: String(e), queueName }, 'warn'); }
  // If execution is enabled and worker is not running, start it
  if (queueState.executionEnabled && !queueState.running) {
    startWorker(queueName).catch((e) => logger.event('task.worker.err', { err: String(e), queueName }, 'error'));
  }
  // 後方互換性のため、デフォルトキューの状態も更新
  if (queueName === DEFAULT_QUEUE_NAME) {
    executionEnabled = queueState.executionEnabled;
  }
  return queueState.executionEnabled;
}

export function isExecutionEnabled(queueName: string = DEFAULT_QUEUE_NAME) {
  const queueState = getQueueState(queueName);
  return queueState.executionEnabled;
}

async function callExec(body: any) {
  const url = `http://${CB_HOST}:${CB_PORT}/internal/exec`;
  const timeoutMs = (body?.options?.timeoutMs && Number.isFinite(body.options.timeoutMs) && body.options.timeoutMs > 0)
    ? Math.max(1000, Math.round(body.options.timeoutMs))
    : 60000; // デフォルト60秒

  const requestBody = JSON.stringify(body);
  const maxRetries = 3;
  const retryDelays = [50, 100, 200]; // 指数バックオフ（ms）

  let lastError: any = null;
  let lastResult: any = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, timeoutMs);

    const requestStartTime = Date.now();

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
        signal: abortController.signal,
      });

      clearTimeout(timeoutId);
      const elapsedMs = Date.now() - requestStartTime;
      const txt = await res.text();

      let parsedBody: any;
      try {
        parsedBody = JSON.parse(txt);
      } catch (parseErr) {
        parsedBody = txt;
      }

      const result = {
        status: res.status,
        ok: res.ok,
        body: parsedBody,
      };

      // HTTPエラーステータスの場合もログに記録
      if (!res.ok) {
        logger.event('task.callExec.http_error', {
          url,
          status: res.status,
          statusText: res.statusText,
          elapsedMs,
          attempt: attempt + 1,
          bodyPreview: typeof parsedBody === 'string' ? parsedBody.substring(0, 200) : JSON.stringify(parsedBody).substring(0, 200),
          command: body?.command || 'unknown',
          contextId: body?.contextId || 'unknown',
        }, 'warn');
      }

      // 成功した場合は即座に返す
      return result;
    } catch (e: any) {
      clearTimeout(timeoutId);
      const elapsedMs = Date.now() - requestStartTime;

      // エラーの種類を判定
      const errorType = e?.name || 'UnknownError';
      const errorCode = e?.code || e?.errno || null;
      const isTimeout = errorType === 'AbortError' || errorCode === 'ETIMEDOUT' || e?.message?.includes('timeout');
      const isNetworkError = errorType === 'TypeError' || errorCode === 'ECONNREFUSED' || errorCode === 'ENOTFOUND' || e?.message?.includes('fetch failed');
      const isAbort = errorType === 'AbortError';

      // 即座に失敗（< 100ms）かつネットワークエラーの場合のみリトライ
      const shouldRetry = attempt < maxRetries &&
        isNetworkError &&
        !isTimeout &&
        elapsedMs < 100;

      // 詳細なエラー情報をログに記録
      logger.event('task.callExec.error', {
        url,
        errorType,
        errorCode,
        errorMessage: String(e?.message || e),
        errorStack: e?.stack ? e.stack.substring(0, 500) : null,
        elapsedMs,
        timeoutMs,
        isTimeout,
        isNetworkError,
        isAbort,
        attempt: attempt + 1,
        willRetry: shouldRetry,
        command: body?.command || 'unknown',
        contextId: body?.contextId || 'unknown',
        bodyPreview: requestBody.substring(0, 200),
      }, shouldRetry ? 'warn' : 'error');

      // エラーレスポンスを構築
      const errorResult = {
        status: isTimeout ? 408 : (isNetworkError ? 503 : 500),
        ok: false,
        body: {
          ok: false,
          error: isTimeout
            ? 'TIMEOUT'
            : isNetworkError
              ? 'NETWORK_ERROR'
              : 'EXECUTION_ERROR',
          errorType,
          errorCode,
          errorMessage: String(e?.message || e),
          timeoutMs,
          elapsedMs,
        },
        errorDetail: {
          type: errorType,
          code: errorCode,
          message: String(e?.message || e),
          stack: e?.stack,
          isTimeout,
          isNetworkError,
        },
      };

      lastError = e;
      lastResult = errorResult;

      // リトライ可能な場合は待機してリトライ
      if (shouldRetry) {
        const delayMs = retryDelays[attempt];
        logger.event('task.callExec.retry', {
          url,
          attempt: attempt + 1,
          maxRetries: maxRetries + 1,
          delayMs,
          elapsedMs,
          errorType,
          command: body?.command || 'unknown',
          contextId: body?.contextId || 'unknown',
        }, 'info');

        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue; // リトライ
      } else {
        // リトライしない場合は即座にエラーを返す
        return errorResult;
      }
    }
  }

  // すべてのリトライが失敗した場合、最後のエラーを返す
  return lastResult;
}

function normalizeExecResult(resp: { status: number; ok?: boolean; body: any }) {
  if (!resp || !resp.body || typeof resp.body !== 'object') return null;
  if (resp.body.result && typeof resp.body.result === 'object') return resp.body.result;
  if (resp.body.commandResult && resp.body.commandResult.result && typeof resp.body.commandResult.result === 'object') return resp.body.commandResult.result;
  return resp.body;
}

function isStopResponse(resp: { status: number; ok?: boolean; body: any }) {
  const body = normalizeExecResult(resp);
  if (!body) return false;
  const statusText = String(body.status || '').toLowerCase();
  if (statusText === 'stopped') return true;
  // スキップされた場合は停止と判定しない
  if (body.skipped === true) return false;
  // stoppedフラグが明示的にtrueの場合も停止と判定
  if (body.stopped === true) return true;
  // NEW: treat any explicit didAction === false as a stop condition per spec
  if (body.didAction === false) return true;
  return false;
}

type RunTaskFinalStatus = 'ok' | 'failed' | 'stopped';

async function closeContainer(containerId: string, timeoutMs = 30000): Promise<{ status?: number; ok: boolean; body?: any; error?: string; closed?: boolean; fallback?: boolean; reason?: string }> {
  logger.event('task.close_container.call', { containerId, timeoutMs }, 'info');
  try {
    const url = `http://${CB_HOST}:${CB_PORT}/internal/export-restored/close`;
    logger.event('task.close_container.request', { containerId, url }, 'info');
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: containerId, timeoutMs }) });
    const j = await res.json().catch(() => ({ ok: false }));
    const result = { status: res.status, ok: res.ok, body: j };
    logger.event('task.close_container.response', {
      containerId,
      status: res.status,
      ok: res.ok,
      bodyOk: j.ok,
      closed: j.closed,
      bodyJson: JSON.stringify(j).substring(0, 200)
    }, res.ok ? 'info' : 'warn');
    return result;
  } catch (e: any) {
    logger.event('task.close_container.error', { containerId, err: String(e?.message || e), stack: e?.stack?.substring(0, 200) }, 'error');
    return { ok: false, error: String(e?.message || e) };
  }
}

function gatherOverrideVars(overrides: any) {
  const provided: Record<string, any> = {};
  if (!overrides || typeof overrides !== 'object') return provided;
  const merge = (source: any) => {
    if (!source || typeof source !== 'object') return;
    Object.keys(source).forEach((key) => {
      if (typeof source[key] !== 'undefined') provided[key] = source[key];
    });
  };
  merge(overrides.vars);
  merge(overrides.params);
  merge(overrides.payload);
  merge(overrides.overrides);
  Object.keys(overrides).forEach((key) => {
    if (!['vars', 'params', 'payload', 'overrides'].includes(key)) {
      const value = overrides[key];
      if (typeof value !== 'undefined') provided[key] = value;
    }
  });
  return provided;
}

async function runTask(task: Task): Promise<RunTaskFinalStatus> {
  const logsDir = ensureLogsDir();
  const logPath = path.join(logsDir, `${task.runId}.json`);
  let actualContainerId: string | undefined = task.containerId;
  const runLog: any = { runId: task.runId, presetId: task.presetId, containerId: task.containerId || null, start: new Date().toISOString(), steps: [] };
  logger.event('task.run.start', { runId: task.runId, presetId: task.presetId, containerId: task.containerId || null }, 'info');
  let finalStatus: RunTaskFinalStatus = 'failed';
  let stopped = false;
  let openedByExport = false;
  let postLibraryItem: any = null; // Declare outside try block to ensure it's accessible in finally
  const gatheredVars = gatherOverrideVars(task.overrides);
  // 投稿ライブラリ未使用でもプリセットが {{db_post_media_paths}}/{{db_post_content}} を参照する場合に「template variables missing」を防ぐ
  if (gatheredVars.db_post_media_paths === undefined) gatheredVars.db_post_media_paths = [];
  if (gatheredVars.db_post_content === undefined) gatheredVars.db_post_content = '';

  // プリセット18（プロフィール変更）: 最初に overrides を gatheredVars に反映する（x_accounts 読み込みより前）
  // プリセットは {{db_profile_name}} / {{db_profile_bio}} / {{db_profile_banner_image_path}} 等を参照するため必須。
  // task.overrides が空の場合は DB の tasks.overrides_json を runId で再取得する（ワーカーがDBから取得した際の不整合対策）
  const presetIdNum = Number(task.presetId);
  if (presetIdNum === 18) {
    let o: Record<string, unknown> = task.overrides && typeof task.overrides === 'object' ? (task.overrides as Record<string, unknown>) : {};
    const hasProfileData = o && (o.name != null && String(o.name).trim() !== '') || (o.bio != null && String(o.bio).trim() !== '');
    if (!hasProfileData && task.runId) {
      try {
        const rows = dbQuery<{ overrides_json: string }>('SELECT overrides_json FROM tasks WHERE runId = ? LIMIT 1', [task.runId]);
        if (rows && rows.length > 0 && rows[0].overrides_json) {
          const parsed = JSON.parse(rows[0].overrides_json) as Record<string, unknown>;
          if (parsed && typeof parsed === 'object') o = parsed;
          logger.event('task.preset18.overrides_loaded_from_db', { runId: task.runId }, 'info');
        }
      } catch (_e) { /* ignore */ }
    }
    if (o.name != null && String(o.name).trim() !== '') {
      const nameVal = String(o.name).trim();
      gatheredVars.name = nameVal;
      gatheredVars.display_name = nameVal;
      gatheredVars.account_name = nameVal;
      gatheredVars.db_profile_name = nameVal;
    }
    if (o.bio != null && String(o.bio).trim() !== '') {
      gatheredVars.bio = String(o.bio).trim();
      gatheredVars.db_profile_bio = gatheredVars.bio;
    }
    if (o.location != null && String(o.location).trim() !== '') {
      gatheredVars.location = String(o.location).trim();
      gatheredVars.db_profile_location = gatheredVars.location;
    }
    if (o.website != null && String(o.website).trim() !== '') {
      gatheredVars.website = String(o.website).trim();
      gatheredVars.db_profile_website = gatheredVars.website;
    }
    if (o.avatar_image_path != null && String(o.avatar_image_path).trim() !== '') {
      gatheredVars.avatar_image_path = String(o.avatar_image_path).trim();
      gatheredVars.db_profile_avatar_image_path = gatheredVars.avatar_image_path;
    }
    if (o.banner_image_path != null && String(o.banner_image_path).trim() !== '') {
      gatheredVars.banner_image_path = String(o.banner_image_path).trim();
      gatheredVars.db_profile_banner_image_path = gatheredVars.banner_image_path;
    }
    logger.event('task.preset18.overrides_applied', {
      runId: task.runId,
      hasName: !!gatheredVars.db_profile_name,
      hasBio: !!gatheredVars.db_profile_bio,
      hasAvatar: !!gatheredVars.db_profile_avatar_image_path,
      hasBanner: !!gatheredVars.db_profile_banner_image_path,
    }, 'info');
  }

  // containerUuidForApiをブロック外で定義（Banned判定で参照するため）
  let containerUuidForApi: string | null = null;

  // db_*パラメータは常にDBから取得（overridesの値は無視）
  // container_idからx_accountsテーブルを参照して各種パラメータを取得
  // x_accountsテーブルのcontainer_idはコンテナ名（XID）で保持されていることを前提とする
  if (task.containerId) {
    try {
      const containerIdStr = String(task.containerId);

      // UUID形式かどうかを判定
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(containerIdStr);

      let containerNameForLookup: string | null = null;

      if (isUuid) {
        // UUID形式の場合、コンテナDBからコンテナ名（XID）を取得
        // （後方互換性のため、UUID形式でも処理可能にする）
        try {
          const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
          const containerDbPath = process.env.DEFAULT_CB_DB || path.join(appData, 'container-browser', 'data.db');

          if (fs.existsSync(containerDbPath)) {
            const containerDb = new Database(containerDbPath, { readonly: true });
            const containerRow = containerDb.prepare('SELECT name FROM containers WHERE id = ? LIMIT 1').get(containerIdStr) as { name?: string } | undefined;
            if (containerRow && containerRow.name) {
              containerNameForLookup = String(containerRow.name);
              containerUuidForApi = containerIdStr; // UUID形式の場合はそのまま使用
              logger.event('task.container_name.resolved_from_uuid', { runId: task.runId, containerId: containerIdStr, containerName: containerNameForLookup }, 'debug');
            } else {
              // コンテナDBにコンテナが見つからない場合、x_accountsテーブルを直接UUIDで検索する（後方互換性のため）
              // ただし、通常はx_accounts.container_idはコンテナ名（XID）形式なので、見つからない可能性が高い
              logger.event('task.container_name.not_found_in_db', { runId: task.runId, containerId: containerIdStr, dbPath: containerDbPath }, 'warn');
            }
            containerDb.close();
          } else {
            logger.event('task.container_db.not_found', { runId: task.runId, containerId: containerIdStr, dbPath: containerDbPath }, 'warn');
          }
        } catch (e: any) {
          logger.event('task.container_name.resolve_err', { runId: task.runId, containerId: containerIdStr, err: String(e?.message || e) }, 'warn');
        }
      } else {
        // UUID形式でない場合、コンテナ名（XID）として扱う
        containerNameForLookup = containerIdStr;

        // コンテナ名からコンテナID（UUID）を取得
        containerUuidForApi = getContainerIdFromName(containerNameForLookup);
        if (containerUuidForApi) {
          actualContainerId = containerUuidForApi; // コンテナブラウザAPIで使用するUUIDを設定
          logger.event('task.container_uuid.resolved_from_name', { runId: task.runId, containerName: containerNameForLookup, containerUuid: containerUuidForApi }, 'debug');
        } else {
          logger.event('task.container_uuid.not_found', { runId: task.runId, containerName: containerNameForLookup }, 'warn');
          // UUIDが見つからない場合でも、コンテナ名のまま処理を続行（後方互換性）
        }
      }

      // db_container_nameをgatheredVarsに設定（テンプレート変数として使用可能にする）
      // db_プレフィックスにより、UIのパラメータ入力欄には表示されず、DBから自動取得される
      if (containerNameForLookup) {
        gatheredVars.db_container_name = containerNameForLookup;
        logger.event('task.db_container_name.set', { runId: task.runId, containerId: task.containerId, containerName: containerNameForLookup }, 'debug');
      }

      // コンテナ名でx_accountsテーブルを検索
      let xAccount: any = null;
      if (containerNameForLookup) {
        xAccount = dbQuery<any>('SELECT x_password, email, email_password, auth_token, ct0, profile_name, profile_bio, profile_location, profile_website, profile_avatar_image_path, profile_banner_image_path, proxy_id, twofa_code FROM x_accounts WHERE container_id = ? LIMIT 1', [containerNameForLookup])[0];
        if (xAccount) {
          logger.event('task.x_account.found_by_name', { runId: task.runId, containerId: task.containerId, containerName: containerNameForLookup, hasPassword: !!xAccount.x_password, hasEmail: !!xAccount.email }, 'debug');
        } else {
          logger.event('task.x_account.not_found_by_name', { runId: task.runId, containerId: task.containerId, containerName: containerNameForLookup }, 'debug');
        }
      }

      // コンテナ名で見つからない場合、UUIDでも検索を試みる（後方互換性）
      if (!xAccount && isUuid) {
        xAccount = dbQuery<any>('SELECT x_password, email, email_password, auth_token, ct0, profile_name, profile_bio, profile_location, profile_website, profile_avatar_image_path, profile_banner_image_path, proxy_id, twofa_code FROM x_accounts WHERE container_id = ? LIMIT 1', [containerIdStr])[0];
        if (xAccount) {
          logger.event('task.x_account.found_by_uuid', { runId: task.runId, containerId: containerIdStr, hasPassword: !!xAccount.x_password, hasEmail: !!xAccount.email }, 'debug');
        } else {
          logger.event('task.x_account.not_found_by_uuid', { runId: task.runId, containerId: containerIdStr }, 'debug');
        }
      }

      if (xAccount) {
        // db_x_password: x_accounts.x_passwordから取得
        if (xAccount.x_password) {
          gatheredVars.db_x_password = String(xAccount.x_password);
          logger.event('task.db_x_password.loaded', { runId: task.runId, containerId: task.containerId, containerName: containerNameForLookup, hasPassword: !!gatheredVars.db_x_password }, 'debug');
        } else {
          logger.event('task.db_x_password.not_found', { runId: task.runId, containerId: task.containerId, containerName: containerNameForLookup, xAccountExists: true, xAccountHasOtherFields: !!xAccount.email || !!xAccount.auth_token }, 'warn');
        }

        // db_twofa_code: x_accounts.twofa_codeから取得（TOTPシークレットキー）
        if (xAccount.twofa_code && String(xAccount.twofa_code).trim() !== '') {
          gatheredVars.db_twofa_code = String(xAccount.twofa_code).trim();
          logger.event('task.db_twofa_code.loaded', { runId: task.runId, containerId: task.containerId, containerName: containerNameForLookup, hasTwofaCode: !!gatheredVars.db_twofa_code }, 'debug');
        } else {
          logger.event('task.db_twofa_code.not_found', { runId: task.runId, containerId: task.containerId, containerName: containerNameForLookup }, 'debug');
        }

        // db_email: x_accounts.emailから取得
        if (xAccount.email) {
          gatheredVars.db_email = String(xAccount.email);
          logger.event('task.db_email.loaded', { runId: task.runId, containerId: task.containerId, containerName: containerNameForLookup, hasEmail: !!gatheredVars.db_email }, 'debug');
        } else {
          logger.event('task.db_email.not_found', { runId: task.runId, containerId: task.containerId, containerName: containerNameForLookup }, 'warn');
        }

        // db_email_credential: x_accounts.email_passwordが既にemail:password形式の場合はそのまま使用
        // そうでない場合は、emailとemail_passwordを組み合わせる
        if (xAccount.email_password) {
          const emailPasswordStr = String(xAccount.email_password);
          // email:password形式かどうかを確認（:が含まれているか）
          if (emailPasswordStr.includes(':')) {
            // 既にemail:password形式なのでそのまま使用
            gatheredVars.db_email_credential = emailPasswordStr;
            logger.event('task.db_email_credential.loaded', { runId: task.runId, containerId: task.containerId, containerName: containerNameForLookup, source: 'email_password_field', hasCredential: !!gatheredVars.db_email_credential }, 'debug');
          } else if (xAccount.email) {
            // email:password形式ではない場合、emailとemail_passwordを組み合わせる
            gatheredVars.db_email_credential = `${String(xAccount.email)}:${emailPasswordStr}`;
            logger.event('task.db_email_credential.loaded', { runId: task.runId, containerId: task.containerId, containerName: containerNameForLookup, source: 'combined', hasCredential: !!gatheredVars.db_email_credential }, 'debug');
          } else {
            logger.event('task.db_email_credential.not_found', { runId: task.runId, containerId: task.containerId, containerName: containerNameForLookup, hasEmail: false, hasEmailPassword: true }, 'warn');
          }
        } else {
          logger.event('task.db_email_credential.not_found', { runId: task.runId, containerId: task.containerId, containerName: containerNameForLookup, hasEmail: !!xAccount.email, hasEmailPassword: false }, 'warn');
        }

        // db_new_email: プリセットID 22（メールアドレス変更）の場合は、初期化時に設定しない
        // ステップ4の前処理でemail_accountsから新しいメールアドレスを自動取得する
        if (task.presetId !== 22) {
          // プリセットID 22以外の場合のみ、x_accounts.emailから取得
          if (xAccount.email) {
            gatheredVars.db_new_email = String(xAccount.email);
            logger.event('task.db_new_email.loaded', { runId: task.runId, containerId: task.containerId, containerName: containerNameForLookup, email: gatheredVars.db_new_email }, 'debug');
          } else {
            logger.event('task.db_new_email.not_found', { runId: task.runId, containerId: task.containerId, containerName: containerNameForLookup, xAccountExists: true }, 'warn');
          }
        } else {
          logger.event('task.db_new_email.skipped_for_preset22', { runId: task.runId, containerId: task.containerId, containerName: containerNameForLookup, presetId: task.presetId }, 'debug');
        }

        // プロフィールデータを取得（プリセット18用）
        // db_profile_name: x_accounts.profile_nameから取得
        if (xAccount.profile_name !== null && xAccount.profile_name !== undefined) {
          gatheredVars.db_profile_name = String(xAccount.profile_name);
          logger.event('task.db_profile_name.loaded', { runId: task.runId, containerId: task.containerId, containerName: containerNameForLookup, hasValue: !!gatheredVars.db_profile_name }, 'debug');
        }

        // db_profile_bio: x_accounts.profile_bioから取得
        if (xAccount.profile_bio !== null && xAccount.profile_bio !== undefined) {
          gatheredVars.db_profile_bio = String(xAccount.profile_bio);
          logger.event('task.db_profile_bio.loaded', { runId: task.runId, containerId: task.containerId, containerName: containerNameForLookup, hasValue: !!gatheredVars.db_profile_bio }, 'debug');
        }

        // db_profile_location: x_accounts.profile_locationから取得（空文字列も有効）
        if (xAccount.profile_location !== null && xAccount.profile_location !== undefined) {
          gatheredVars.db_profile_location = String(xAccount.profile_location);
          logger.event('task.db_profile_location.loaded', { runId: task.runId, containerId: task.containerId, containerName: containerNameForLookup, hasValue: true }, 'debug');
        }

        // db_profile_website: x_accounts.profile_websiteから取得（空文字列も有効）
        if (xAccount.profile_website !== null && xAccount.profile_website !== undefined) {
          gatheredVars.db_profile_website = String(xAccount.profile_website);
          logger.event('task.db_profile_website.loaded', { runId: task.runId, containerId: task.containerId, containerName: containerNameForLookup, hasValue: true }, 'debug');
        }

        // db_profile_avatar_image_path: x_accounts.profile_avatar_image_pathから取得
        if (xAccount.profile_avatar_image_path !== null && xAccount.profile_avatar_image_path !== undefined) {
          gatheredVars.db_profile_avatar_image_path = String(xAccount.profile_avatar_image_path);
          logger.event('task.db_profile_avatar_image_path.loaded', { runId: task.runId, containerId: task.containerId, containerName: containerNameForLookup, hasValue: !!gatheredVars.db_profile_avatar_image_path }, 'debug');
        }

        // db_profile_banner_image_path: x_accounts.profile_banner_image_pathから取得
        if (xAccount.profile_banner_image_path !== null && xAccount.profile_banner_image_path !== undefined) {
          gatheredVars.db_profile_banner_image_path = String(xAccount.profile_banner_image_path);
          logger.event('task.db_profile_banner_image_path.loaded', { runId: task.runId, containerId: task.containerId, containerName: containerNameForLookup, hasValue: !!gatheredVars.db_profile_banner_image_path }, 'debug');
        }

        // db_auth_token: x_accounts.auth_tokenから取得
        if (xAccount.auth_token) {
          gatheredVars.db_auth_token = String(xAccount.auth_token);
          logger.event('task.db_auth_token.loaded', { runId: task.runId, containerId: task.containerId, containerName: containerNameForLookup, hasValue: !!gatheredVars.db_auth_token }, 'debug');
        } else {
          logger.event('task.db_auth_token.not_found', { runId: task.runId, containerId: task.containerId, containerName: containerNameForLookup, xAccountExists: true }, 'warn');
        }

        // db_ct0: x_accounts.ct0から取得
        if (xAccount.ct0) {
          gatheredVars.db_ct0 = String(xAccount.ct0);
          logger.event('task.db_ct0.loaded', { runId: task.runId, containerId: task.containerId, containerName: containerNameForLookup, hasValue: !!gatheredVars.db_ct0 }, 'debug');
        } else {
          logger.event('task.db_ct0.not_found', { runId: task.runId, containerId: task.containerId, containerName: containerNameForLookup, xAccountExists: true }, 'warn');
        }

        // db_proxy: x_accounts.proxy_idから取得（proxiesテーブルを参照）
        if (xAccount.proxy_id) {
          try {
            const proxyInfo = dbQuery<any>(
              'SELECT proxy_info FROM proxies WHERE id = ? LIMIT 1',
              [xAccount.proxy_id]
            )[0];

            if (proxyInfo && proxyInfo.proxy_info) {
              gatheredVars.db_proxy = String(proxyInfo.proxy_info);
              logger.event('task.db_proxy.loaded', { runId: task.runId, containerId: task.containerId, containerName: containerNameForLookup, proxyId: xAccount.proxy_id, hasProxy: !!gatheredVars.db_proxy }, 'debug');
            } else {
              logger.event('task.db_proxy.not_found', { runId: task.runId, containerId: task.containerId, containerName: containerNameForLookup, proxyId: xAccount.proxy_id }, 'warn');
            }
          } catch (e: any) {
            logger.event('task.db_proxy.load_err', { runId: task.runId, containerId: task.containerId, containerName: containerNameForLookup, proxyId: xAccount.proxy_id, err: String(e?.message || e) }, 'warn');
          }
        } else {
          logger.event('task.db_proxy.no_proxy_id', { runId: task.runId, containerId: task.containerId, containerName: containerNameForLookup, xAccountExists: true }, 'debug');
        }
      } else {
        // x_accountsテーブルにレコードが見つからない場合、詳細な情報をログに記録
        let debugInfo: any = { runId: task.runId, containerId: task.containerId, containerName: containerNameForLookup, isUuid };
        if (containerNameForLookup) {
          // コンテナ名でx_accountsテーブルを検索した結果を確認
          const countByName = dbQuery<{ count: number }>('SELECT COUNT(*) as count FROM x_accounts WHERE container_id = ?', [containerNameForLookup])[0];
          debugInfo.searchedByName = containerNameForLookup;
          debugInfo.countByName = countByName?.count || 0;
        }
        if (isUuid) {
          // UUIDでも検索した結果を確認
          const countByUuid = dbQuery<{ count: number }>('SELECT COUNT(*) as count FROM x_accounts WHERE container_id = ?', [containerIdStr])[0];
          debugInfo.searchedByUuid = containerIdStr;
          debugInfo.countByUuid = countByUuid?.count || 0;
        }
        logger.event('task.x_account.not_found', debugInfo, 'warn');
      }
    } catch (e: any) {
      logger.event('task.db_params.load_err', { runId: task.runId, containerId: task.containerId, err: String(e?.message || e) }, 'warn');
    }
  } else {
    logger.event('task.db_params.no_container', { runId: task.runId }, 'warn');
  }

  // Bannedグループのアカウントチェック: タスク実行前にBannedグループに属している場合は停止扱いにする
  // container_group_membersテーブルのcontainer_idはUUID形式で保存されているため、UUID形式のIDでチェックする
  if (task.containerId) {
    try {
      // BannedグループのIDを取得
      const bannedGroupRows = dbQuery<any>('SELECT id FROM container_groups WHERE name = ? LIMIT 1', ['Banned']);
      if (bannedGroupRows && bannedGroupRows.length > 0) {
        const bannedGroupId = String(bannedGroupRows[0].id);

        // container_group_membersでBannedグループに属しているかチェック
        // container_idはUUID形式で保存されているため、UUID形式のIDでチェック
        let isBanned = false;
        const containerIdsToCheck: string[] = [];

        // containerUuidForApiが確定している場合（UUID形式）、それを最優先でチェック
        // コンテナID解決処理でcontainerUuidForApiが設定されている
        if (containerUuidForApi) {
          containerIdsToCheck.push(containerUuidForApi);
        }

        // task.containerIdがUUID形式の場合もチェック（念のため）
        const taskContainerIdStr = String(task.containerId);
        const isTaskContainerIdUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(taskContainerIdStr);
        if (isTaskContainerIdUuid && taskContainerIdStr !== containerUuidForApi) {
          containerIdsToCheck.push(taskContainerIdStr);
        }

        // actualContainerIdもチェック（念のため）
        if (actualContainerId && actualContainerId !== containerUuidForApi && actualContainerId !== taskContainerIdStr) {
          containerIdsToCheck.push(actualContainerId);
        }

        for (const checkContainerId of containerIdsToCheck) {
          if (!checkContainerId) continue;

          const memberRows = dbQuery<any>(
            'SELECT container_id FROM container_group_members WHERE container_id = ? AND group_id = ? LIMIT 1',
            [checkContainerId, bannedGroupId]
          );

          if (memberRows && memberRows.length > 0) {
            isBanned = true;
            logger.event('task.run.skip_banned', {
              runId: task.runId,
              containerId: task.containerId,
              checkedContainerId: checkContainerId,
              bannedGroupId,
              containerUuidForApi: containerUuidForApi || null,
            }, 'info');
            break;
          }
        }

        if (isBanned) {
          stopped = true;
          runLog.error = `タスクをスキップ: アカウントがBannedグループに属しています (containerId: ${task.containerId})`;
          runLog.banned = true; // Bannedフラグを設定（worker側で特別処理するため）
          logger.event('task.run.banned_detected', {
            runId: task.runId,
            containerId: task.containerId,
            bannedGroupId,
            containerUuidForApi: containerUuidForApi || null,
          }, 'info');
        } else {
          // デバッグ用: Banned判定が実行されたが、Bannedではなかった場合のログ
          logger.event('task.run.banned_check.passed', {
            runId: task.runId,
            containerId: task.containerId,
            containerUuidForApi: containerUuidForApi || null,
            checkedIds: containerIdsToCheck,
          }, 'debug');
        }
      }
    } catch (e: any) {
      logger.event('task.run.banned_check.err', {
        runId: task.runId,
        containerId: task.containerId,
        err: String(e?.message || e),
      }, 'warn');
      // エラーが発生した場合は処理を続行（Banned判定に失敗してもタスクは実行可能）
    }
  }

  function applyTemplate(src: string | null | undefined, vars: Record<string, any> | undefined, allowEmpty: boolean = false, escapeForJsString: boolean = false) {
    if (!src) return src;
    const s = String(src);
    // ネストしたプロパティに対応: {{variable.property.subproperty}} 形式をサポート
    const re = /\{\{([A-Za-z0-9_][A-Za-z0-9_.-]*)\}\}/g;
    const missing: string[] = [];
    const out = s.replace(re, (match, path) => {
      if (!vars) {
        missing.push(path);
        return allowEmpty ? '' : 'undefined';
      }
      // プロパティパスを分割（例: "pr_post_info.account_id" -> ["pr_post_info", "account_id"]）
      const parts = path.split('.');
      let value: any = vars;
      // ネストしたプロパティにアクセス
      for (const part of parts) {
        if (value === null || value === undefined || typeof value !== 'object') {
          missing.push(path);
          return allowEmpty ? '' : 'undefined';
        }
        value = value[part];
        if (value === undefined || value === null) {
          missing.push(path);
          return allowEmpty ? '' : 'undefined';
        }
      }
      let valueStr = String(value);
      // 空文字列の場合は undefined を返す（JavaScriptの || 演算子が機能するように）
      // ただし isEval の場合は変数宣言が壊れないように空文字列を返すか検討が必要（ここでは後方互換性のため維持しつつ、hasSkipLogicがtrueのときは空文字にする）
      if (valueStr === '' || valueStr.trim() === '') {
        return allowEmpty ? '' : 'undefined';
      }
      // evalステップのコード内の文字列リテラル内のテンプレート変数をエスケープ
      // 改行や特殊文字を含む値をJavaScript文字列リテラルとして安全に埋め込む
      // JSON.stringify()でエスケープし、外側のクォートを削除して文字列リテラル内に直接埋め込めるようにする
      if (escapeForJsString) {
        const escaped = JSON.stringify(valueStr);
        // JSON.stringify()の結果は "..." の形式なので、外側のクォートを削除
        return escaped.slice(1, -1);
      }
      return valueStr;
    });
    // 完全に未定義（varsに存在しない）場合のみエラーを投げる
    // 空文字列の場合は 'undefined' を返すため、エラーにはしない
    const trulyMissing = missing.filter(path => {
      if (!vars) return true;
      const parts = path.split('.');
      let value: any = vars;
      for (const part of parts) {
        if (value === null || value === undefined || typeof value !== 'object') return true;
        value = value[part];
        if (value === undefined || value === null) return true;
      }
      return false;
    });
    if (trulyMissing.length && !allowEmpty) {
      // db_プレフィックスが付いている変数が不足している場合、データベースから取得できなかった旨を示す
      const dbVars = trulyMissing.filter(v => v.startsWith('db_'));
      const otherVars = trulyMissing.filter(v => !v.startsWith('db_'));
      let errorMsg = 'template variables missing: ' + trulyMissing.join(',');
      if (dbVars.length > 0) {
        // container_nameが設定されている場合、それを優先的に使用
        const containerIdForMsg = (vars && vars.db_container_name) ? String(vars.db_container_name) : (task.containerId ? String(task.containerId) : null);
        if (containerIdForMsg) {
          errorMsg += ` (db_* variables should be loaded from x_accounts table for container_id: ${containerIdForMsg}. Check if the container exists in x_accounts table and has the required fields. If x_accounts record exists but x_password is NULL, please update the record with the password.)`;
        } else if (task.containerId) {
          errorMsg += ` (db_* variables should be loaded from x_accounts table for container_id: ${task.containerId}. Check if the container exists in x_accounts table and has the required fields.)`;
        }
      }
      throw new Error(errorMsg);
    }
    return out;
  }

  // Bannedグループのアカウントの場合、タスク実行をスキップして停止扱いで終了
  // ただし、finallyブロックでログファイルとtask_runsレコードを作成するため、tryブロック内で処理を続行する
  // stoppedフラグが設定されているため、ステップ実行ループは自動的にスキップされる

  try {
    const preset = PresetService.getPreset(task.presetId) as any;
    if (!preset) throw new Error('preset not found');

    // プリセットにコンテナ作成ステップがあるか確認
    const hasContainerStep = PresetService.presetHasContainerStep(task.presetId);

    // コンテナ名が指定されている場合、コンテナを作成/開く
    // container_nameが指定されていない場合は、task.containerIdから取得を試みる
    // task.containerIdがUUID形式でない場合（コンテナ名の場合）、それをcontainerNameとして使用
    let containerName: string | null = null;
    if (gatheredVars.db_container_name) {
      containerName = String(gatheredVars.db_container_name);
    } else if (gatheredVars.container_name) {
      // 後方互換性のため、container_nameも確認
      containerName = String(gatheredVars.container_name);
    } else if (task.overrides?.container_name) {
      containerName = String(task.overrides.container_name);
    } else if (task.containerId) {
      // task.containerIdがUUID形式でない場合（コンテナ名の場合）、それをcontainerNameとして使用
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(task.containerId));
      if (!isUuid) {
        containerName = String(task.containerId);
      } else {
        // UUID形式の場合、コンテナDBから名前を取得（gatheredVars.db_container_nameが設定されていない場合）
        // gatheredVars.db_container_nameは580-618行目で設定されるはずだが、設定されていない場合に備えてここでも取得を試みる
        try {
          const os = await import('node:os');
          const appData = os.platform() === 'win32' ? process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming') : path.join(os.homedir(), '.config');
          const dbPath = process.env.DEFAULT_CB_DB || path.join(appData, 'container-browser', 'data.db');
          if (fs.existsSync(dbPath)) {
            const Database = (await import('better-sqlite3')).default;
            const db = new Database(dbPath, { readonly: true });
            const row = db.prepare('SELECT name FROM containers WHERE id = ?').get(String(task.containerId)) as { name?: string } | undefined;
            db.close();
            if (row && row.name) {
              containerName = String(row.name);
              logger.event('task.container.uuid_to_name_in_container_name_resolution', { uuid: task.containerId, name: containerName }, 'info');
            } else {
              logger.event('task.container.uuid_not_found_in_db_in_container_name_resolution', { uuid: task.containerId }, 'warn');
            }
          }
        } catch (e: any) {
          logger.event('task.container.name_lookup_err_in_container_name_resolution', { uuid: task.containerId, err: String(e) }, 'warn');
        }
      }
    }

    // プリセットにコンテナステップがある場合、コンテナはステップ内で作成されるため、
    // ここでは先にコンテナを開かない（コンテナステップでcreateContainerが呼ばれる）
    // コンテナステップがない場合でも、最初のnavigateステップでコンテナが自動的に開かれるため、
    // ここではコンテナIDを設定するだけ
    if (containerName && !hasContainerStep) {
      // コンテナ名が指定されていて、コンテナステップがない場合、コンテナIDを設定
      // コンテナブラウザのAPIはUUIDで検索する必要があるため、名前からUUIDを取得する
      let containerIdForUse: string = String(containerName);

      // コンテナ名がUUID形式でない場合、コンテナDBからUUIDを取得
      const isUuidFormat = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(containerIdForUse);
      if (!isUuidFormat) {
        try {
          // コンテナDBからUUIDを取得
          const os = await import('node:os');
          const appData = os.platform() === 'win32' ? process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming') : path.join(os.homedir(), '.config');
          const dbPath = process.env.DEFAULT_CB_DB || path.join(appData, 'container-browser', 'data.db');
          if (fs.existsSync(dbPath)) {
            const Database = (await import('better-sqlite3')).default;
            const db = new Database(dbPath, { readonly: true });
            const row = db.prepare('SELECT id FROM containers WHERE name = ?').get(containerIdForUse) as { id: string } | undefined;
            db.close();
            if (row && row.id) {
              containerIdForUse = row.id; // UUIDに更新
              logger.event('task.container.name_to_uuid', { name: containerName, uuid: containerIdForUse }, 'info');
            } else {
              logger.event('task.container.name_not_found_in_db', { name: containerName }, 'warn');
              // DBに存在しない場合、名前のまま使用（コンテナブラウザのAPIが名前を直接受け付ける可能性があるため）
            }
          }
        } catch (e: any) {
          logger.event('task.container.uuid_lookup.err', { err: String(e) }, 'warn');
          // UUID取得に失敗しても続行（コンテナ名のまま使用）
        }
      }

      actualContainerId = containerIdForUse;
      logger.event('task.container.id_set', { runId: task.runId, containerName: containerName, containerId: containerIdForUse }, 'info');

      // コンテナは最初のnavigateステップで自動的に開かれるため、ここではIDを設定するだけ
      openedByExport = false;
      runLog.open = { ok: true, lastSessionId: null, containerId: actualContainerId, willOpenOnNavigate: true };
      runLog.containerId = actualContainerId;
    } else {
      // コンテナ名が指定されていない場合、またはコンテナステップがある場合
      // コンテナ作成ステップがある場合、containerIdがnullでも実行可能（コンテナ作成ステップでコンテナを作成）
      if (!hasContainerStep && !task.containerId) {
        throw new Error('containerId or container_name required');
      }
      if (task.containerId) {
        // コンテナIDが指定されている場合でも、コンテナを開く必要がある
        actualContainerId = String(task.containerId);

        // containerNameが設定されている場合（726-740行目で設定済み）、それを優先使用
        // そうでない場合、gatheredVars.db_container_nameが既に設定されている場合（580-618行目で設定済み）、それを優先使用
        // そうでない場合、UUID形式のIDから名前を取得
        if (containerName) {
          // containerNameが設定されている場合、それを使用
          actualContainerId = String(containerName);
          logger.event('task.container.use_container_name', { uuid: task.containerId, name: actualContainerId }, 'info');
        } else if (gatheredVars.db_container_name) {
          // 既に名前が取得済みの場合、それを使用
          actualContainerId = String(gatheredVars.db_container_name);
          logger.event('task.container.use_db_container_name', { uuid: task.containerId, name: actualContainerId }, 'info');
        } else {
          // コンテナ名がUUID形式でない場合、コンテナDBからUUIDを取得
          // コンテナブラウザのAPIはUUIDで検索する必要があるため、UUID形式でない場合はUUIDを取得する
          const isUuidFormat = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actualContainerId);
          if (!isUuidFormat) {
            // UUID形式でない場合（コンテナ名の場合）、コンテナDBからUUIDを取得
            try {
              const os = await import('node:os');
              const appData = os.platform() === 'win32' ? process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming') : path.join(os.homedir(), '.config');
              const dbPath = process.env.DEFAULT_CB_DB || path.join(appData, 'container-browser', 'data.db');
              if (fs.existsSync(dbPath)) {
                const Database = (await import('better-sqlite3')).default;
                const db = new Database(dbPath, { readonly: true });
                const row = db.prepare('SELECT id FROM containers WHERE name = ?').get(actualContainerId) as { id: string } | undefined;
                db.close();
                if (row && row.id) {
                  // UUIDに更新（openContainerはUUIDで検索するため）
                  actualContainerId = row.id;
                  logger.event('task.container.name_to_uuid', { name: task.containerId, uuid: actualContainerId }, 'info');
                } else {
                  logger.event('task.container.name_not_found_in_db', { name: actualContainerId }, 'warn');
                  // DBに存在しない場合、名前のまま試行（コンテナブラウザのAPIが名前を直接受け付ける可能性があるため）
                }
              }
            } catch (e: any) {
              logger.event('task.container.uuid_lookup.err', { err: String(e) }, 'warn');
              // UUID取得に失敗しても続行（コンテナ名のまま使用）
            }
          }
          // UUID形式の場合はそのまま使用（コンテナブラウザのAPIはUUIDで検索するため）
        }

        // コンテナは最初のnavigateステップで自動的に開かれるため、ここではIDを設定するだけ
        openedByExport = false;
        runLog.open = { ok: true, lastSessionId: null, containerId: actualContainerId, willOpenOnNavigate: true };
        runLog.containerId = actualContainerId;
      } else {
        // コンテナ作成ステップがある場合、containerIdがnullでも実行可能
        // コンテナ作成ステップでコンテナを作成するため、ここでは何もしない
        actualContainerId = null;
        openedByExport = false;
        runLog.open = { ok: true, lastSessionId: null, willCreateInStep: true };
      }
    }

    if (!runLog.open || !runLog.open.ok) throw new Error(`Container initialization failed: ${JSON.stringify(runLog.open)}`);

    // Load post library item if enabled
    if (preset.use_post_library) {
      postLibraryItem = await PresetService.getUnusedPostItem();
      if (postLibraryItem) {
        logger.event('task.post_library.loaded', { runId: task.runId, postId: postLibraryItem.id }, 'info');
        // Merge post library data into gathered vars
        gatheredVars.post_content = postLibraryItem.content;
        gatheredVars.post_media = postLibraryItem.media || [];
        gatheredVars.pr_post_library_id = postLibraryItem.id;
        // db_post_contentも設定（プリセット40などで使用）
        if (postLibraryItem.rewritten_content) {
          gatheredVars.db_post_content = postLibraryItem.rewritten_content;
        } else if (postLibraryItem.content) {
          gatheredVars.db_post_content = postLibraryItem.content;
        }
      } else {
        // 使用可能な投稿がない場合はタスクを失敗させる
        const errorMsg = '使用可能な投稿データが見つかりません。post_libraryに未使用の投稿データを追加してください。';
        logger.event('task.post_library.not_found', { runId: task.runId }, 'error');
        throw new Error(errorMsg);
      }
    }

    // Load post library item by ID if specified (for X投稿 with local media)
    // X投稿データのIDで指定された場合、投稿前に使用済みに変更する
    // パラメータ名の正規化: post_library_id（スネークケース）と postLibraryId（キャメルケース）の両方に対応
    const postLibraryIdRaw = task.overrides?.post_library_id || task.overrides?.postLibraryId || gatheredVars.post_library_id || gatheredVars.postLibraryId;
    if (postLibraryIdRaw && !postLibraryItem) {
      const postLibraryId = Number(postLibraryIdRaw);
      if (isNaN(postLibraryId) || postLibraryId <= 0) {
        throw new Error(`Invalid post_library_id: ${postLibraryIdRaw}`);
      }

      // バリデーション付きでデータ取得（未使用のもののみ）
      const postRecord = dbQuery<any>(
        `SELECT id, rewritten_content, media_paths, used, download_status 
         FROM post_library 
         WHERE id = ? 
           AND rewritten_content IS NOT NULL 
           AND rewritten_content != '' 
           AND (media_paths IS NULL OR media_paths = '' OR download_status = 'completed')
           AND used = 0`,
        [postLibraryId]
      )[0];

      if (!postRecord) {
        throw new Error(`Post library record ${postLibraryId} not found or invalid (missing rewritten_content, media not downloaded, or already used)`);
      }

      // 投稿前に使用済みに変更（ロック的な役割）
      const now = Date.now();
      dbRun(
        'UPDATE post_library SET used = 1, used_at = ?, updated_at = ? WHERE id = ?',
        [now, now, postLibraryId]
      );

      logger.event('task.post_library.marked_used_before_post', {
        runId: task.runId,
        postId: postLibraryId,
        usedAt: now
      }, 'info');

      // テンプレート変数に設定（db_プレフィックスでDBから自動取得されるパラメータとして設定）
      gatheredVars.db_post_content = postRecord.rewritten_content;
      gatheredVars.post_library_id = postRecord.id;
      gatheredVars.pr_post_library_id = postRecord.id;

      // media_pathsをカンマ区切りで分割して配列に変換（メディアがある場合のみ）
      if (postRecord.media_paths && String(postRecord.media_paths).trim() !== '') {
        const mediaPaths = String(postRecord.media_paths).split(',').map((p: string) => p.trim()).filter((p: string) => p);
        gatheredVars.db_post_media_paths = mediaPaths;
      } else {
        gatheredVars.db_post_media_paths = [];
      }

      // postLibraryItemを設定（既に使用済みに変更済みなので、成功時の更新処理は不要）
      postLibraryItem = { id: postRecord.id } as any;

      logger.event('task.post_library.loaded_by_id', {
        runId: task.runId,
        postId: postRecord.id,
        hasMedia: (gatheredVars.db_post_media_paths as string[]).length > 0,
        markedUsedBeforePost: true
      }, 'info');
    }

    // use_post_library 有効なのに投稿本文が空の場合はその場で失敗（取得漏れ・不整合の防止）
    if (preset.use_post_library && !(gatheredVars.db_post_content && String(gatheredVars.db_post_content).trim())) {
      const errorMsg = '使用可能な投稿データが見つかりません。post_libraryに未使用の投稿データを追加してください。';
      logger.event('task.post_library.no_content_after_load', { runId: task.runId }, 'error');
      throw new Error(errorMsg);
    }

    // execute preset steps sequentially
    // overrides.stepsが指定されている場合はそれを優先、そうでない場合はpreset.steps_jsonを使用
    const stepsJson = (task.overrides && task.overrides.steps && Array.isArray(task.overrides.steps))
      ? JSON.stringify(task.overrides.steps)
      : (preset.steps_json || '[]');

    const { steps, defaultTimeoutSeconds } = parsePresetStepsJson(stepsJson);

    // デバッグ: プリセットの読み込み結果を確認
    logger.event('task.preset.loaded', {
      runId: task.runId,
      presetId: task.presetId,
      stepsCount: steps.length,
      stepsWithFor: steps.filter((s: any) => s.type === 'for').length,
      forStepsDetails: steps.filter((s: any) => s.type === 'for').map((s: any, idx: number) => ({
        index: idx,
        hasSteps: !!(s.steps && Array.isArray(s.steps)),
        innerStepsCount: (s.steps && Array.isArray(s.steps)) ? s.steps.length : 0,
        innerStepsWithResultVar: (s.steps && Array.isArray(s.steps)) ? s.steps.filter((inner: any) => inner.result_var).length : 0,
        innerStepsDetails: (s.steps && Array.isArray(s.steps)) ? s.steps.map((inner: any, innerIdx: number) => ({
          index: innerIdx,
          type: inner.type,
          hasResultVar: !!inner.result_var,
          resultVar: inner.result_var || null
        })) : []
      }))
    }, 'info');

    // 投稿ライブラリ未使用でも for/items 等で db_post_media_paths を参照するプリセット用にデフォルトを設定（未設定時は空で「template variables missing」を防ぐ）
    if (gatheredVars.db_post_media_paths === undefined) {
      gatheredVars.db_post_media_paths = [];
    }
    if (gatheredVars.db_post_content === undefined) {
      gatheredVars.db_post_content = '';
    }

    for (let i = 0; i < steps.length; i++) {
      const st = steps[i];
      // Banned等でstoppedの場合はステップ実行前に即break（先頭1ステップも実行しない）
      if (stopped) {
        break;
      }

      // 「コンテナ指定」ステップの処理
      if (st.type === 'container' || st.type === 'open_container') {
        const containerNameRaw = st.container_name || st.containerName || (st.params && (st.params.container_name || st.params.containerName));
        if (!containerNameRaw) {
          runLog.steps.push({ index: i, step: st, result: null, error: 'container_name is required for container step' });
          runLog.error = 'container step missing container_name';
          throw new Error(runLog.error);
        }
        const containerName = applyTemplate(containerNameRaw, gatheredVars);
        if (!containerName || String(containerName).trim() === '') {
          runLog.steps.push({ index: i, step: st, result: null, error: 'container_name is empty after template substitution' });
          runLog.error = 'container_name is empty';
          throw new Error(runLog.error);
        }

        // コンテナ名（XID）でx_accountsテーブルからデータを取得
        const containerNameStr = String(containerName).trim();
        try {
          const xAccount = dbQuery<any>(
            'SELECT x_password, twofa_code, proxy_id FROM x_accounts WHERE container_id = ? LIMIT 1',
            [containerNameStr]
          )[0];

          if (xAccount) {
            // db_x_password: x_accounts.x_passwordから取得（既存の処理と重複するが、ここでも設定）
            if (xAccount.x_password) {
              gatheredVars.db_x_password = String(xAccount.x_password);
              logger.event('task.container.db_x_password.loaded', {
                runId: task.runId,
                containerName: containerNameStr,
                stepIndex: i,
                hasPassword: !!gatheredVars.db_x_password
              }, 'debug');
            } else {
              logger.event('task.container.db_x_password.not_found', {
                runId: task.runId,
                containerName: containerNameStr,
                stepIndex: i
              }, 'warn');
            }

            // db_twofa_code: x_accounts.twofa_codeから取得（TOTPシークレットキー）
            if (xAccount.twofa_code && String(xAccount.twofa_code).trim() !== '') {
              gatheredVars.db_twofa_code = String(xAccount.twofa_code).trim();
              logger.event('task.container.db_twofa_code.loaded', {
                runId: task.runId,
                containerName: containerNameStr,
                stepIndex: i,
                hasTwofaCode: !!gatheredVars.db_twofa_code
              }, 'debug');
            } else {
              logger.event('task.container.db_twofa_code.not_found', {
                runId: task.runId,
                containerName: containerNameStr,
                stepIndex: i
              }, 'warn');
            }

            // proxy_idからプロキシ情報を取得（後で使用）
            if (xAccount.proxy_id) {
              const proxyInfo = dbQuery<any>(
                'SELECT proxy_info FROM proxies WHERE id = ? LIMIT 1',
                [xAccount.proxy_id]
              )[0];

              if (proxyInfo && proxyInfo.proxy_info) {
                gatheredVars.db_proxy = String(proxyInfo.proxy_info);
                logger.event('task.container.db_proxy.loaded', {
                  runId: task.runId,
                  containerName: containerNameStr,
                  stepIndex: i,
                  proxyId: xAccount.proxy_id,
                  hasProxy: !!gatheredVars.db_proxy
                }, 'debug');
              }
            }
          } else {
            logger.event('task.container.x_account.not_found', {
              runId: task.runId,
              containerName: containerNameStr,
              stepIndex: i
            }, 'warn');
          }
        } catch (e: any) {
          logger.event('task.container.db_load_err', {
            runId: task.runId,
            containerName: containerNameStr,
            stepIndex: i,
            err: String(e?.message || e)
          }, 'warn');
          // DB取得エラーでも続行（手動指定の場合もあるため）
        }

        // プロキシ設定を取得（優先順位: ステップ指定 > DBから取得 > テンプレート変数 > overrides）
        // 形式: IP:PORT:USERNAME:PASSWORD
        const proxyRaw = st.proxy || (st.params && st.params.proxy) || gatheredVars.db_proxy || gatheredVars.proxy || task.overrides?.proxy;

        let proxy: { server: string; username?: string; password?: string } | undefined = undefined;

        // プロキシ設定を構築
        if (proxyRaw && String(proxyRaw).trim() !== '') {
          const proxyStr = applyTemplate(String(proxyRaw), gatheredVars);
          if (proxyStr && String(proxyStr).trim() !== '') {
            const parts = String(proxyStr).split(':');
            if (parts.length >= 3) {
              // IP:PORT:USERNAME:PASSWORD 形式
              proxy = {
                server: parts[0].trim() + ':' + parts[1].trim(), // IP:ポート
                username: parts[2].trim() || undefined,
                password: parts[3]?.trim() || undefined
              };
            } else if (parts.length === 2) {
              // IP:PORT 形式（ユーザー名・パスワードなし）
              proxy = {
                server: parts[0].trim() + ':' + parts[1].trim()
              };
            }
          }
        }

        // コンテナ指定ステップ: 既存コンテナがあれば開く、なければ作成する
        // まず既存コンテナを開くことを試みる
        let containerOpened = false;
        let containerIdToUse: string | undefined = undefined;

        // コンテナ名からUUIDを取得（コンテナDBから）
        try {
          const os = await import('node:os');
          const appData = os.platform() === 'win32' ? process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming') : path.join(os.homedir(), '.config');
          const dbPath = process.env.DEFAULT_CB_DB || path.join(appData, 'container-browser', 'data.db');
          if (fs.existsSync(dbPath)) {
            const Database = (await import('better-sqlite3')).default;
            const db = new Database(dbPath, { readonly: true });
            const row = db.prepare('SELECT id FROM containers WHERE name = ?').get(String(containerName)) as { id: string } | undefined;
            db.close();
            if (row && row.id) {
              containerIdToUse = row.id;
              logger.event('task.container.name_to_uuid_found', { name: containerName, uuid: containerIdToUse }, 'info');
            }
          }
        } catch (e: any) {
          logger.event('task.container.uuid_lookup.err', { err: String(e) }, 'warn');
        }

        // 既存コンテナがある場合のみそのIDを使用（CB DB に名前で存在するときだけ。存在しない場合は新規作成する）
        if (containerIdToUse) {
          const containerIdForUse = containerIdToUse;
          logger.event('task.container.check_existing', { runId: task.runId, containerName, containerId: containerIdForUse, stepIndex: i }, 'info');

          // 既存コンテナがある場合、そのIDを使用
          // コンテナは最初のnavigateステップで自動的に開かれる
          containerOpened = true;
          actualContainerId = containerIdForUse;
          openedByExport = false;
          runLog.containerId = actualContainerId;
          runLog.steps.push({
            index: i,
            step: st,
            result: { ok: true, containerId: actualContainerId, message: 'Existing container ID set, will open on navigate' }
          });
          logger.event('task.container.existing_id_set', { runId: task.runId, containerName, containerId: actualContainerId }, 'info');
        }

        // 既存コンテナがない場合、新規作成を実行
        if (!containerOpened) {
          logger.event('task.container.create_step', { runId: task.runId, containerName, stepIndex: i, hasProxy: !!proxy }, 'info');
          const createResult = await createContainer({
            name: String(containerName),
            proxy: proxy,
            timeoutMs: 60000
          });

          if (!createResult.ok) {
            const detailedError = `コンテナ "${containerName}" の作成に失敗しました: ${createResult.message}`;
            runLog.steps.push({ index: i, step: st, result: { ok: false, error: detailedError }, error: detailedError });
            runLog.error = detailedError;
            throw new Error(detailedError);
          }

          // コンテナIDを取得
          actualContainerId = createResult.containerId;

          // createContainerでコンテナを作成した時点で、そのコンテナは既に開かれている（選択状態）
          // コンテナIDを直接使用する（/internal/execエンドポイントはコンテナIDを直接受け入れる）
          openedByExport = false;
          runLog.containerId = actualContainerId;
          runLog.steps.push({
            index: i,
            step: st,
            result: { ok: true, containerId: actualContainerId, message: 'Container created and ready' }
          });
        }

        const postWaitSeconds = typeof st.postWaitSeconds === 'number' && st.postWaitSeconds > 0 ? st.postWaitSeconds : 0;
        if (postWaitSeconds > 0) {
          await new Promise((r) => setTimeout(r, Math.round(postWaitSeconds * 1000)));
        }

        continue; // 次のステップへ
      }

      // forステップは内部で処理する（callExecを呼ばない）
      if (st.type === 'for') {
        const innerSteps = Array.isArray(st.steps) ? st.steps : [];

        // itemsが指定されている場合（配列をループ）
        let itemsArray: any[] = [];
        let count = 1;
        const itemsRaw = st.items;
        const itemVar = st.itemVar || st.item_var || 'item';

        if (itemsRaw) {
          const itemsStr = String(itemsRaw).trim();
          // {{単一変数}} の場合は applyTemplate を介さず配列を直接参照（template variables missing を防ぐ）
          let resolvedByDirect = false;
          const singleVarMatch = itemsStr.match(/^\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}$/);
          if (singleVarMatch) {
            const varName = singleVarMatch[1];
            // db_post_media_paths は未設定時は必ず空配列（applyTemplate を呼ばない）
            const direct = varName === 'db_post_media_paths'
              ? (gatheredVars.db_post_media_paths ?? [])
              : gatheredVars[varName];
            if (Array.isArray(direct)) {
              itemsArray = direct;
              resolvedByDirect = true;
            } else if (direct === undefined || direct === null) {
              itemsArray = [];
              resolvedByDirect = true;
            }
          }
          if (itemsArray.length === 0 && !resolvedByDirect) {
            const itemsValue = applyTemplate(itemsStr, gatheredVars);
            if (Array.isArray(itemsValue)) {
              itemsArray = itemsValue;
            } else if (typeof itemsValue === 'string' && itemsValue.trim() !== '' && itemsValue !== 'undefined') {
              try {
                itemsArray = itemsValue.split(',').map((item: string) => item.trim()).filter((item: string) => item);
              } catch (e) {
                itemsArray = [];
              }
            } else {
              const varName = itemsStr.replace(/\{\{|\}\}/g, '').trim();
              const varValue = gatheredVars[varName];
              if (Array.isArray(varValue)) {
                itemsArray = varValue;
              } else if (typeof varValue === 'string' && varValue.trim() !== '') {
                try {
                  itemsArray = varValue.split(',').map((item: string) => item.trim()).filter((item: string) => item);
                } catch (e) {
                  itemsArray = [];
                }
              }
            }
          }
          count = itemsArray.length;
        } else {
          // itemsが指定されていない場合はcount/repeatを使用
          const countRaw = st.count || st.repeat || 1;
          count = Math.max(1, Math.floor(Number(applyTemplate(String(countRaw), gatheredVars))));
        }

        const maxPostsRaw = st.max_posts || st.maxPosts;
        const maxPosts = maxPostsRaw ? Math.max(1, Math.floor(Number(applyTemplate(String(maxPostsRaw), gatheredVars)))) : null;

        // デバッグ: innerStepsの内容を確認
        logger.event('task.for.inner_steps.debug', {
          runId: task.runId,
          presetId: task.presetId,
          stepIndex: i,
          innerStepsCount: innerSteps.length,
          innerStepsWithResultVar: innerSteps.filter((s: any) => s.result_var).length,
          hasItems: !!itemsRaw,
          itemsCount: itemsArray.length,
          itemVar: itemVar,
          innerStepsDetails: innerSteps.map((s: any, idx: number) => ({
            index: idx,
            type: s.type,
            hasResultVar: !!s.result_var,
            resultVar: s.result_var || null,
            keys: s ? Object.keys(s) : []
          }))
        }, 'info');

        logger.event('task.for.start', {
          runId: task.runId,
          presetId: task.presetId,
          index: i,
          repeat_count: count,
          max_posts: maxPosts,
          innerStepsCount: innerSteps.length,
          hasItems: !!itemsRaw,
          itemsCount: itemsArray.length
        }, 'info');

        const forResults: any[] = [];
        let totalSaved = 0; // 累計保存数

        for (let loopIndex = 0; loopIndex < count; loopIndex++) {
          // ループ変数を gatheredVars に設定
          const originalLoopIndex = gatheredVars.loop_index;
          const originalLoopCount = gatheredVars.loop_count;
          const originalItemVar = gatheredVars[itemVar];
          gatheredVars.loop_index = loopIndex;
          gatheredVars.loop_count = loopIndex + 1;

          // itemsが指定されている場合、現在の要素をitemVarに設定
          if (itemsArray.length > 0 && loopIndex < itemsArray.length) {
            gatheredVars[itemVar] = itemsArray[loopIndex];
          }

          logger.event('task.for.iteration', {
            runId: task.runId,
            presetId: task.presetId,
            stepIndex: i,
            loopIndex,
            loopCount: loopIndex + 1,
            max_posts: maxPosts,
            totalSaved
          }, 'info');

          const iterationResults: any[] = [];
          let iterationError: string | null = null;

          // 内部ステップを実行
          for (let innerIdx = 0; innerIdx < innerSteps.length; innerIdx++) {
            const innerStep = innerSteps[innerIdx];

            // デバッグ: innerStepの内容を確認
            logger.event('task.for.inner_step.debug', {
              runId: task.runId,
              presetId: task.presetId,
              stepIndex: i,
              loopIndex,
              innerStepIndex: innerIdx,
              innerStepType: innerStep?.type,
              innerStepKeys: innerStep ? Object.keys(innerStep) : null,
              hasResultVar: !!(innerStep?.result_var),
              resultVar: innerStep?.result_var || null,
              innerStepJson: innerStep ? JSON.stringify(innerStep).substring(0, 500) : null
            }, 'info');

            try {
              // 内部ステップを実行（簡易実装：evalステップとして処理）
              // 実際の実装では、ステップ実行ロジックを関数化する必要がある
              // ここでは、内部ステップを通常のステップとして実行する
              const innerCmdPayload: any = { contextId: actualContainerId, command: innerStep.type };

              // テンプレート変数を適用
              if (innerStep.type === 'navigate') {
                // pr_post_library_id / post_library_id は必須パラメータ（overridesまたはgatheredVarsから取得）
                const postLibraryIdRaw = task.overrides?.post_library_id || gatheredVars.pr_post_library_id || gatheredVars.post_library_id;
                if (!postLibraryIdRaw) {
                  logger.event('task.for.navigate.missing_post_library_id', {
                    runId: task.runId,
                    presetId: task.presetId,
                    stepIndex: i,
                    loopIndex,
                    innerStepIndex: innerIdx
                  }, 'error');
                  throw new Error('post_library_id parameter is required');
                }

                try {
                  const postLibraryId = typeof postLibraryIdRaw === 'string' ? parseInt(postLibraryIdRaw, 10) : Number(postLibraryIdRaw);
                  if (isNaN(postLibraryId) || postLibraryId <= 0) {
                    throw new Error(`Invalid post_library_id: ${postLibraryIdRaw}`);
                  }

                  const record = dbQuery<any>('SELECT id, source_url, content, account_id, post_id_threads FROM post_library WHERE id = ?', [postLibraryId]);
                  if (!record || record.length === 0) {
                    throw new Error(`Post library record not found: id=${postLibraryId}`);
                  }

                  const rec = record[0];
                  const url = rec.source_url || rec.content || '';
                  if (!url) {
                    throw new Error(`Post library record has no URL: id=${postLibraryId}`);
                  }

                  gatheredVars.post_url = url;
                  gatheredVars.pr_post_info = {
                    post_library_id: rec.id,
                    post_url: url.split('?')[0],
                    account_id: rec.account_id,
                    post_id: rec.post_id_threads,
                    use_existing_record: true
                  };

                  logger.event('task.for.navigate.loaded_from_post_library', {
                    runId: task.runId,
                    presetId: task.presetId,
                    stepIndex: i,
                    loopIndex,
                    innerStepIndex: innerIdx,
                    post_library_id: postLibraryId,
                    post_url: gatheredVars.post_url
                  }, 'info');
                } catch (loadErr: any) {
                  logger.event('task.for.navigate.db_load_error', {
                    runId: task.runId,
                    presetId: task.presetId,
                    stepIndex: i,
                    loopIndex,
                    innerStepIndex: innerIdx,
                    error: String(loadErr?.message || loadErr)
                  }, 'error');
                  throw loadErr;
                }

                innerCmdPayload.url = applyTemplate(innerStep.url || '', gatheredVars);
              }
              if (innerStep.type === 'click' || innerStep.type === 'type') {
                innerCmdPayload.selector = applyTemplate(innerStep.selector || '', gatheredVars);
              }
              if (innerStep.type === 'type') {
                innerCmdPayload.text = applyTemplate(innerStep.text || '', gatheredVars);
              }
              if (innerStep.type === 'eval') {
                const rawEval = innerStep.code || innerStep.eval || '';
                innerCmdPayload.eval = applyTemplate(rawEval, gatheredVars, false, true);
              }
              if (innerStep.type === 'extract') {
                innerCmdPayload.selector = applyTemplate(innerStep.selector || '', gatheredVars);
              }
              const innerOptions = Object.assign({}, (innerStep.options && typeof innerStep.options === 'object') ? innerStep.options : {});
              innerOptions.timeoutMs = resolveStepTimeoutMs(innerStep, defaultTimeoutSeconds);

              if (innerStep.type === 'save_media') {
                // save_media ステップの処理
                // 仕様: options の中に destination_folder, folder_name, selectors を含める
                const rawDestinationFolder = innerStep.destination_folder || './storage/media/threads';
                const rawFolderName = innerStep.folder_name || '';
                let resolvedDestinationFolder = applyTemplate(rawDestinationFolder, gatheredVars);
                const resolvedFolderName = applyTemplate(rawFolderName, gatheredVars);

                // 相対パスの場合は絶対パスに変換
                if (resolvedDestinationFolder && !path.isAbsolute(resolvedDestinationFolder)) {
                  resolvedDestinationFolder = path.resolve(resolvedDestinationFolder);
                }

                innerOptions.destination_folder = resolvedDestinationFolder;
                innerOptions.folder_name = resolvedFolderName;
                innerOptions.selectors = innerStep.selectors || [];

                // デバッグログ
                logger.event('task.for.save_media.template', {
                  runId: task.runId,
                  presetId: task.presetId,
                  stepIndex: i,
                  loopIndex,
                  innerStepIndex: innerIdx,
                  rawDestinationFolder,
                  rawFolderName,
                  resolvedDestinationFolder: innerOptions.destination_folder,
                  resolvedFolderName: innerOptions.folder_name,
                  hasPrPostInfo: !!(gatheredVars.pr_post_info),
                  prPostInfo: gatheredVars.pr_post_info
                }, 'info');
              }

              innerCmdPayload.options = innerOptions;

              const innerResp = await callExec(innerCmdPayload);
              iterationResults.push({ stepIndex: innerIdx, step: innerStep, result: innerResp });

              // アカウント凍結検出: evalステップの結果にsuspended: trueが含まれている場合
              if (innerStep.type === 'eval' && innerResp && innerResp.body && typeof innerResp.body === 'object' && 'result' in innerResp.body) {
                const evalResult = innerResp.body.result;
                if (evalResult && typeof evalResult === 'object') {
                  // 凍結検出: Bannedグループに移動
                  if (evalResult.suspended === true) {
                    const containerIdForGroup = actualContainerId || task.containerId;
                    if (containerIdForGroup) {
                      try {
                        // BannedグループのIDを取得
                        const bannedGroup = dbQuery<any>('SELECT id FROM container_groups WHERE name = ? LIMIT 1', ['Banned'])[0];
                        if (bannedGroup) {
                          const now = Date.now();

                          // 移動前のグループ情報を取得（container_group_members更新前）
                          const previousMembership = dbQuery<any>(
                            'SELECT cgm.group_id, cg.name as group_name FROM container_group_members cgm LEFT JOIN container_groups cg ON cgm.group_id = cg.id WHERE cgm.container_id = ? LIMIT 1',
                            [String(containerIdForGroup)]
                          )[0];
                          const previousGroupName = previousMembership?.group_name || '(グループ未所属)';

                          // container_group_membersテーブルに追加（既に存在する場合は更新）
                          dbRun(
                            'INSERT INTO container_group_members(container_id, group_id, created_at, updated_at) VALUES(?,?,?,?) ON CONFLICT(container_id) DO UPDATE SET group_id=excluded.group_id, updated_at=excluded.updated_at',
                            [String(containerIdForGroup), bannedGroup.id, now, now]
                          );

                          // x_accountsテーブルに移動情報を記録
                          updateXAccountGroupMoveInfo(String(containerIdForGroup), bannedGroup.id, now, previousGroupName);

                          // アカウントステータスイベントをDBに記録
                          dbRun(
                            'INSERT INTO account_status_events(container_id, event_type, status, error_message, created_at) VALUES(?,?,?,?,?)',
                            [String(containerIdForGroup), 'suspended', 'banned', evalResult.error || 'アカウントが凍結されています', now]
                          );

                          logger.event('account.suspended.moved_to_banned', {
                            runId: task.runId,
                            presetId: task.presetId,
                            stepIndex: i,
                            loopIndex,
                            innerStepIndex: innerIdx,
                            error: evalResult.error || 'アカウントが凍結されています',
                            containerId: containerIdForGroup,
                            containerName: containerName || null,
                            groupId: bannedGroup.id
                          }, 'warn');
                        } else {
                          logger.event('account.suspended.banned_group_not_found', {
                            runId: task.runId,
                            presetId: task.presetId,
                            stepIndex: i,
                            loopIndex,
                            innerStepIndex: innerIdx,
                            containerId: containerIdForGroup
                          }, 'error');
                        }
                      } catch (e: any) {
                        logger.event('account.suspended.move_failed', {
                          runId: task.runId,
                          presetId: task.presetId,
                          stepIndex: i,
                          loopIndex,
                          innerStepIndex: innerIdx,
                          containerId: containerIdForGroup,
                          error: String(e?.message || e)
                        }, 'error');
                      }
                    }

                    logger.event('account.suspended.detected', {
                      runId: task.runId,
                      presetId: task.presetId,
                      stepIndex: i,
                      loopIndex,
                      innerStepIndex: innerIdx,
                      error: evalResult.error || 'アカウントが凍結されています',
                      containerId: actualContainerId || task.containerId || null,
                      containerName: containerName || null
                    }, 'warn');
                  }

                  // Cloudflareチャレンジ検出: ロック状態（suspendedとは別扱い）
                  if (evalResult.locked === true) {
                    const containerIdForLock = actualContainerId || task.containerId;
                    if (containerIdForLock) {
                      // アカウントステータスイベントをDBに記録
                      const now = Date.now();
                      dbRun(
                        'INSERT INTO account_status_events(container_id, event_type, status, error_message, created_at) VALUES(?,?,?,?,?)',
                        [String(containerIdForLock), 'locked', 'cloudflare_challenge', evalResult.error || 'Cloudflareチャレンジページが表示されています', now]
                      );
                    }

                    logger.event('account.locked.detected', {
                      runId: task.runId,
                      presetId: task.presetId,
                      stepIndex: i,
                      loopIndex,
                      innerStepIndex: innerIdx,
                      error: evalResult.error || 'Cloudflareチャレンジページが表示されています',
                      containerId: actualContainerId || task.containerId || null,
                      containerName: containerName || null
                    }, 'warn');
                  }

                  // ログインページ検出: ログインが必要な状態（suspendedとは別扱い、Bannedグループには移動しない）
                  if (evalResult.login_required === true) {
                    const containerIdForLogin = actualContainerId || task.containerId;
                    if (containerIdForLogin) {
                      // アカウントステータスイベントをDBに記録
                      const now = Date.now();
                      dbRun(
                        'INSERT INTO account_status_events(container_id, event_type, status, error_message, created_at) VALUES(?,?,?,?,?)',
                        [String(containerIdForLogin), 'login_required', 'login_page', evalResult.error || 'ログインページが表示されています', now]
                      );
                    }

                    logger.event('account.login_required.detected', {
                      runId: task.runId,
                      presetId: task.presetId,
                      stepIndex: i,
                      loopIndex,
                      innerStepIndex: innerIdx,
                      error: evalResult.error || 'ログインページが表示されています',
                      containerId: actualContainerId || task.containerId || null,
                      containerName: containerName || null
                    }, 'warn');
                  }
                }
              }

              // result_var で gatheredVars に保存
              logger.event('task.for.inner_step.result_var.check', {
                runId: task.runId,
                presetId: task.presetId,
                stepIndex: i,
                loopIndex,
                innerStepIndex: innerIdx,
                hasResultVar: !!innerStep.result_var,
                resultVar: innerStep.result_var || null,
                innerRespOk: !!(innerResp && innerResp.ok),
                hasInnerRespBody: !!(innerResp && innerResp.body),
                innerStepType: innerStep.type
              }, 'info');

              if (innerStep.result_var && innerResp && innerResp.body) {
                const resultVar = applyTemplate(innerStep.result_var, gatheredVars);
                if (resultVar && typeof resultVar === 'string' && resultVar.trim() !== '') {
                  // evalステップの場合、innerResp.body.result を保存
                  // result_var が pr_auth_tokens かつ options.returnCookies のときは body.cookies から auth_token/ct0 を抽出
                  // save_media ステップの場合、innerResp.body をそのまま保存
                  // その他のステップでは innerResp.body を保存
                  let valueToSave: any;
                  if (innerStep.type === 'eval' && innerResp.body && typeof innerResp.body === 'object') {
                    const innerBody = innerResp.body as { result?: unknown; commandResult?: { result?: unknown }; cookies?: Array<{ name?: string; value?: string }> };
                    if (resultVar === 'pr_auth_tokens' && Array.isArray(innerBody.cookies) && innerStep.options && (innerStep.options as Record<string, unknown>).returnCookies) {
                      const authEntry = innerBody.cookies.find((c) => c && c.name === 'auth_token');
                      const ct0Entry = innerBody.cookies.find((c) => c && c.name === 'ct0');
                      if (authEntry && typeof authEntry.value === 'string' && ct0Entry && typeof ct0Entry.value === 'string') {
                        valueToSave = { auth_token: authEntry.value, ct0: ct0Entry.value };
                      } else {
                        valueToSave = innerBody.result ?? (innerBody.commandResult && typeof innerBody.commandResult === 'object' && 'result' in innerBody.commandResult ? innerBody.commandResult.result : undefined);
                      }
                    } else if ('result' in innerBody && innerBody.result !== undefined) {
                      valueToSave = innerBody.result;
                    } else if (innerBody.commandResult && typeof innerBody.commandResult === 'object' && innerBody.commandResult.result !== undefined) {
                      valueToSave = innerBody.commandResult.result;
                    } else {
                      valueToSave = innerResp.body;
                    }
                    // DB保存調査用: pr_search_results に設定する値の内容を記録
                    if (resultVar === 'pr_search_results') {
                      const postsCount = (valueToSave && typeof valueToSave === 'object' && Array.isArray(valueToSave.posts)) ? valueToSave.posts.length : null;
                      const bodyObj = innerResp.body && typeof innerResp.body === 'object' ? innerResp.body as Record<string, unknown> : null;
                      logger.event('task.for.pr_search_results.set', {
                        runId: task.runId,
                        presetId: task.presetId,
                        stepIndex: i,
                        loopIndex,
                        innerStepIndex: innerIdx,
                        hasValueToSave: !!valueToSave,
                        valueToSaveType: typeof valueToSave,
                        valueToSaveKeys: valueToSave && typeof valueToSave === 'object' ? Object.keys(valueToSave) : null,
                        postsCount,
                        hasResultInBody: !!(bodyObj && 'result' in bodyObj),
                        hasCommandResultInBody: !!(bodyObj && bodyObj.commandResult && typeof bodyObj.commandResult === 'object' && 'result' in (bodyObj.commandResult as object)),
                      }, 'info');
                    }
                  } else if (innerStep.type === 'save_media' && innerResp.body && typeof innerResp.body === 'object') {
                    // save_media のレスポンスは { ok, folder_path, files, summary } 形式
                    valueToSave = innerResp.body;
                  } else {
                    valueToSave = innerResp.body;
                  }

                  logger.event('task.for.inner_step.result_var.save', {
                    runId: task.runId,
                    presetId: task.presetId,
                    stepIndex: i,
                    loopIndex,
                    innerStepIndex: innerIdx,
                    resultVar,
                    innerStepType: innerStep.type,
                    hasValueToSave: !!valueToSave,
                    valueToSaveType: typeof valueToSave,
                    isEvalStep: innerStep.type === 'eval',
                    hasResultInBody: !!(innerResp.body && typeof innerResp.body === 'object' && 'result' in innerResp.body),
                    valueToSaveKeys: valueToSave && typeof valueToSave === 'object' ? Object.keys(valueToSave) : null,
                    valueToSavePostsCount: (valueToSave && typeof valueToSave === 'object' && 'posts' in valueToSave && Array.isArray(valueToSave.posts)) ? valueToSave.posts.length : null,
                    existingValue: gatheredVars[resultVar] ? (typeof gatheredVars[resultVar] === 'object' ? Object.keys(gatheredVars[resultVar]) : typeof gatheredVars[resultVar]) : null
                  }, 'info');

                  // pr_post_info が既に存在する場合（navigateステップで設定された場合）、マージする
                  if (resultVar === 'pr_post_info') {
                    logger.event('task.for.inner_step.result_var.merge_check', {
                      runId: task.runId,
                      presetId: task.presetId,
                      stepIndex: i,
                      loopIndex,
                      innerStepIndex: innerIdx,
                      resultVar,
                      hasExistingPrPostInfo: !!(gatheredVars.pr_post_info),
                      existingPrPostInfoType: typeof gatheredVars.pr_post_info,
                      existingPrPostInfoKeys: gatheredVars.pr_post_info && typeof gatheredVars.pr_post_info === 'object' ? Object.keys(gatheredVars.pr_post_info) : null,
                      hasValueToSave: !!valueToSave,
                      valueToSaveType: typeof valueToSave,
                      valueToSaveKeys: valueToSave && typeof valueToSave === 'object' ? Object.keys(valueToSave) : null,
                      willMerge: !!(gatheredVars.pr_post_info && typeof gatheredVars.pr_post_info === 'object' && valueToSave && typeof valueToSave === 'object')
                    }, 'info');

                    if (gatheredVars.pr_post_info && typeof gatheredVars.pr_post_info === 'object' && valueToSave && typeof valueToSave === 'object') {
                      gatheredVars[resultVar] = { ...gatheredVars.pr_post_info, ...valueToSave };
                      logger.event('task.for.inner_step.result_var.merged', {
                        runId: task.runId,
                        presetId: task.presetId,
                        stepIndex: i,
                        loopIndex,
                        innerStepIndex: innerIdx,
                        resultVar,
                        mergedKeys: Object.keys(gatheredVars[resultVar]),
                        mergedPrPostInfo: gatheredVars[resultVar]
                      }, 'info');
                    } else {
                      gatheredVars[resultVar] = valueToSave;
                      logger.event('task.for.inner_step.result_var.not_merged', {
                        runId: task.runId,
                        presetId: task.presetId,
                        stepIndex: i,
                        loopIndex,
                        innerStepIndex: innerIdx,
                        resultVar,
                        reason: !gatheredVars.pr_post_info ? 'no_existing' : (typeof gatheredVars.pr_post_info !== 'object' ? 'not_object' : (!valueToSave ? 'no_value' : 'not_object_value'))
                      }, 'info');
                    }
                  } else {
                    gatheredVars[resultVar] = valueToSave;
                  }

                  logger.event('task.for.inner_step.result_var.saved', {
                    runId: task.runId,
                    presetId: task.presetId,
                    stepIndex: i,
                    loopIndex,
                    innerStepIndex: innerIdx,
                    resultVar,
                    hasPrSearchResults: !!(gatheredVars.pr_search_results),
                    prSearchResultsType: typeof gatheredVars.pr_search_results,
                    prSearchResultsPostsCount: (gatheredVars.pr_search_results && gatheredVars.pr_search_results.posts && Array.isArray(gatheredVars.pr_search_results.posts)) ? gatheredVars.pr_search_results.posts.length : null
                  }, 'info');

                  // pr_auth_tokensが設定された場合、x_accountsテーブルを更新
                  if (resultVar === 'pr_auth_tokens' && valueToSave && typeof valueToSave === 'object' && valueToSave.auth_token && valueToSave.ct0) {
                    try {
                      // containerIdからコンテナ名を取得
                      let containerNameForUpdate: string | null = gatheredVars.db_container_name || gatheredVars.container_name || null;

                      if (!containerNameForUpdate && task.containerId) {
                        const containerIdStr = String(task.containerId);
                        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(containerIdStr);

                        if (isUuid) {
                          try {
                            const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
                            const containerDbPath = process.env.DEFAULT_CB_DB || path.join(appData, 'container-browser', 'data.db');

                            if (fs.existsSync(containerDbPath)) {
                              const containerDb = new Database(containerDbPath, { readonly: true });
                              const containerRow = containerDb.prepare('SELECT name FROM containers WHERE id = ? LIMIT 1').get(containerIdStr) as { name?: string } | undefined;
                              if (containerRow && containerRow.name) {
                                containerNameForUpdate = String(containerRow.name);
                              }
                              containerDb.close();
                            }
                          } catch (e: any) {
                            logger.event('task.for.auth_tokens.container_name_err', { runId: task.runId, containerId: containerIdStr, err: String(e?.message || e) }, 'warn');
                          }
                        } else {
                          containerNameForUpdate = containerIdStr;
                        }
                      }

                      if (containerNameForUpdate) {
                        const now = Date.now();
                        dbRun(
                          'UPDATE x_accounts SET auth_token = ?, ct0 = ?, updated_at = ? WHERE container_id = ?',
                          [String(valueToSave.auth_token), String(valueToSave.ct0), now, containerNameForUpdate]
                        );

                        logger.event('task.for.auth_tokens.saved', {
                          runId: task.runId,
                          presetId: task.presetId,
                          stepIndex: i,
                          loopIndex,
                          innerStepIndex: innerIdx,
                          containerId: task.containerId,
                          containerName: containerNameForUpdate,
                          hasAuthToken: !!valueToSave.auth_token,
                          hasCt0: !!valueToSave.ct0
                        }, 'info');
                      } else {
                        logger.event('task.for.auth_tokens.save_skipped', {
                          runId: task.runId,
                          presetId: task.presetId,
                          stepIndex: i,
                          loopIndex,
                          innerStepIndex: innerIdx,
                          containerId: task.containerId,
                          reason: 'container_name is empty'
                        }, 'warn');
                      }
                    } catch (authErr: any) {
                      logger.event('task.for.auth_tokens.save_error', {
                        runId: task.runId,
                        presetId: task.presetId,
                        stepIndex: i,
                        loopIndex,
                        innerStepIndex: innerIdx,
                        containerId: task.containerId,
                        error: String(authErr?.message || authErr)
                      }, 'error');
                    }
                  }

                  // pr_save_result が設定された場合、pr_search_resultsをDBに保存
                  if (resultVar === 'pr_save_result' || resultVar.includes('save_result')) {
                    const pr = gatheredVars.pr_search_results;
                    const prPostsLen = (pr && typeof pr === 'object' && Array.isArray(pr.posts)) ? pr.posts.length : null;
                    logger.event('task.for.save_posts.condition_met', {
                      runId: task.runId,
                      presetId: task.presetId,
                      stepIndex: i,
                      loopIndex,
                      innerStepIndex: innerIdx,
                      resultVar,
                      hasPrSearchResults: !!pr,
                      prSearchResultsType: typeof pr,
                      prSearchResultsKeys: pr && typeof pr === 'object' ? Object.keys(pr) : null,
                      prSearchResultsPostsCount: prPostsLen,
                      hasPrMediaResult: !!(gatheredVars.pr_media_result),
                      prMediaResultType: typeof gatheredVars.pr_media_result
                    }, 'info');

                    try {
                      // ケース1: Threads メディア保存（pr_media_result がある場合）
                      const mediaResult = gatheredVars.pr_media_result;
                      if (mediaResult) {
                        const postInfo = gatheredVars.pr_post_info;

                        // メディア保存に失敗がある場合は投稿全体をスキップ
                        if (mediaResult.summary && mediaResult.summary.failed > 0) {
                          logger.event('task.for.save_media.failed_skip', {
                            runId: task.runId,
                            presetId: task.presetId,
                            stepIndex: i,
                            loopIndex,
                            succeeded: mediaResult.summary.succeeded || 0,
                            failed: mediaResult.summary.failed,
                            total: mediaResult.summary.total || 0,
                            account_id: postInfo?.account_id,
                            post_id: postInfo?.post_id
                          }, 'warn');

                          gatheredVars.pr_save_result = {
                            saved: 0,
                            skipped: 1,
                            reason: `Media save failed: ${mediaResult.summary.failed} of ${mediaResult.summary.total} files failed`
                          };
                        } else if (mediaResult.ok && mediaResult.summary) {
                          // 成功した場合（メディアが0件でも成功として扱う）、DBに保存
                          if (postInfo && postInfo.post_url) {
                            try {
                              const now = Date.now();

                              // post_library_id が指定されている場合は UPDATE（post_library_idは必須パラメータのため、常にUPDATE）
                              if (!postInfo.post_library_id) {
                                throw new Error('post_library_id is required for saving media result');
                              }

                              const mediaCount = mediaResult.summary.succeeded || 0;
                              dbRun(
                                'UPDATE post_library SET media_paths = ?, download_status = ?, downloaded_at = ?, media_count = ?, account_id = ?, post_id_threads = ?, updated_at = ? WHERE id = ?',
                                [
                                  mediaResult.summary.paths_comma_separated || '',
                                  'success',
                                  now,
                                  mediaCount,
                                  postInfo.account_id || null,
                                  postInfo.post_id || null,
                                  now,
                                  postInfo.post_library_id
                                ]
                              );

                              logger.event('task.for.save_media.db_updated', {
                                runId: task.runId,
                                presetId: task.presetId,
                                stepIndex: i,
                                loopIndex,
                                post_library_id: postInfo.post_library_id,
                                media_count: mediaCount,
                                account_id: postInfo.account_id,
                                post_id: postInfo.post_id
                              }, 'info');

                              gatheredVars.pr_save_result = {
                                saved: 1,
                                media_count: mediaCount,
                                post_library_id: postInfo.post_library_id || null
                              };
                            } catch (mediaErr: any) {
                              logger.event('task.for.save_media.db_error', {
                                runId: task.runId,
                                presetId: task.presetId,
                                stepIndex: i,
                                loopIndex,
                                error: String(mediaErr?.message || mediaErr)
                              }, 'error');

                              gatheredVars.pr_save_result = {
                                saved: 0,
                                error: String(mediaErr?.message || mediaErr)
                              };
                            }
                          } else {
                            logger.event('task.for.save_media.no_post_info', {
                              runId: task.runId,
                              presetId: task.presetId,
                              stepIndex: i,
                              loopIndex
                            }, 'warn');

                            gatheredVars.pr_save_result = {
                              saved: 0,
                              error: 'Post info not found'
                            };
                          }
                        } else {
                          // メディア保存が失敗した場合
                          logger.event('task.for.save_media.failed', {
                            runId: task.runId,
                            presetId: task.presetId,
                            stepIndex: i,
                            loopIndex,
                            mediaResultOk: mediaResult.ok,
                            hasSummary: !!(mediaResult.summary),
                            succeeded: mediaResult.summary?.succeeded || 0
                          }, 'warn');

                          gatheredVars.pr_save_result = {
                            saved: 0,
                            skipped: 1,
                            reason: 'Media save failed or no media found'
                          };
                        }
                      } else {
                        // ケース2: 既存の Threads 投稿検索保存（pr_search_results がある場合）
                        // フォールバック: プリセットの step 0 に result_var が無い場合、同一イテレーションの step 0 の実行結果から投稿を取得
                        let searchResults = gatheredVars.pr_search_results;
                        if (!searchResults || !searchResults.posts || !Array.isArray(searchResults.posts)) {
                          const firstResult = iterationResults[0];
                          const firstResp = firstResult?.result;
                          const body = firstResp?.body && typeof firstResp.body === 'object' ? firstResp.body as { result?: { posts?: unknown[] }; commandResult?: { result?: { posts?: unknown[] } } } : null;
                          const fromBody = body?.result?.posts && Array.isArray(body.result.posts) ? body.result : (body?.commandResult?.result?.posts && Array.isArray(body.commandResult.result.posts) ? body.commandResult.result : null);
                          if (fromBody && Array.isArray(fromBody.posts)) {
                            searchResults = fromBody;
                            logger.event('task.for.save_posts.fallback_from_iteration', {
                              runId: task.runId,
                              presetId: task.presetId,
                              stepIndex: i,
                              loopIndex,
                              innerStepIndex: innerIdx,
                              postsCount: searchResults.posts.length,
                              reason: 'pr_search_results not set (missing result_var on step 0?)',
                            }, 'info');
                          }
                        }

                        if (!searchResults) {
                          logger.event('task.for.save_posts.no_search_results', {
                            runId: task.runId,
                            presetId: task.presetId,
                            stepIndex: i,
                            loopIndex,
                            innerStepIndex: innerIdx,
                            gatheredVarsKeys: Object.keys(gatheredVars),
                            hasPrSearchResults: false
                          }, 'warn');
                        } else if (!searchResults.posts || !Array.isArray(searchResults.posts)) {
                          logger.event('task.for.save_posts.invalid_search_results', {
                            runId: task.runId,
                            presetId: task.presetId,
                            stepIndex: i,
                            loopIndex,
                            innerStepIndex: innerIdx,
                            searchResultsType: typeof searchResults,
                            searchResultsKeys: typeof searchResults === 'object' ? Object.keys(searchResults) : null,
                            hasPosts: !!(searchResults.posts),
                            postsIsArray: Array.isArray(searchResults.posts)
                          }, 'warn');
                        }

                        if (searchResults && searchResults.posts && Array.isArray(searchResults.posts)) {
                          let saved = 0;
                          let skipped = 0;
                          const firstPostUrl = searchResults.posts.length > 0 && searchResults.posts[0] && typeof searchResults.posts[0] === 'object'
                            ? (searchResults.posts[0] as { post_url?: string }).post_url ?? null
                            : null;
                          logger.event('task.for.save_posts.start', {
                            runId: task.runId,
                            presetId: task.presetId,
                            stepIndex: i,
                            loopIndex,
                            postsCount: searchResults.posts.length,
                            totalSaved,
                            maxPosts,
                            firstPostUrl: firstPostUrl ? firstPostUrl.substring(0, 80) : null,
                          }, 'info');

                          for (const post of searchResults.posts) {
                            try {
                              if (!post.post_url || !post.content) {
                                skipped++;
                                logger.event('task.for.save_post.skipped', {
                                  runId: task.runId,
                                  presetId: task.presetId,
                                  stepIndex: i,
                                  loopIndex,
                                  innerStepIndex: innerIdx,
                                  reason: 'missing_url_or_content',
                                  hasPostUrl: !!post.post_url,
                                  hasContent: !!post.content,
                                  postUrl: post.post_url || null
                                }, 'debug');
                                continue;
                              }

                              // max_postsに達している場合はスキップ
                              if (maxPosts !== null && totalSaved >= maxPosts) {
                                skipped++;
                                logger.event('task.for.save_post.skipped', {
                                  runId: task.runId,
                                  presetId: task.presetId,
                                  stepIndex: i,
                                  loopIndex,
                                  innerStepIndex: innerIdx,
                                  reason: 'max_posts_reached',
                                  totalSaved,
                                  maxPosts
                                }, 'debug');
                                continue;
                              }

                              // 重複チェック（source_urlをユニークキーとして使用）
                              const existing = dbQuery<any>(
                                'SELECT id FROM post_library WHERE source_url = ? LIMIT 1',
                                [post.post_url]
                              )[0];

                              if (existing) {
                                skipped++;
                                logger.event('task.for.save_post.skipped', {
                                  runId: task.runId,
                                  presetId: task.presetId,
                                  stepIndex: i,
                                  loopIndex,
                                  innerStepIndex: innerIdx,
                                  reason: 'duplicate',
                                  postUrl: post.post_url,
                                  existingId: existing.id
                                }, 'debug');
                                continue;
                              }

                              // URLからaccount_idとpost_id_threadsを抽出
                              let accountId: string | null = null;
                              let postIdThreads: string | null = null;
                              const urlMatch = post.post_url.match(/@([^\/]+)\/post\/([A-Za-z0-9]+)/);
                              if (urlMatch && urlMatch.length >= 3) {
                                accountId = urlMatch[1];
                                postIdThreads = urlMatch[2];
                              }

                              // post_libraryテーブルに保存
                              const now = Date.now();
                              dbRun(
                                'INSERT INTO post_library(content, used, media_paths, source_url, account_id, post_id_threads, download_status, downloaded_at, media_count, like_count, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
                                [
                                  post.content, // content: 投稿本文
                                  0, // used: 未使用フラグ（0=未使用）
                                  '', // media_paths: メディアなし（空文字列）
                                  post.post_url, // source_url: 投稿URL
                                  accountId, // account_id: アカウントID
                                  postIdThreads, // post_id_threads: Threads投稿ID
                                  'pending', // download_status: メディア未ダウンロード
                                  null, // downloaded_at: 未ダウンロードなのでNULL
                                  0, // media_count: メディア数（0）
                                  typeof post.like_count === 'number' ? post.like_count : null, // like_count: いいね数
                                  now, // created_at: レコード追加日時
                                  now // updated_at: 更新日時
                                ]
                              );
                              logger.event('task.for.save_post.inserted', {
                                runId: task.runId,
                                presetId: task.presetId,
                                stepIndex: i,
                                loopIndex,
                                postUrl: post.post_url ? post.post_url.substring(0, 80) : null,
                                savedSoFar: saved + 1,
                                totalSavedSoFar: totalSaved + 1,
                              }, 'info');
                              saved++;
                              totalSaved++;

                              // max_postsに達した場合はループを終了
                              if (maxPosts !== null && totalSaved >= maxPosts) {
                                logger.event('task.for.max_posts_reached', {
                                  runId: task.runId,
                                  presetId: task.presetId,
                                  stepIndex: i,
                                  loopIndex,
                                  totalSaved,
                                  maxPosts
                                }, 'info');
                                break;
                              }
                            } catch (postErr: any) {
                              // UNIQUE制約違反の場合はスキップ
                              if (String(postErr?.message || '').includes('UNIQUE constraint') || String(postErr?.message || '').includes('unique constraint')) {
                                skipped++;
                                logger.event('task.for.save_post.skipped', {
                                  runId: task.runId,
                                  presetId: task.presetId,
                                  stepIndex: i,
                                  loopIndex,
                                  innerStepIndex: innerIdx,
                                  reason: 'unique_constraint',
                                  postUrl: post.post_url,
                                  error: String(postErr?.message || postErr)
                                }, 'debug');
                                continue;
                              }
                              logger.event('task.for.save_post.err', {
                                runId: task.runId,
                                presetId: task.presetId,
                                stepIndex: i,
                                loopIndex,
                                innerStepIndex: innerIdx,
                                error: String(postErr?.message || postErr),
                                postUrl: post.post_url
                              }, 'warn');
                              skipped++;
                            }
                          }

                          logger.event('task.for.save_posts', {
                            runId: task.runId,
                            presetId: task.presetId,
                            stepIndex: i,
                            loopIndex,
                            saved,
                            skipped,
                            total: searchResults.posts.length,
                            totalSaved
                          }, 'info');

                          // pr_save_resultに保存結果を設定
                          gatheredVars.pr_save_result = {
                            saved,
                            skipped,
                            total: searchResults.posts.length,
                            totalSaved
                          };

                          logger.event('task.for.save_posts.completed', {
                            runId: task.runId,
                            presetId: task.presetId,
                            stepIndex: i,
                            loopIndex,
                            innerStepIndex: innerIdx,
                            saved,
                            skipped,
                            total: searchResults.posts.length,
                            totalSaved
                          }, 'info');
                        } else {
                          logger.event('task.for.save_posts.skipped', {
                            runId: task.runId,
                            presetId: task.presetId,
                            stepIndex: i,
                            loopIndex,
                            innerStepIndex: innerIdx,
                            reason: !searchResults ? 'no_search_results' : (!searchResults.posts ? 'no_posts_property' : 'posts_not_array'),
                            searchResultsType: typeof searchResults,
                            searchResultsKeys: searchResults && typeof searchResults === 'object' ? Object.keys(searchResults) : null
                          }, 'warn');
                        }
                      }
                    } catch (saveErr: any) {
                      logger.event('task.for.save_posts.err', {
                        runId: task.runId,
                        presetId: task.presetId,
                        stepIndex: i,
                        loopIndex,
                        innerStepIndex: innerIdx,
                        error: String(saveErr?.message || saveErr),
                        errorStack: saveErr?.stack ? String(saveErr.stack).substring(0, 500) : null
                      }, 'error');

                      // エラー時もpr_save_resultを設定
                      gatheredVars.pr_save_result = {
                        saved: 0,
                        skipped: 0,
                        total: 0,
                        error: String(saveErr?.message || saveErr)
                      };
                    }
                  } else {
                    logger.event('task.for.save_posts.condition_not_met', {
                      runId: task.runId,
                      presetId: task.presetId,
                      stepIndex: i,
                      loopIndex,
                      innerStepIndex: innerIdx,
                      resultVar,
                      isPrSaveResult: resultVar === 'pr_save_result',
                      includesSaveResult: resultVar.includes('save_result')
                    }, 'info');
                  }
                } else {
                  logger.event('task.for.inner_step.result_var.invalid', {
                    runId: task.runId,
                    presetId: task.presetId,
                    stepIndex: i,
                    loopIndex,
                    innerStepIndex: innerIdx,
                    resultVar,
                    resultVarType: typeof resultVar,
                    resultVarLength: typeof resultVar === 'string' ? resultVar.length : null,
                    resultVarTrimmed: typeof resultVar === 'string' ? resultVar.trim() : null
                  }, 'info');
                }
              } else {
                logger.event('task.for.inner_step.result_var.skip', {
                  runId: task.runId,
                  presetId: task.presetId,
                  stepIndex: i,
                  loopIndex,
                  innerStepIndex: innerIdx,
                  hasResultVar: !!innerStep.result_var,
                  hasInnerResp: !!innerResp,
                  innerRespOk: !!(innerResp && innerResp.ok),
                  hasInnerRespBody: !!(innerResp && innerResp.body)
                }, 'info');
              }

              // エラーが発生した場合はループを中断
              if (!innerResp.ok) {
                iterationError = `Inner step ${innerIdx} failed: ${JSON.stringify(innerResp.body)}`;
                break;
              }
            } catch (innerErr: any) {
              iterationError = `Inner step ${innerIdx} exception: ${String(innerErr?.message || innerErr)}`;
              iterationResults.push({ stepIndex: innerIdx, step: innerStep, error: iterationError });
              break;
            }
          }

          forResults.push({
            loopIndex,
            loopCount: loopIndex + 1,
            results: iterationResults,
            error: iterationError
          });

          // ループ変数を復元
          if (originalLoopIndex !== undefined) {
            gatheredVars.loop_index = originalLoopIndex;
          } else {
            delete gatheredVars.loop_index;
          }
          if (originalLoopCount !== undefined) {
            gatheredVars.loop_count = originalLoopCount;
          } else {
            delete gatheredVars.loop_count;
          }
          // itemVarを復元
          if (originalItemVar !== undefined) {
            gatheredVars[itemVar] = originalItemVar;
          } else {
            delete gatheredVars[itemVar];
          }

          // エラーが発生した場合はループを中断
          if (iterationError) {
            break;
          }

          // max_postsに達した場合はループを終了
          if (maxPosts !== null && totalSaved >= maxPosts) {
            logger.event('task.for.early_exit', {
              runId: task.runId,
              presetId: task.presetId,
              stepIndex: i,
              loopIndex,
              totalSaved,
              maxPosts
            }, 'info');
            break;
          }
        }

        const resp = {
          status: 200,
          ok: true,
          body: {
            count,
            maxPosts,
            iterations: forResults,
            completed: forResults.length,
            totalSaved
          }
        };

        runLog.steps.push({ index: i, step: st, result: resp });

        logger.event('task.for.complete', {
          runId: task.runId,
          presetId: task.presetId,
          index: i,
          count,
          completed: forResults.length
        }, 'info');

        // forステップの後続処理をスキップ
        const postWaitSeconds = typeof st.postWaitSeconds === 'number' && st.postWaitSeconds > 0 ? st.postWaitSeconds : 0;
        if (postWaitSeconds > 0) {
          await new Promise((r) => setTimeout(r, Math.round(postWaitSeconds * 1000)));
        }
        continue; // 次のステップへ
      }

      // save_follower_countステップは内部で処理する（callExecを呼ばない）
      let resp: any = undefined;
      if (st.type === 'save_follower_count') {
        // save_follower_countステップ: pr_follower_countとpr_following_countをx_accountsテーブルに保存
        try {
          const followerCount = gatheredVars.pr_follower_count;
          const followingCount = gatheredVars.pr_following_count;

          // x_accountsテーブルのcontainer_idにはXID（Xアカウントのユーザー名、例：astrosynth87208）が保存されている
          // したがって、gatheredVars.db_container_name（XID）を使用する
          const containerIdForUpdate = gatheredVars.db_container_name ? String(gatheredVars.db_container_name) : null;

          if (containerIdForUpdate && (typeof followerCount === 'number' || typeof followingCount === 'number')) {
            const updateFields: string[] = [];

            if (typeof followerCount === 'number') {
              updateFields.push('follower_count = ?');
            }

            if (typeof followingCount === 'number') {
              updateFields.push('following_count = ?');
            }

            if (updateFields.length > 0) {
              // 既存のレコードが存在するか確認（XIDで検索）
              const existing = dbQuery<any>('SELECT container_id FROM x_accounts WHERE container_id = ? LIMIT 1', [containerIdForUpdate])[0];

              const now = Date.now();
              const savedData: any = {};
              if (typeof followerCount === 'number') savedData.followerCount = followerCount;
              if (typeof followingCount === 'number') savedData.followingCount = followingCount;

              if (existing) {
                // レコードが存在する場合はUPDATE
                const updateValues: any[] = [];
                if (typeof followerCount === 'number') {
                  updateValues.push(followerCount);
                }
                if (typeof followingCount === 'number') {
                  updateValues.push(followingCount);
                }
                updateValues.push(now); // updated_at
                updateValues.push(containerIdForUpdate); // WHERE条件（UUID形式）

                const updateSql = `UPDATE x_accounts SET ${updateFields.join(', ')}, updated_at = ? WHERE container_id = ?`;
                dbRun(updateSql, updateValues);
              } else {
                // レコードが存在しない場合はスキップ（INSERTしない）
                // x_accountsテーブルのレコードは通常、ログイン処理やアカウント登録処理で作成されるべきです
                // フォロワー数取得・保存時点でレコードが存在しない場合、不完全なレコードを作成するのを避けるため、警告を出してスキップします
                resp = {
                  status: 404,
                  ok: false,
                  body: {
                    error: `x_accountsテーブルにレコードが存在しません: ${containerIdForUpdate}`,
                    message: 'フォロワー数とフォロー数を保存するには、先にアカウントを登録してください',
                    containerId: containerIdForUpdate,
                    followerCount: typeof followerCount === 'number' ? followerCount : null,
                    followingCount: typeof followingCount === 'number' ? followingCount : null,
                  }
                };

                logger.event('task.save_follower_count.no_record', {
                  runId: task.runId,
                  presetId: task.presetId,
                  index: i,
                  containerId: task.containerId,
                  containerIdForUpdate: containerIdForUpdate,
                  followerCount: typeof followerCount === 'number' ? followerCount : null,
                  followingCount: typeof followingCount === 'number' ? followingCount : null,
                  message: 'x_accountsテーブルにレコードが存在しないため、フォロワー数とフォロー数の保存をスキップしました',
                }, 'warn');

                // ここで早期リターンするのではなく、後続の処理でrespをチェックするため、処理を続行します
              }

              // 既存レコードが存在し、UPDATEが成功した場合のみ成功レスポンスを設定
              if (existing) {
                resp = {
                  status: 200,
                  ok: true,
                  body: {
                    saved: savedData,
                    containerId: containerIdForUpdate,
                    message: `フォロワー数とフォロー数を保存しました: ${JSON.stringify(savedData)}`
                  }
                };

                logger.event('task.save_follower_count.success', {
                  runId: task.runId,
                  presetId: task.presetId,
                  index: i,
                  containerId: task.containerId,
                  containerIdForUpdate: containerIdForUpdate,
                  followerCount: typeof followerCount === 'number' ? followerCount : null,
                  followingCount: typeof followingCount === 'number' ? followingCount : null,
                }, 'info');
              }
            } else {
              resp = {
                status: 400,
                ok: false,
                body: {
                  error: 'pr_follower_countまたはpr_following_countが数値として設定されていません',
                  pr_follower_count: followerCount,
                  pr_following_count: followingCount,
                }
              };
              logger.event('task.save_follower_count.no_data', {
                runId: task.runId,
                presetId: task.presetId,
                index: i,
                followerCount: typeof followerCount === 'number' ? followerCount : null,
                followingCount: typeof followingCount === 'number' ? followingCount : null,
              }, 'warn');
            }
          } else {
            resp = {
              status: 400,
              ok: false,
              body: {
                error: 'db_container_name（XID）が取得できないか、pr_follower_count/pr_following_countが数値ではありません',
                hasDbContainerName: !!containerIdForUpdate,
                db_container_name: containerIdForUpdate || null,
                pr_follower_count: typeof followerCount === 'number' ? followerCount : null,
                pr_following_count: typeof followingCount === 'number' ? followingCount : null,
              }
            };
            logger.event('task.save_follower_count.invalid_params', {
              runId: task.runId,
              presetId: task.presetId,
              index: i,
              hasDbContainerName: !!containerIdForUpdate,
              db_container_name: containerIdForUpdate || null,
              followerCount: typeof followerCount === 'number' ? followerCount : null,
              followingCount: typeof followingCount === 'number' ? followingCount : null,
            }, 'warn');
          }
        } catch (e: any) {
          resp = {
            status: 500,
            ok: false,
            body: {
              error: 'save_follower_countステップでエラーが発生しました: ' + String(e?.message || e),
            }
          };
          logger.event('task.save_follower_count.err', {
            runId: task.runId,
            presetId: task.presetId,
            index: i,
            err: String(e?.message || e),
          }, 'error');
        }
        runLog.steps.push({ index: i, step: st, result: resp });
        // save_follower_countは内部処理なので、ここで次のステップへ
        // ただし、後続の処理（ログ出力など）を実行する必要がある
        // respが設定されているので、後続の処理をスキップせずに続行
      }

      // save_follower_countの場合は既にrespが設定されているので、callExecをスキップ
      let cmdPayload: any = undefined;
      if (st.type === 'save_follower_count') {
        // 既に処理済み（990行目あたりで処理済み）
        // respは既に設定されているので、後続の処理をスキップ
      } else {
        cmdPayload = { contextId: actualContainerId, command: st.type };
        try {
          if (st.type === 'navigate') {
            // navigateステップの前に、pr_post_library_id / post_library_id が指定されている場合、DBからURLを取得
            const postLibraryIdRaw = gatheredVars.pr_post_library_id || gatheredVars.post_library_id || (task.overrides?.post_library_id);
            if (postLibraryIdRaw && (!st.url || String(st.url).includes('{{pr_post_info.post_url}}'))) {
              try {
                const postLibraryId = typeof postLibraryIdRaw === 'string' ? parseInt(postLibraryIdRaw, 10) : Number(postLibraryIdRaw);
                if (isNaN(postLibraryId) || postLibraryId <= 0) {
                  throw new Error(`Invalid post_library_id: ${postLibraryIdRaw}`);
                }
                const record = dbQuery<any>('SELECT id, source_url, content, account_id, post_id_threads FROM post_library WHERE id = ?', [postLibraryId]);
                if (!record || record.length === 0) {
                  throw new Error(`Post library record not found for ID: ${postLibraryId}`);
                }
                const rec = record[0];
                const url = rec.source_url || rec.content || '';
                if (!url) {
                  throw new Error(`URL not found in post library record ID: ${postLibraryId}`);
                }
                gatheredVars.post_url = url;
                gatheredVars.pr_post_info = {
                  post_library_id: rec.id,
                  post_url: url.split('?')[0],
                  account_id: rec.account_id,
                  post_id: rec.post_id_threads,
                  use_existing_record: true
                };
                logger.event('task.navigate.loaded_from_post_library', {
                  runId: task.runId,
                  presetId: task.presetId,
                  stepIndex: i,
                  post_library_id: postLibraryId,
                  post_url: gatheredVars.post_url
                }, 'info');
              } catch (loadErr: any) {
                logger.event('task.navigate.db_load_error', {
                  runId: task.runId,
                  presetId: task.presetId,
                  stepIndex: i,
                  error: String(loadErr?.message || loadErr)
                }, 'error');
                throw loadErr;
              }
            }

            const raw = (task.overrides && task.overrides.url) ? task.overrides.url : st.url;
            cmdPayload.url = applyTemplate(raw, gatheredVars);
            if (!cmdPayload.url || String(cmdPayload.url).trim() === '') {
              throw new Error('navigate URL is empty after template substitution');
            }
            // URL must start with http://, https://, about:, or data:
            if (!String(cmdPayload.url).match(/^(https?:\/\/|about:|data:)/)) {
              throw new Error(`invalid URL format (must start with http://, https://, about:, or data:): ${cmdPayload.url}`);
            }
            // navigateステップでプロキシを指定できるようにする
            const proxyRaw = st.proxy || (st.params && st.params.proxy) || gatheredVars.proxy || task.overrides?.proxy;
            if (proxyRaw && String(proxyRaw).trim() !== '') {
              const proxyStr = applyTemplate(String(proxyRaw), gatheredVars);
              if (proxyStr && String(proxyStr).trim() !== '') {
                const parts = String(proxyStr).split(':');
                if (parts.length >= 3) {
                  // IP:PORT:USERNAME:PASSWORD 形式
                  cmdPayload.proxy = {
                    server: parts[0].trim() + ':' + parts[1].trim(),
                    username: parts[2].trim() || undefined,
                    password: parts[3]?.trim() || undefined
                  };
                } else if (parts.length === 2) {
                  // IP:PORT 形式（ユーザー名・パスワードなし）
                  cmdPayload.proxy = {
                    server: parts[0].trim() + ':' + parts[1].trim()
                  };
                }
              }
            }
          }
          if (st.type === 'click' || st.type === 'type' || st.type === 'clickAndType') {
            const rawSel = (task.overrides && task.overrides.selector) ? task.overrides.selector : st.selector;
            if (!rawSel) {
              throw new Error('click/type/clickAndType step missing selector');
            }
            cmdPayload.selector = applyTemplate(rawSel, gatheredVars);
          }
          if (st.type === 'eval') {
            // db_post_contentの自動取得: ステップコードに{{db_post_content}}が含まれている場合
            if (!gatheredVars.db_post_content) {
              const stepCode = st.code || st.eval || '';
              const needsDbPostContent = typeof stepCode === 'string' && stepCode.includes('{{db_post_content}}');
              const usePostLibrary = preset.use_post_library === 1 || preset.use_post_library === true;
              const shouldAutoLoad = usePostLibrary || needsDbPostContent;

              // postLibraryItemが既に設定されていても、db_post_contentが未設定の場合は取得を試みる
              if (shouldAutoLoad) {
                try {
                  // トランザクション内で投稿を取得し、同時に使用済みにマーク（競合を防ぐ）
                  const postRecord = await transaction(async () => {
                    // まず投稿を取得
                    // used_atがNULLではないused=0のレコードは不整合の可能性があるため除外
                    const candidates = dbQuery<any>(
                      `SELECT id, rewritten_content, media_paths, used, download_status 
                       FROM post_library 
                       WHERE rewritten_content IS NOT NULL 
                         AND rewritten_content != '' 
                         AND (media_paths IS NULL OR media_paths = '' OR download_status = 'completed')
                         AND used = 0 
                         AND (used_at IS NULL OR used_at = 0)
                       ORDER BY created_at ASC 
                       LIMIT 1`
                    );

                    if (!candidates || candidates.length === 0) {
                      return null;
                    }

                    const candidate = candidates[0];
                    const postId = candidate.id;
                    const now = Date.now();

                    // 取得と同時に使用済みにマーク（アトミック操作）
                    const updateResult = dbRun(
                      `UPDATE post_library 
                       SET used = 1, used_at = ?, updated_at = ? 
                       WHERE id = ? AND used = 0`,
                      [now, now, postId]
                    );

                    // 更新された行数が0の場合、他のタスクが既に使用済みにマークした（競合）
                    if (updateResult.changes === 0) {
                      return null;
                    }

                    // 更新成功した場合、投稿情報を返す
                    return candidate;
                  });

                  if (postRecord) {
                    gatheredVars.db_post_content = postRecord.rewritten_content;
                    gatheredVars.post_library_id = postRecord.id;
                    gatheredVars.pr_post_library_id = postRecord.id;
                    postLibraryItem = { id: postRecord.id } as any;

                    if (postRecord.media_paths && String(postRecord.media_paths).trim() !== '') {
                      const mediaPaths = String(postRecord.media_paths).split(',').map((p: string) => p.trim()).filter((p: string) => p);
                      gatheredVars.db_post_media_paths = mediaPaths;
                    } else {
                      gatheredVars.db_post_media_paths = [];
                    }

                    logger.event('task.db_post_content.loaded_auto', {
                      runId: task.runId,
                      presetId: task.presetId,
                      stepIndex: i,
                      postLibraryId: postRecord.id,
                      hasContent: !!gatheredVars.db_post_content,
                      reason: usePostLibrary ? 'use_post_library flag' : 'db_post_content used in step'
                    }, 'info');
                  } else {
                    // 使用可能な投稿がない場合、または競合が発生した場合はタスクを失敗させる
                    const errorMsg = '使用可能な投稿データが見つかりません。post_libraryに未使用の投稿データを追加してください。';
                    logger.event('task.db_post_content.not_found_auto', {
                      runId: task.runId,
                      presetId: task.presetId,
                      stepIndex: i,
                      reason: 'no unused post found or race condition'
                    }, 'error');
                    throw new Error(errorMsg);
                  }
                } catch (e: any) {
                  logger.event('task.db_post_content.load_auto_err', {
                    runId: task.runId,
                    presetId: task.presetId,
                    stepIndex: i,
                    err: String(e?.message || e)
                  }, 'warn');
                  // エラーを再スロー（タスクを失敗させる）
                  throw e;
                }
              }
            }


            // ステップ5（stepIndex 4）の前処理：メールアドレス自動取得
            // プリセットID 22（メールアドレス変更）の場合、email_accountsから新しいメールアドレスを取得
            if (task.presetId === 22 && i === 4) {
              // プリセットID 22の場合は、常にemail_accountsから新しいメールアドレスを取得
              // （既にdb_new_emailが設定されている場合でも、新しいメールアドレスを取得する）
              try {
                logger.event('task.auto_acquire_email.start', {
                  runId: task.runId,
                  presetId: task.presetId,
                  stepIndex: i,
                  containerId: actualContainerId || task.containerId,
                  currentDbNewEmail: gatheredVars?.db_new_email || null,
                  note: 'preset22: acquire new email from email_accounts before step 5'
                }, 'info');

                // プリセットID 22の場合は、常にemail_accountsから新しいメールアドレスを取得
                // （x_accountsに既にemailが設定されていても、新しいメールアドレスを取得する）
                let emailData: { email: string; password: string; emailAccountId?: number } | null = null;
                const maxRetries = 3;

                for (let retry = 0; retry < maxRetries; retry++) {
                  try {
                    emailData = transaction(() => {
                      // 1. 未使用のメールアドレスを1件取得
                      const available = dbQuery<{ id: number; email_password: string }>(
                        'SELECT id, email_password FROM email_accounts WHERE used_at IS NULL ORDER BY added_at ASC LIMIT 1',
                        []
                      );

                      if (!available || available.length === 0) {
                        return null;
                      }

                      const emailAccount = available[0];

                      // 2. email:password形式をパース
                      const parts = emailAccount.email_password.split(':');
                      if (parts.length < 2) {
                        logger.event('task.auto_acquire_email.invalid_format', {
                          runId: task.runId,
                          emailAccountId: emailAccount.id,
                          emailPasswordPreview: emailAccount.email_password.substring(0, 30) + '...',
                          retry
                        }, 'warn');
                        return null;
                      }

                      const email = parts[0];
                      const password = parts.slice(1).join(':'); // パスワードにコロンが含まれる場合に対応

                      // 3. used_atを即座に更新（排他制御：条件付きUPDATEで競合を防ぐ）
                      const now = Date.now();
                      const updateResult = dbRun(
                        'UPDATE email_accounts SET used_at = ? WHERE id = ? AND used_at IS NULL',
                        [now, emailAccount.id]
                      );

                      // 更新件数が0の場合は、他のタスクが先に取得済み
                      if (!updateResult.changes || updateResult.changes === 0) {
                        logger.event('task.auto_acquire_email.already_acquired', {
                          runId: task.runId,
                          emailAccountId: emailAccount.id,
                          email: email.substring(0, 20) + '...',
                          retry
                        }, 'warn');
                        return null;
                      }

                      // 4. x_accountsには登録しない（メールアドレス変更タスクなので、変更前に登録しない）
                      // タスク実行後に成功した場合にのみ、x_accountsを更新する

                      logger.event('task.auto_acquire_email.success', {
                        runId: task.runId,
                        presetId: task.presetId,
                        stepIndex: i,
                        containerId: actualContainerId || task.containerId,
                        emailAccountId: emailAccount.id,
                        email: email.substring(0, 20) + '...',
                        retry
                      }, 'info');

                      return { email, password, emailAccountId: emailAccount.id };
                    }) as { email: string; password: string } | null;

                    // 取得成功した場合はループを抜ける
                    if (emailData) {
                      break;
                    }

                    // 取得失敗した場合、リトライ前に少し待機（指数バックオフ）
                    if (retry < maxRetries - 1) {
                      const delayMs = 50 * Math.pow(2, retry); // 50ms, 100ms, 200ms
                      await new Promise(resolve => setTimeout(resolve, delayMs));
                      logger.event('task.auto_acquire_email.retry', {
                        runId: task.runId,
                        presetId: task.presetId,
                        stepIndex: i,
                        retry: retry + 1,
                        maxRetries,
                        delayMs
                      }, 'debug');
                    }
                  } catch (retryErr: any) {
                    logger.event('task.auto_acquire_email.retry_error', {
                      runId: task.runId,
                      presetId: task.presetId,
                      stepIndex: i,
                      retry,
                      error: String(retryErr?.message || retryErr)
                    }, 'warn');

                    // 最後のリトライでエラーが発生した場合は、そのエラーを再スロー
                    if (retry === maxRetries - 1) {
                      throw retryErr;
                    }

                    // リトライ前に少し待機
                    const delayMs = 50 * Math.pow(2, retry);
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                  }
                }

                if (emailData) {
                  // x_accountsに既に同じメールアドレスが登録されているかチェック
                  // x_accounts.container_idにはXIDが保存されているため、gatheredVars.db_container_nameを使用
                  const containerIdForCheck = gatheredVars.db_container_name || null;
                  const xAccountCheck = dbQuery<{ email: string | null }>(
                    'SELECT email FROM x_accounts WHERE container_id = ?',
                    [containerIdForCheck]
                  );
                  const currentEmail = xAccountCheck?.[0]?.email;

                  if (currentEmail && currentEmail.trim().toLowerCase() === emailData.email.trim().toLowerCase()) {
                    // 既にDBに同じメールアドレスが登録されている場合は処理を停止
                    stopped = true;
                    const reason = `既にDBに登録されているメールアドレス（${currentEmail}）と同じため、処理を停止します`;
                    runLog.error = reason;

                    logger.event('task.auto_acquire_email.already_registered', {
                      runId: task.runId,
                      presetId: task.presetId,
                      stepIndex: i,
                      containerId: containerIdForCheck,
                      email: emailData.email.substring(0, 20) + '...',
                      currentEmail: currentEmail.substring(0, 20) + '...',
                      reason
                    }, 'info');

                    // メールアドレスは解放しない（ユーザー要求：新しく取得したメールを戻す処理は不要）
                    // emailDataをnullに設定して、gatheredVarsへの反映をスキップ
                    emailData = null;
                  } else {
                    // メールアドレスが異なる場合は、gatheredVarsに反映
                    gatheredVars.db_new_email = emailData.email;
                    gatheredVars.db_email_credential = `${emailData.email}:${emailData.password}`;

                    logger.event('task.auto_acquire_email.gathered_vars_set', {
                      runId: task.runId,
                      presetId: task.presetId,
                      stepIndex: i,
                      hasDbNewEmail: !!gatheredVars.db_new_email,
                      hasDbEmailCredential: !!gatheredVars.db_email_credential,
                      email: emailData.email.substring(0, 20) + '...'
                    }, 'info');
                  }
                } else {
                  logger.event('task.auto_acquire_email.failed', {
                    runId: task.runId,
                    presetId: task.presetId,
                    stepIndex: i,
                    containerId: actualContainerId || task.containerId,
                    reason: 'no_available_email_or_already_acquired'
                  }, 'warn');

                  // 失敗時はエラーを投げずに続行（eval内でチェックするため）
                  // メールアドレスが未設定のまま続行される
                }
              } catch (acquireErr: any) {
                logger.event('task.auto_acquire_email.exception', {
                  runId: task.runId,
                  presetId: task.presetId,
                  stepIndex: i,
                  containerId: actualContainerId || task.containerId,
                  error: String(acquireErr?.message || acquireErr)
                }, 'error');

                // メールアドレス取得に失敗した場合は、そのまま続行（eval内でチェックするため）
                // 失敗をthrowしない
              }
            }

            // 2FAコード入力ステップの直前でTOTPコードを生成
            // ステップのdescriptionまたはevalコードに「2FA」や「pr_authentication_code」「pr_totp_code」が含まれている場合
            const descHas2FA = st.description && (
              String(st.description).includes('2FA') ||
              String(st.description).includes('two factor') ||
              String(st.description).includes('two-factor')
            );
            const codeHasTotpVar = (st.code || st.eval || '').toString().includes('pr_totp_code');
            const codeHasAuthVar = (st.code || st.eval || '').toString().includes('pr_authentication_code');
            const isTwoFactorStep = descHas2FA || codeHasTotpVar || codeHasAuthVar;

            // 🔍 デバッグ: TOTP生成前の状態確認
            if (isTwoFactorStep) {
              logger.event('task.totp_code.condition_check', {
                runId: task.runId,
                presetId: task.presetId,
                stepIndex: i,
                descHas2FA,
                codeHasTotpVar,
                codeHasAuthVar,
                isTwoFactorStep,
                db_twofa_code_exists: !!gatheredVars.db_twofa_code,
                db_twofa_code_type: typeof gatheredVars.db_twofa_code,
                db_twofa_code_value: gatheredVars.db_twofa_code ? String(gatheredVars.db_twofa_code).substring(0, 50) : 'undefined'
              }, 'info');
            }

            if (isTwoFactorStep && gatheredVars.db_twofa_code && typeof gatheredVars.db_twofa_code === 'string' && gatheredVars.db_twofa_code.trim() !== '') {
              try {
                const { generateTOTPCode } = await import('./totpGenerator');
                const totpCode = generateTOTPCode(gatheredVars.db_twofa_code);
                gatheredVars.pr_authentication_code = totpCode;
                gatheredVars.pr_totp_code = totpCode;
                logger.event('task.totp_code.generated_before_2fa_step', {
                  runId: task.runId,
                  presetId: task.presetId,
                  stepIndex: i,
                  codeLength: totpCode.length
                }, 'info');
              } catch (e: any) {
                logger.event('task.totp_code.generation_failed', {
                  runId: task.runId,
                  presetId: task.presetId,
                  stepIndex: i,
                  error: String(e?.message || e)
                }, 'warn');
                // TOTPコード生成に失敗しても続行（手動入力の場合もあるため）
              }
            } else if (isTwoFactorStep) {
              logger.event('task.totp_code.skipped_no_db_twofa_code', {
                runId: task.runId,
                presetId: task.presetId,
                stepIndex: i,
                db_twofa_code_exists: !!gatheredVars.db_twofa_code
              }, 'warn');
            }

            const rawEval = (task.overrides && typeof task.overrides === 'object' && task.overrides.eval) ? task.overrides.eval : (st.code || st.eval || (st.params && (st.params.eval || st.params.code)));
            if (!rawEval) throw new Error('eval missing');

            // 🔍 デバッグ: eval ステップ開始時のgatheredVars状態を確認
            logger.event('task.eval.before.template', {
              runId: task.runId,
              presetId: task.presetId,
              index: i,
              gatheredVarsKeys: Object.keys(gatheredVars),
              pr_verification_code_exists: !!gatheredVars['pr_verification_code'],
              pr_verification_code_value: gatheredVars['pr_verification_code'],
              rawEvalLength: String(rawEval).length,
              hasTemplateVar: String(rawEval).includes('{{pr_verification_code}}'),
            }, 'info');

            // evalコード内でスキップロジックが含まれている場合は、空文字列を許可してテンプレート展開する
            // これにより、banner_image_pathやavatar_image_pathが未指定の場合でも、evalコード内でスキップできる
            // また、db_new_email のようなオプションパラメータが未設定の場合も対応
            const hasSkipLogic = String(rawEval).includes('skipped')
              || String(rawEval).includes('not provided')
              || String(rawEval).includes('未指定')
              || String(rawEval).includes('trim() === \'\'')
              || String(rawEval).includes('=== \'undefined\'');  // db_new_email未設定時の判定パターン
            cmdPayload.eval = applyTemplate(rawEval, gatheredVars, hasSkipLogic, true);
          }
          if (st.type === 'setFileInput') {
            const rawSel = (task.overrides && task.overrides.selector) ? task.overrides.selector : st.selector;
            if (!rawSel || String(rawSel).trim() === '') {
              throw new Error('setFileInput step requires selector');
            }
            cmdPayload.selector = applyTemplate(rawSel, gatheredVars);
            if (!cmdPayload.selector || String(cmdPayload.selector).trim() === '') {
              throw new Error('setFileInput selector is empty after template substitution');
            }
            const rawFileUrl = (task.overrides && task.overrides.fileUrl) ? task.overrides.fileUrl : (st.fileUrl || st.file_url);
            // fileUrlがテンプレート変数の場合、未指定の場合はスキップ
            // テンプレート変数名を抽出（{{variable_name}}形式）
            const templateVarMatch = String(rawFileUrl || '').match(/\{\{([A-Za-z0-9_-]+)\}\}/);
            if (templateVarMatch) {
              const varName = templateVarMatch[1];
              // テンプレート変数が未指定または空文字列の場合はスキップ
              if (!gatheredVars || typeof gatheredVars[varName] === 'undefined' || gatheredVars[varName] === null || String(gatheredVars[varName]).trim() === '') {
                runLog.steps.push({
                  index: i,
                  step: st,
                  result: { ok: true, skipped: true, reason: `${varName} not provided, skipping` }
                });
                const postWaitSeconds = typeof st.postWaitSeconds === 'number' && st.postWaitSeconds > 0 ? st.postWaitSeconds : 0;
                if (postWaitSeconds > 0) {
                  await new Promise((r) => setTimeout(r, Math.round(postWaitSeconds * 1000)));
                }
                continue; // 次のステップへ
              }
            }
            cmdPayload.fileUrl = applyTemplate(rawFileUrl, gatheredVars);
            if (st.fileName || st.file_name) {
              cmdPayload.fileName = applyTemplate(st.fileName || st.file_name, gatheredVars);
            }
            if (st.fileType || st.file_type) {
              cmdPayload.fileType = applyTemplate(st.fileType || st.file_type, gatheredVars);
            }
            // setFileInputの前に、セレクター要素の存在を確認
            // 要素が見つからない場合はスキップ（前のステップがスキップされた可能性）
            if (cmdPayload.selector && typeof cmdPayload.selector === 'string' && cmdPayload.selector.trim() !== '') {
              try {
                // タイムアウト値を先に計算
                const stepOptions = Object.assign({}, (st.options && typeof st.options === 'object') ? st.options : {});
                const timeoutMs = resolveStepTimeoutMs(st, defaultTimeoutSeconds);
                const checkResp = await callExec({
                  contextId: actualContainerId,
                  command: 'eval',
                  eval: `(function() { try { const el = document.querySelector(${JSON.stringify(cmdPayload.selector)}); return { found: !!el, reason: el ? 'element found' : 'element not found' }; } catch(e) { return { found: false, reason: String(e) }; } })()`,
                  options: { timeoutMs }
                });

                // エラーレスポンスの場合も処理
                if (checkResp && !checkResp.ok) {
                  const errorDetail = (checkResp as any).errorDetail;
                  logger.event('task.setFileInput.check.error', {
                    runId: task.runId,
                    presetId: task.presetId,
                    index: i,
                    selector: cmdPayload.selector,
                    errorType: errorDetail?.type || checkResp.body?.errorType || null,
                    errorCode: errorDetail?.code || checkResp.body?.errorCode || null,
                    errorMessage: errorDetail?.message || checkResp.body?.errorMessage || null,
                  }, 'warn');
                  // エラーの場合もスキップとして扱う（setFileInputコマンドでエラーハンドリング）
                }

                const checkResult = normalizeExecResult(checkResp);
                if (!checkResult || !checkResult.found) {
                  // 要素が見つからない場合はスキップ
                  runLog.steps.push({
                    index: i,
                    step: st,
                    result: { ok: true, skipped: true, reason: checkResult?.reason || 'selector element not found, previous step may have been skipped' }
                  });
                  const postWaitSeconds = typeof st.postWaitSeconds === 'number' && st.postWaitSeconds > 0 ? st.postWaitSeconds : 0;
                  if (postWaitSeconds > 0) {
                    await new Promise((r) => setTimeout(r, Math.round(postWaitSeconds * 1000)));
                  }
                  continue; // 次のステップへ
                }
              } catch (checkErr: any) {
                // チェックエラーは無視して続行（setFileInputコマンドでエラーハンドリング）
                logger.event('task.setFileInput.check.exception', {
                  runId: task.runId,
                  presetId: task.presetId,
                  index: i,
                  selector: cmdPayload.selector,
                  error: String(checkErr?.message || checkErr),
                  errorStack: checkErr?.stack ? checkErr.stack.substring(0, 300) : null,
                }, 'warn');
              }
            }
          }
        } catch (te: any) {
          const errorMsg = String(te?.message || te);
          runLog.steps.push({ index: i, step: st, result: null, error: errorMsg });
          // db_*変数のテンプレートエラーの場合、詳細情報をログに記録
          if (errorMsg.includes('template variables missing') && errorMsg.includes('db_')) {
            logger.event('task.template_error.db_vars_missing', {
              runId: task.runId,
              presetId: task.presetId,
              containerId: task.containerId,
              stepIndex: i,
              stepName: st.name || st.description || st.type,
              error: errorMsg,
              containerName: gatheredVars.db_container_name || null,
              hasDbContainerName: !!gatheredVars.db_container_name,
            }, 'error');
          }
          runLog.error = `template substitution failed: ${errorMsg}`;
          throw new Error(runLog.error);
        }
      }
      // save_follower_countの場合は既にrespが設定されているので、callExecをスキップ
      if (st.type !== 'save_follower_count') {
        if (st.type === 'type') cmdPayload.text = applyTemplate(st.text || '', gatheredVars);
        const options = Object.assign({}, (st.options && typeof st.options === 'object') ? st.options : {});
        options.timeoutMs = resolveStepTimeoutMs(st, defaultTimeoutSeconds);
        // type/click は要素が出現してから実行する必要があるため、waitForSelector が未指定なら selector で埋める
        if ((st.type === 'type' || st.type === 'click') && cmdPayload.selector && (!options.waitForSelector || String(options.waitForSelector).trim() === '')) {
          options.waitForSelector = cmdPayload.selector;
        }
        // type ステップは Container Browser の type が contenteditable で効かないため、eval に差し替えて送る
        if (st.type === 'type') {
          cmdPayload.command = 'eval';
          cmdPayload.eval = buildTypeAsEvalCode(cmdPayload.selector, cmdPayload.text);
          delete cmdPayload.selector;
          delete cmdPayload.text;
          delete cmdPayload.value;
        }
        cmdPayload.options = options;
        // special-case: handle 'wait' and 'fetch_email' locally since export-server may not support these commands
        if (st.type === 'fetch_email') {
          // メール取得ステップ: サーバー側でFirstMail APIを呼び出す
          try {
            // メール認証情報の取得（email_credentialパラメータのみを使用）
            // このステップはemail_credentialパラメータが必須です
            const emailCredentialRaw = st.email_credential || st.emailCredential || '';

            if (!emailCredentialRaw || String(emailCredentialRaw).trim() === '') {
              resp = { status: 400, ok: false, body: { error: 'email_credential is required for fetch_email step' } };
            } else {
              let credential = '';

              // gatheredVarsから取得を試みる（テンプレート置換）
              try {
                credential = applyTemplate(emailCredentialRaw, gatheredVars);
              } catch (e) {
                // テンプレート変数が不足している場合はエラー
                resp = { status: 400, ok: false, body: { error: 'email_credential parameter is required. Please provide email_credential in params.' } };
              }

              // respが既に設定されている場合はスキップ（エラーが発生した場合）
              if (!resp) {
                // テンプレート置換後の値が空でないことを確認
                if (!credential || String(credential).trim() === '' || String(credential) === '{{email_credential}}') {
                  resp = { status: 400, ok: false, body: { error: 'email_credential parameter is required. Please provide email_credential in params.' } };
                } else {
                  // email:password形式で分割
                  const parts = String(credential).split(':');
                  if (parts.length < 2) {
                    resp = { status: 400, ok: false, body: { error: 'email_credential must be in format "email:password"' } };
                  } else {
                    const email = parts[0].trim();
                    const emailPassword = parts.slice(1).join(':').trim(); // パスワードに:が含まれる場合に対応

                    if (!email || !emailPassword) {
                      resp = { status: 400, ok: false, body: { error: 'email_credential must be in format "email:password" (both email and password are required)' } };
                    } else {
                      const subjectPattern = st.subject_pattern || st.subjectPattern || 'verification|確認コード|code|confirm|メールアドレスを確認';
                      const codePattern = st.code_pattern || st.codePattern || '\\d{6}';
                      // タイムアウトはステップのタイムアウト（options.timeoutMs）を使用
                      const timeoutMs = options.timeoutMs || 60000; // デフォルト60秒
                      const timeoutSeconds = Math.round(timeoutMs / 1000);
                      const resultVar = st.result_var || st.resultVar || 'pr_verification_code';
                      const fromPattern = st.from_pattern || st.fromPattern;

                      logger.event('task.fetch_email.start', {
                        runId: task.runId,
                        presetId: task.presetId,
                        index: i,
                        email,
                        timeoutSeconds
                      }, 'info');

                      const fetchResult = await fetchVerificationCode({
                        email: String(email),
                        email_password: String(emailPassword),
                        subject_pattern: String(subjectPattern),
                        code_pattern: String(codePattern),
                        timeout_seconds: timeoutSeconds,
                        from_pattern: fromPattern ? String(fromPattern) : undefined
                      });

                      if (fetchResult.ok && fetchResult.code) {
                        // 取得したコードをgatheredVarsに格納
                        gatheredVars[resultVar] = fetchResult.code;

                        // 🔍 デバッグ: fetch_email 直後のgatheredVars状態を確認
                        logger.event('task.fetch_email.gathered_vars.set', {
                          runId: task.runId,
                          presetId: task.presetId,
                          index: i,
                          resultVar: resultVar,
                          codeValue: fetchResult.code,
                          gatheredVarsKeys: Object.keys(gatheredVars),
                          pr_verification_code_exists: !!gatheredVars['pr_verification_code'],
                          pr_verification_code_value: gatheredVars['pr_verification_code'],
                        }, 'info');

                        resp = {
                          status: 200,
                          ok: true,
                          body: {
                            code: fetchResult.code,
                            message: fetchResult.message || '確認コードを取得しました',
                            resultVar: resultVar
                          }
                        };
                        logger.event('task.fetch_email.success', {
                          runId: task.runId,
                          presetId: task.presetId,
                          index: i,
                          email,
                          codeLength: fetchResult.code.length
                        }, 'info');
                      } else {
                        resp = {
                          status: 400,
                          ok: false,
                          body: {
                            error: fetchResult.error || 'UNKNOWN_ERROR',
                            message: fetchResult.message || 'メールから確認コードを取得できませんでした'
                          }
                        };
                        logger.event('task.fetch_email.failure', {
                          runId: task.runId,
                          presetId: task.presetId,
                          index: i,
                          email,
                          error: fetchResult.error
                        }, 'warn');
                      }
                    }
                  }
                }
              }
            }
          } catch (feErr: any) {
            resp = {
              status: 500,
              ok: false,
              body: {
                error: 'FETCH_EMAIL_EXCEPTION',
                message: `メール取得処理中にエラーが発生しました: ${String(feErr?.message || feErr)}`
              }
            };
            logger.event('task.fetch_email.exception', {
              runId: task.runId,
              presetId: task.presetId,
              index: i,
              error: String(feErr?.message || feErr)
            }, 'error');
          }
          runLog.steps.push({ index: i, step: st, result: resp });
        } else if (st.type === 'wait') {
          // ms-based wait
          if (typeof st.ms === 'number' && st.ms > 0) {
            await new Promise(r => setTimeout(r, Number(st.ms)));
            resp = { status: 200, ok: true, body: { waitedMs: st.ms } };
          } else {
            // selector-based wait: poll using exec eval
            const selector = (st.selector || (st.options && st.options.waitForSelector) || null);
            const timeout = Number(options.timeoutMs || 15000);
            if (!selector) {
              resp = { status: 400, ok: false, body: { error: 'wait requires ms or selector' } };
            } else {
              const start = Date.now();
              let found = false;
              let lastResp: any = null;
              let lastError: any = null;
              while (Date.now() - start < timeout) {
                try {
                  lastResp = await callExec({ contextId: actualContainerId, command: 'eval', eval: `!!document.querySelector(${JSON.stringify(selector)})`, options: { timeoutMs: timeout } });
                  // エラーレスポンスの場合も記録
                  if (lastResp && !lastResp.ok) {
                    lastError = lastResp;
                    logger.event('task.wait.callExec.error', {
                      runId: task.runId,
                      presetId: task.presetId,
                      index: i,
                      selector,
                      errorType: lastResp.errorDetail?.type || lastResp.body?.errorType || null,
                      errorCode: lastResp.errorDetail?.code || lastResp.body?.errorCode || null,
                      errorMessage: lastResp.errorDetail?.message || lastResp.body?.errorMessage || null,
                    }, 'warn');
                  }
                } catch (e: any) {
                  lastError = e;
                  lastResp = null;
                  logger.event('task.wait.callExec.exception', {
                    runId: task.runId,
                    presetId: task.presetId,
                    index: i,
                    selector,
                    error: String(e?.message || e),
                    errorStack: e?.stack ? e.stack.substring(0, 300) : null,
                  }, 'warn');
                }
                if (lastResp && lastResp.body === true) { found = true; break; }
                await new Promise(r => setTimeout(r, 500));
              }
              resp = { status: 200, ok: true, body: { found, lastResp, lastError: lastError ? String(lastError?.message || lastError) : null } };
              if (!found) resp.ok = false;
            }
          }
          runLog.steps.push({ index: i, step: st, result: resp });
          // special wait handled above
        } else {
          resp = await callExec(cmdPayload);
          runLog.steps.push({ index: i, step: st, result: resp });
        }

        // ステップ4（stepIndex 3）の前処理：x_accounts.emailをgatheredVarsに設定（プリセット22用）
        // プリセットID 22（メールアドレス変更）の場合、ステップ3のevalコードで使用するため
        if (task.presetId === 22 && i === 2) {
          try {
            // x_accounts.container_idにはXIDが保存されているため、gatheredVars.db_container_nameを使用
            const containerIdForCheck = gatheredVars.db_container_name || null;
            const xAccountCheck = dbQuery<{ email: string | null }>(
              'SELECT email FROM x_accounts WHERE container_id = ?',
              [containerIdForCheck]
            );

            const currentEmail = xAccountCheck?.[0]?.email;
            if (currentEmail && currentEmail.trim()) {
              gatheredVars.db_x_accounts_email = String(currentEmail).trim();
              logger.event('task.db_x_accounts_email.loaded', {
                runId: task.runId,
                presetId: task.presetId,
                stepIndex: i,
                containerId: containerIdForCheck,
                email: currentEmail.substring(0, 20) + '...'
              }, 'debug');
            } else {
              // DBのメールアドレスが空の場合は設定しない（チェックをスキップするため）
              gatheredVars.db_x_accounts_email = '';
              logger.event('task.db_x_accounts_email.empty', {
                runId: task.runId,
                presetId: task.presetId,
                stepIndex: i,
                containerId: actualContainerId || task.containerId
              }, 'debug');
            }
          } catch (checkErr: any) {
            logger.event('task.db_x_accounts_email.load_error', {
              runId: task.runId,
              presetId: task.presetId,
              stepIndex: i,
              containerId: actualContainerId || task.containerId,
              error: String(checkErr?.message || checkErr)
            }, 'warn');
            // エラー時は空文字列を設定（チェックをスキップするため）
            gatheredVars.db_x_accounts_email = '';
          }
        }

        // アカウント凍結検出: evalステップの結果にsuspended: trueが含まれている場合
        if (st.type === 'eval' && resp && resp.body && typeof resp.body === 'object' && 'result' in resp.body) {
          const evalResult = resp.body.result;
          if (evalResult && typeof evalResult === 'object') {
            // 凍結検出: Bannedグループに移動
            if (evalResult.suspended === true) {
              const containerIdForGroup = actualContainerId || task.containerId;
              if (containerIdForGroup) {
                try {
                  // BannedグループのIDを取得
                  const bannedGroup = dbQuery<any>('SELECT id FROM container_groups WHERE name = ? LIMIT 1', ['Banned'])[0];
                  if (bannedGroup) {
                    const now = Date.now();

                    // 移動前のグループ情報を取得（container_group_members更新前）
                    const previousMembership = dbQuery<any>(
                      'SELECT cgm.group_id, cg.name as group_name FROM container_group_members cgm LEFT JOIN container_groups cg ON cgm.group_id = cg.id WHERE cgm.container_id = ? LIMIT 1',
                      [String(containerIdForGroup)]
                    )[0];
                    const previousGroupName = previousMembership?.group_name || '(グループ未所属)';

                    // container_group_membersテーブルに追加（既に存在する場合は更新）
                    dbRun(
                      'INSERT INTO container_group_members(container_id, group_id, created_at, updated_at) VALUES(?,?,?,?) ON CONFLICT(container_id) DO UPDATE SET group_id=excluded.group_id, updated_at=excluded.updated_at',
                      [String(containerIdForGroup), bannedGroup.id, now, now]
                    );

                    // x_accountsテーブルに移動情報を記録
                    updateXAccountGroupMoveInfo(String(containerIdForGroup), bannedGroup.id, now, previousGroupName);

                    // アカウントステータスイベントをDBに記録
                    dbRun(
                      'INSERT INTO account_status_events(container_id, event_type, status, error_message, created_at) VALUES(?,?,?,?,?)',
                      [String(containerIdForGroup), 'suspended', 'banned', evalResult.error || 'アカウントが凍結されています', now]
                    );

                    logger.event('account.suspended.moved_to_banned', {
                      runId: task.runId,
                      presetId: task.presetId,
                      stepIndex: i,
                      error: evalResult.error || 'アカウントが凍結されています',
                      containerId: containerIdForGroup,
                      containerName: containerName || null,
                      groupId: bannedGroup.id
                    }, 'warn');
                  } else {
                    logger.event('account.suspended.banned_group_not_found', {
                      runId: task.runId,
                      presetId: task.presetId,
                      stepIndex: i,
                      containerId: containerIdForGroup
                    }, 'error');
                  }
                } catch (e: any) {
                  logger.event('account.suspended.move_failed', {
                    runId: task.runId,
                    presetId: task.presetId,
                    stepIndex: i,
                    containerId: containerIdForGroup,
                    error: String(e?.message || e)
                  }, 'error');
                }
              }

              logger.event('account.suspended.detected', {
                runId: task.runId,
                presetId: task.presetId,
                stepIndex: i,
                error: evalResult.error || 'アカウントが凍結されています',
                containerId: actualContainerId || task.containerId || null,
                containerName: containerName || null
              }, 'warn');
            }

            // Cloudflareチャレンジ検出: ロック状態（suspendedとは別扱い）
            if (evalResult.locked === true) {
              const containerIdForLock = actualContainerId || task.containerId;
              if (containerIdForLock) {
                // アカウントステータスイベントをDBに記録
                const now = Date.now();
                dbRun(
                  'INSERT INTO account_status_events(container_id, event_type, status, error_message, created_at) VALUES(?,?,?,?,?)',
                  [String(containerIdForLock), 'locked', 'cloudflare_challenge', evalResult.error || 'Cloudflareチャレンジページが表示されています', now]
                );
              }

              logger.event('account.locked.detected', {
                runId: task.runId,
                presetId: task.presetId,
                stepIndex: i,
                error: evalResult.error || 'Cloudflareチャレンジページが表示されています',
                containerId: actualContainerId || task.containerId || null,
                containerName: containerName || null
              }, 'warn');
            }

            // ログインページ検出: ログインが必要な状態（suspendedとは別扱い、Bannedグループには移動しない）
            if (evalResult.login_required === true) {
              const containerIdForLogin = actualContainerId || task.containerId;
              if (containerIdForLogin) {
                // アカウントステータスイベントをDBに記録
                const now = Date.now();
                dbRun(
                  'INSERT INTO account_status_events(container_id, event_type, status, error_message, created_at) VALUES(?,?,?,?,?)',
                  [String(containerIdForLogin), 'login_required', 'login_page', evalResult.error || 'ログインページが表示されています', now]
                );
              }

              logger.event('account.login_required.detected', {
                runId: task.runId,
                presetId: task.presetId,
                stepIndex: i,
                error: evalResult.error || 'ログインページが表示されています',
                containerId: actualContainerId || task.containerId || null,
                containerName: containerName || null
              }, 'warn');
            }
          }
        }

        const normalized = normalizeExecResult(resp);
        let reason: string | null = null;
        if (normalized && typeof normalized.reason === 'string') {
          reason = normalized.reason;
        } else if (resp && resp.body && typeof resp.body === 'object') {
          if (typeof resp.body.reason === 'string') reason = resp.body.reason;
          else if (typeof resp.body.error === 'string') reason = resp.body.error;
          else if (typeof resp.body.errorMessage === 'string') reason = resp.body.errorMessage;
        }

        // エラーレスポンスの場合、詳細情報を抽出
        const errorDetail = resp?.errorDetail || null;
        const errorType = errorDetail?.type || resp?.body?.errorType || null;
        const errorCode = errorDetail?.code || resp?.body?.errorCode || null;
        const isTimeout = errorDetail?.isTimeout || resp?.body?.error === 'TIMEOUT' || false;
        const isNetworkError = errorDetail?.isNetworkError || resp?.body?.error === 'NETWORK_ERROR' || false;

        const stepEventLevel: 'info' | 'warn' | 'error' = resp && resp.ok ? 'info' : (isTimeout || isNetworkError ? 'error' : 'warn');

        // save_follower_countステップの場合、保存した値をログに出力
        const logData: any = {
          runId: task.runId,
          presetId: task.presetId,
          index: i,
          type: st.type,
          description: st.description || null,
          ok: Boolean(resp && resp.ok),
          statusCode: resp ? resp.status : null,
          reason,
          errorType,
          errorCode,
          isTimeout,
          isNetworkError,
          waitStep: st.type === 'wait',
        };

        if (st.type === 'save_follower_count' && resp && resp.body && typeof resp.body === 'object') {
          const body = resp.body as any;
          if (body.saved) {
            logData.savedFollowerCount = body.saved.followerCount || null;
            logData.savedFollowingCount = body.saved.followingCount || null;
            logData.containerName = body.containerName || null;
          }
        }

        logger.event('task.step', logData, stepEventLevel);

        // 重要: HTTPレスポンスのokに依存せず、まず停止レスポンス判定を行う
        if (isStopResponse(resp)) {
          const stopReason = normalizeExecResult(resp)?.reason || resp.body?.reason || 'stopped';

          // "post may have failed" が含まれている場合は失敗として扱う（停止ではない）
          if (stopReason && typeof stopReason === 'string' && stopReason.includes('post may have failed')) {
            runLog.error = stopReason;
            // stopped は設定しない（failed として扱う）
            break;
          }

          stopped = true;
          runLog.error = `step stopped: ${stopReason}`;
          break;
        }
        if (!resp.ok) {
          // 詳細なエラー情報を構築
          const errorParts: string[] = [`step ${i} failed`];
          if (errorType) errorParts.push(`type: ${errorType}`);
          if (errorCode) errorParts.push(`code: ${errorCode}`);
          if (reason) errorParts.push(`reason: ${reason}`);
          if (isTimeout) errorParts.push('(TIMEOUT)');
          if (isNetworkError) errorParts.push('(NETWORK_ERROR)');
          if (errorDetail?.message) errorParts.push(`message: ${errorDetail.message}`);

          const detailedError = errorParts.join(', ');
          runLog.error = detailedError;

          // エラーの詳細をログに記録
          logger.event('task.step.failed', {
            runId: task.runId,
            presetId: task.presetId,
            index: i,
            type: st.type,
            description: st.description || null,
            statusCode: resp?.status || null,
            errorType,
            errorCode,
            errorMessage: errorDetail?.message || reason || 'unknown error',
            isTimeout,
            isNetworkError,
            errorStack: errorDetail?.stack ? errorDetail.stack.substring(0, 500) : null,
          }, 'error');

          break;
        }
        const postWaitSeconds = typeof st.postWaitSeconds === 'number' && st.postWaitSeconds > 0 ? st.postWaitSeconds : 0;
        if (postWaitSeconds > 0) {
          try {
            logger.event('task.step.postWait.start', {
              runId: task.runId,
              presetId: task.presetId,
              index: i,
              postWaitSeconds,
            }, 'info');
            await new Promise((r) => setTimeout(r, Math.round(postWaitSeconds * 1000)));
            logger.event('task.step.postWait.end', {
              runId: task.runId,
              presetId: task.presetId,
              index: i,
              postWaitSeconds,
            }, 'info');
          } catch (e: any) {
            logger.event('task.step.postWait.err', {
              runId: task.runId,
              presetId: task.presetId,
              index: i,
              err: String(e?.message || e),
            }, 'warn');
          }
        }

        // result_varが指定されている場合、結果をgatheredVarsに保存
        const resultVar = st.result_var || st.resultVar;
        if (resultVar && typeof resultVar === 'string' && resultVar.trim() !== '' && resp && resp.ok && resp.body) {
          let valueToSave: any;
          if (st.type === 'fetch_email' && resp.body && typeof resp.body === 'object') {
            // fetch_email ステップの場合、body.code を使用（確認コードの直接の値）
            const body = resp.body as any;
            valueToSave = body.code || body;
          } else if (st.type === 'eval' && resp.body && typeof resp.body === 'object') {
            // evalステップの場合、body.resultが存在する場合はそれを使用、なければbody全体を使用
            // result_var が pr_auth_tokens かつ options.returnCookies のときは body.cookies から auth_token/ct0 を抽出
            const body = resp.body as any;
            if (resultVar === 'pr_auth_tokens' && Array.isArray(body.cookies) && st.options && (st.options as Record<string, unknown>).returnCookies) {
              const authEntry = body.cookies.find((c: { name?: string; value?: string }) => c && c.name === 'auth_token');
              const ct0Entry = body.cookies.find((c: { name?: string; value?: string }) => c && c.name === 'ct0');
              if (authEntry && typeof authEntry.value === 'string' && ct0Entry && typeof ct0Entry.value === 'string') {
                valueToSave = { auth_token: authEntry.value, ct0: ct0Entry.value };
              } else {
                valueToSave = (body.result && typeof body.result === 'object') ? body.result : body;
              }
            } else {
              valueToSave = (body.result && typeof body.result === 'object') ? body.result : body;
            }
          } else if (st.type === 'save_media' && resp.body && typeof resp.body === 'object') {
            // save_media ステップの場合、body全体をそのまま保存
            valueToSave = resp.body;
          } else if (resp.body && typeof resp.body === 'object') {
            // その他のステップではbody全体を使用
            valueToSave = resp.body;
          } else {
            valueToSave = resp.body;
          }

          gatheredVars[resultVar] = valueToSave;

          // 🔍 デバッグ: result_var 処理後のgatheredVars状態を確認
          logger.event('task.step_result.var.set', {
            runId: task.runId,
            presetId: task.presetId,
            index: i,
            stepType: st.type,
            resultVar: resultVar,
            valueToSaveType: typeof valueToSave,
            valueToSaveLength: (typeof valueToSave === 'string' ? valueToSave.length : (typeof valueToSave === 'object' ? Object.keys(valueToSave).length : 'N/A')),
            hasData: !!valueToSave,
            gatheredVarsKeys: Object.keys(gatheredVars),
            pr_verification_code_after: gatheredVars['pr_verification_code'],
          }, 'info');

          // pr_auth_tokensが設定された場合、x_accountsテーブルを更新
          if (resultVar === 'pr_auth_tokens' && valueToSave && typeof valueToSave === 'object' && valueToSave.auth_token && valueToSave.ct0) {
            try {
              // containerIdからコンテナ名を取得
              let containerNameForUpdate: string | null = gatheredVars.db_container_name || gatheredVars.container_name || null;

              if (!containerNameForUpdate && task.containerId) {
                const containerIdStr = String(task.containerId);
                const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(containerIdStr);

                if (isUuid) {
                  try {
                    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
                    const containerDbPath = process.env.DEFAULT_CB_DB || path.join(appData, 'container-browser', 'data.db');

                    if (fs.existsSync(containerDbPath)) {
                      const containerDb = new Database(containerDbPath, { readonly: true });
                      const containerRow = containerDb.prepare('SELECT name FROM containers WHERE id = ? LIMIT 1').get(containerIdStr) as { name?: string } | undefined;
                      if (containerRow && containerRow.name) {
                        containerNameForUpdate = String(containerRow.name);
                      }
                      containerDb.close();
                    }
                  } catch (e: any) {
                    logger.event('task.auth_tokens.container_name_err', { runId: task.runId, containerId: containerIdStr, err: String(e?.message || e) }, 'warn');
                  }
                } else {
                  containerNameForUpdate = containerIdStr;
                }
              }

              if (containerNameForUpdate) {
                const now = Date.now();
                dbRun(
                  'UPDATE x_accounts SET auth_token = ?, ct0 = ?, updated_at = ? WHERE container_id = ?',
                  [String(valueToSave.auth_token), String(valueToSave.ct0), now, containerNameForUpdate]
                );

                logger.event('task.auth_tokens.saved', {
                  runId: task.runId,
                  presetId: task.presetId,
                  index: i,
                  containerId: task.containerId,
                  containerName: containerNameForUpdate,
                  hasAuthToken: !!valueToSave.auth_token,
                  hasCt0: !!valueToSave.ct0
                }, 'info');
              } else {
                logger.event('task.auth_tokens.save_skipped', {
                  runId: task.runId,
                  presetId: task.presetId,
                  index: i,
                  containerId: task.containerId,
                  reason: 'container_name is empty'
                }, 'warn');
              }
            } catch (authErr: any) {
              logger.event('task.auth_tokens.save_error', {
                runId: task.runId,
                presetId: task.presetId,
                index: i,
                containerId: task.containerId,
                error: String(authErr?.message || authErr)
              }, 'error');
            }
          }

          // pr_save_result が設定された場合、pr_media_resultをDBに保存
          if (resultVar === 'pr_save_result' || resultVar.includes('save_result')) {
            logger.event('task.save_result.condition_met', {
              runId: task.runId,
              presetId: task.presetId,
              index: i,
              resultVar,
              hasPrMediaResult: !!(gatheredVars.pr_media_result),
              hasPrPostInfo: !!(gatheredVars.pr_post_info),
            }, 'info');

            try {
              // ケース1: Threads メディア保存（pr_media_result がある場合）
              const mediaResult = gatheredVars.pr_media_result;
              if (mediaResult) {
                const postInfo = gatheredVars.pr_post_info;

                if (postInfo && postInfo.post_url && postInfo.post_library_id) {
                  const now = Date.now();
                  dbRun(
                    'UPDATE post_library SET media_paths = ?, download_status = ?, downloaded_at = ?, media_count = ?, account_id = ?, post_id_threads = ?, updated_at = ? WHERE id = ?',
                    [
                      mediaResult.summary?.paths_comma_separated || '',
                      'success',
                      now,
                      mediaResult.summary?.succeeded || 0,
                      postInfo.account_id || null,
                      postInfo.post_id || null,
                      now,
                      postInfo.post_library_id
                    ]
                  );
                  logger.event('task.save_media.db_updated', {
                    runId: task.runId,
                    presetId: task.presetId,
                    index: i,
                    media_count: mediaResult.summary?.succeeded || 0,
                    post_library_id: postInfo.post_library_id,
                    account_id: postInfo.account_id,
                    post_id: postInfo.post_id
                  }, 'info');
                  gatheredVars.pr_save_result = {
                    saved: 1,
                    media_count: mediaResult.summary?.succeeded || 0,
                    post_library_id: postInfo.post_library_id
                  };
                }
              }
            } catch (mediaErr: any) {
              logger.event('task.save_media.db_update_error', {
                runId: task.runId,
                presetId: task.presetId,
                index: i,
                error: String(mediaErr?.message || mediaErr)
              }, 'error');
            }
          }
        }

        // Special-case: プリセットID 22（メールアドレス変更）の最後のステップが成功した場合、email_changed_atを更新
        if (task.presetId === 22 && i === steps.length - 1 && resp && resp.ok) {
          try {
            const normalized = normalizeExecResult(resp);
            // 最後のステップで成功した場合（didAction: true または ok: true）
            if (normalized && (normalized.didAction === true || normalized.ok === true)) {
              // containerIdからコンテナ名を取得
              let containerNameForUpdate: string | null = gatheredVars.db_container_name || gatheredVars.container_name || null;

              if (!containerNameForUpdate && task.containerId) {
                const containerIdStr = String(task.containerId);
                const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(containerIdStr);

                if (isUuid) {
                  try {
                    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
                    const containerDbPath = process.env.DEFAULT_CB_DB || path.join(appData, 'container-browser', 'data.db');

                    if (fs.existsSync(containerDbPath)) {
                      const containerDb = new Database(containerDbPath, { readonly: true });
                      const containerRow = containerDb.prepare('SELECT name FROM containers WHERE id = ? LIMIT 1').get(containerIdStr) as { name?: string } | undefined;
                      if (containerRow && containerRow.name) {
                        containerNameForUpdate = String(containerRow.name);
                      }
                      containerDb.close();
                    }
                  } catch (e: any) {
                    logger.event('task.email_changed_at.update.container_name_err', { runId: task.runId, containerId: containerIdStr, err: String(e?.message || e) }, 'warn');
                  }
                } else {
                  containerNameForUpdate = containerIdStr;
                }
              }

              if (containerNameForUpdate) {
                const now = Date.now();
                dbRun(
                  'UPDATE x_accounts SET email_changed_at = ?, updated_at = ? WHERE container_id = ?',
                  [now, now, containerNameForUpdate]
                );

                logger.event('task.email_changed_at.updated', {
                  runId: task.runId,
                  presetId: task.presetId,
                  containerId: task.containerId,
                  containerName: containerNameForUpdate,
                  emailChangedAt: now,
                }, 'info');
              } else {
                logger.event('task.email_changed_at.update.container_name_not_found', { runId: task.runId, containerId: task.containerId }, 'warn');
              }
            }
          } catch (e: any) {
            logger.event('task.email_changed_at.update.err', {
              runId: task.runId,
              presetId: task.presetId,
              err: String(e?.message || e),
            }, 'error');
          }
        }

        // Special-case: evalステップの結果から、テンプレート変数として使用可能な値を抽出
        if (st.type === 'eval' && resp && resp.ok && resp.body && typeof resp.body === 'object') {
          const body = resp.body as any;

          // evalステップの結果から、テンプレート変数として使用可能な値を抽出
          // body.resultが存在する場合はそこから取得、なければbodyから直接取得（後方互換性）
          const resultData = (body.result && typeof body.result === 'object') ? body.result : body;

          // containerNameなどの一般的なプロパティをgatheredVarsに設定
          if (resultData.containerName && typeof resultData.containerName === 'string') {
            gatheredVars.containerName = String(resultData.containerName);
            logger.event('task.eval_result.containerName.set', {
              runId: task.runId,
              presetId: task.presetId,
              index: i,
              containerName: resultData.containerName,
            }, 'debug');
          }

          // followerCount/followingCountが含まれている場合、pr_変数に保存
          // body.resultが存在する場合はそこから取得、なければbodyから直接取得（後方互換性）
          if (typeof resultData.followerCount === 'number') {
            gatheredVars.pr_follower_count = resultData.followerCount;
            logger.event('task.eval_result.pr_follower_count.set', {
              runId: task.runId,
              presetId: task.presetId,
              index: i,
              followerCount: resultData.followerCount,
            }, 'info');
          }
          if (typeof resultData.followingCount === 'number') {
            gatheredVars.pr_following_count = resultData.followingCount;
            logger.event('task.eval_result.pr_following_count.set', {
              runId: task.runId,
              presetId: task.presetId,
              index: i,
              followingCount: resultData.followingCount,
            }, 'info');
          }

          // その他の一般的なプロパティも設定（必要に応じて拡張可能）
          // 例: username, userId, statusUrl など

          // 注意: followerCount/followingCountのDB保存は、save_follower_countステップで行う
          // 以下の処理は後方互換性のため残すが、新しいプリセットではsave_follower_countステップを使用すること
          if ((typeof resultData.followerCount === 'number' || typeof resultData.followingCount === 'number') && task.containerId) {
            try {
              // containerIdからコンテナ名を取得（既に取得済みの場合は再利用）
              let containerNameForUpdate: string | null = gatheredVars.db_container_name || gatheredVars.container_name || null;

              if (!containerNameForUpdate) {
                const containerIdStr = String(task.containerId);
                const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(containerIdStr);

                if (isUuid) {
                  // UUID形式の場合、コンテナDBからコンテナ名（XID）を取得
                  try {
                    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
                    const containerDbPath = process.env.DEFAULT_CB_DB || path.join(appData, 'container-browser', 'data.db');

                    if (fs.existsSync(containerDbPath)) {
                      const containerDb = new Database(containerDbPath, { readonly: true });
                      const containerRow = containerDb.prepare('SELECT name FROM containers WHERE id = ? LIMIT 1').get(containerIdStr) as { name?: string } | undefined;
                      if (containerRow && containerRow.name) {
                        containerNameForUpdate = String(containerRow.name);
                      }
                      containerDb.close();
                    }
                  } catch (e: any) {
                    logger.event('task.follower_count.update.container_name_err', { runId: task.runId, containerId: containerIdStr, err: String(e?.message || e) }, 'warn');
                  }
                } else {
                  containerNameForUpdate = containerIdStr;
                }
              }

              if (containerNameForUpdate) {
                // x_accountsテーブルを更新
                const updateFields: string[] = [];
                const updateValues: any[] = [];

                if (typeof resultData.followerCount === 'number') {
                  updateFields.push('follower_count = ?');
                  updateValues.push(resultData.followerCount);
                }

                if (typeof resultData.followingCount === 'number') {
                  updateFields.push('following_count = ?');
                  updateValues.push(resultData.followingCount);
                }

                if (updateFields.length > 0) {
                  updateValues.push(Date.now()); // updated_at
                  updateValues.push(containerNameForUpdate); // WHERE条件

                  const updateSql = `UPDATE x_accounts SET ${updateFields.join(', ')}, updated_at = ? WHERE container_id = ?`;
                  dbRun(updateSql, updateValues);

                  logger.event('task.follower_count.updated', {
                    runId: task.runId,
                    containerId: task.containerId,
                    containerName: containerNameForUpdate,
                    followerCount: resultData.followerCount,
                    followingCount: resultData.followingCount,
                  }, 'info');
                }
              } else {
                logger.event('task.follower_count.update.container_name_not_found', { runId: task.runId, containerId: task.containerId }, 'warn');
              }
            } catch (e: any) {
              logger.event('task.follower_count.update.err', {
                runId: task.runId,
                containerId: task.containerId,
                err: String(e?.message || e),
              }, 'error');
            }
          }

          // Special-case: プリセットID 22（メールアドレス変更）のステップ5（index 4）で取得したメールアドレスをx_accountsテーブルに保存
          if (task.presetId === 22 && i === 4 && resp && resp.ok) {
            try {
              const newEmail = gatheredVars.db_new_email;
              const emailCredential = gatheredVars.db_email_credential;

              if (newEmail && typeof newEmail === 'string' && newEmail.trim() !== '' && newEmail !== '{{db_new_email}}') {
                // containerIdからコンテナ名を取得
                let containerNameForUpdate: string | null = gatheredVars.db_container_name || gatheredVars.container_name || null;

                if (!containerNameForUpdate && task.containerId) {
                  const containerIdStr = String(task.containerId);
                  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(containerIdStr);

                  if (isUuid) {
                    try {
                      const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
                      const containerDbPath = process.env.DEFAULT_CB_DB || path.join(appData, 'container-browser', 'data.db');

                      if (fs.existsSync(containerDbPath)) {
                        const containerDb = new Database(containerDbPath, { readonly: true });
                        const containerRow = containerDb.prepare('SELECT name FROM containers WHERE id = ? LIMIT 1').get(containerIdStr) as { name?: string } | undefined;
                        if (containerRow && containerRow.name) {
                          containerNameForUpdate = String(containerRow.name);
                        }
                        containerDb.close();
                      }
                    } catch (e: any) {
                      logger.event('task.email.save.container_name_err', { runId: task.runId, containerId: containerIdStr, err: String(e?.message || e) }, 'warn');
                    }
                  } else {
                    containerNameForUpdate = containerIdStr;
                  }
                }

                if (containerNameForUpdate) {
                  const now = Date.now();
                  let emailPassword: string | null = null;

                  // email_credentialからパスワードを抽出（email:password形式）
                  if (emailCredential && typeof emailCredential === 'string' && emailCredential.includes(':')) {
                    const parts = String(emailCredential).split(':');
                    if (parts.length >= 2) {
                      emailPassword = parts.slice(1).join(':'); // パスワードに:が含まれる場合に対応
                    }
                  }

                  // emailとemail_passwordを更新
                  if (emailPassword) {
                    dbRun(
                      'UPDATE x_accounts SET email = ?, email_password = ?, updated_at = ? WHERE container_id = ?',
                      [String(newEmail).trim(), emailPassword, now, containerNameForUpdate]
                    );

                    logger.event('task.email.saved', {
                      runId: task.runId,
                      presetId: task.presetId,
                      stepIndex: i,
                      containerId: task.containerId,
                      containerName: containerNameForUpdate,
                      email: String(newEmail).trim().substring(0, 20) + '...',
                      hasPassword: !!emailPassword
                    }, 'info');
                  } else {
                    // パスワードがない場合はemailのみ更新
                    dbRun(
                      'UPDATE x_accounts SET email = ?, updated_at = ? WHERE container_id = ?',
                      [String(newEmail).trim(), now, containerNameForUpdate]
                    );

                    logger.event('task.email.saved_no_password', {
                      runId: task.runId,
                      presetId: task.presetId,
                      stepIndex: i,
                      containerId: task.containerId,
                      containerName: containerNameForUpdate,
                      email: String(newEmail).trim().substring(0, 20) + '...'
                    }, 'info');
                  }
                } else {
                  logger.event('task.email.save.container_name_not_found', { runId: task.runId, containerId: task.containerId }, 'warn');
                }
              } else {
                logger.event('task.email.save.skipped', {
                  runId: task.runId,
                  presetId: task.presetId,
                  stepIndex: i,
                  hasDbNewEmail: !!gatheredVars.db_new_email,
                  dbNewEmailValue: gatheredVars.db_new_email ? String(gatheredVars.db_new_email).substring(0, 30) : 'undefined'
                }, 'debug');
              }
            } catch (e: any) {
              logger.event('task.email.save.err', {
                runId: task.runId,
                presetId: task.presetId,
                stepIndex: i,
                err: String(e?.message || e),
              }, 'error');
            }
          }

          // Special-case: プリセットID 44（メールアドレス取得・更新）のステップ3（index 2）で取得したメールアドレスをemail_accountsテーブルで検索してx_accountsテーブルに保存
          if (task.presetId === 44 && i === 2 && resp && resp.ok && st.type === 'eval') {
            try {
              // 優先順位1: gatheredVars.pr_current_email（result_varで設定された場合）
              // 優先順位2: evalステップの結果から取得
              const body = resp.body as any;
              const resultData = (body.result && typeof body.result === 'object') ? body.result : body;
              const currentEmail = gatheredVars.pr_current_email || resultData.email || (typeof resultData === 'string' && resultData.includes('@') ? resultData : null);

              if (currentEmail && typeof currentEmail === 'string' && currentEmail.trim() !== '' && currentEmail.includes('@') && currentEmail !== '{{pr_current_email}}') {
                const trimmedCurrentEmail = currentEmail.trim();

                // containerIdからコンテナ名を取得
                let containerNameForUpdate: string | null = gatheredVars.db_container_name || gatheredVars.container_name || null;

                if (!containerNameForUpdate && task.containerId) {
                  const containerIdStr = String(task.containerId);
                  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(containerIdStr);

                  if (isUuid) {
                    try {
                      const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
                      const containerDbPath = process.env.DEFAULT_CB_DB || path.join(appData, 'container-browser', 'data.db');

                      if (fs.existsSync(containerDbPath)) {
                        const containerDb = new Database(containerDbPath, { readonly: true });
                        const containerRow = containerDb
                          .prepare('SELECT name FROM containers WHERE id = ? LIMIT 1')
                          .get(containerIdStr) as { name?: string } | undefined;
                        if (containerRow && containerRow.name) {
                          containerNameForUpdate = String(containerRow.name);
                        }
                        containerDb.close();
                      }
                    } catch (e: any) {
                      logger.event(
                        'task.email.fetch.save.container_name_err',
                        { runId: task.runId, containerId: containerIdStr, err: String(e?.message || e) },
                        'warn'
                      );
                    }
                  } else {
                    containerNameForUpdate = containerIdStr;
                  }
                }

                if (!containerNameForUpdate) {
                  logger.event('task.email.fetch.save.container_name_not_found', { runId: task.runId, containerId: task.containerId }, 'warn');
                } else {
                  // email_accountsテーブルでメールアドレスを検索
                  // email_passwordフィールドの最初の部分（:の前）がメールアドレスと一致するレコードを検索
                  const emailAccounts = dbQuery<{ id: number; email_password: string }>(
                    `SELECT id, email_password FROM email_accounts WHERE SUBSTR(email_password, 1, CASE WHEN INSTR(email_password, ':') > 0 THEN INSTR(email_password, ':') - 1 ELSE LENGTH(email_password) END) = ? LIMIT 1`,
                    [trimmedCurrentEmail]
                  );

                  const now = Date.now();

                  if (emailAccounts && emailAccounts.length > 0) {
                    const emailAccount = emailAccounts[0];
                    const emailCredential = String(emailAccount.email_password);
                    const parts = emailCredential.split(':');
                    const email = parts[0].trim();

                    dbRun(
                      'UPDATE x_accounts SET email = ?, email_password = ?, updated_at = ? WHERE container_id = ?',
                      [email, emailCredential, now, containerNameForUpdate]
                    );

                    logger.event(
                      'task.email.fetch.saved',
                      {
                        runId: task.runId,
                        presetId: task.presetId,
                        stepIndex: i,
                        containerId: task.containerId,
                        containerName: containerNameForUpdate,
                        email: email.substring(0, 20) + '...',
                        emailAccountId: emailAccount.id
                      },
                      'info'
                    );
                  } else {
                    logger.event('task.email.fetch.not_found_in_email_accounts', {
                      runId: task.runId,
                      presetId: task.presetId,
                      stepIndex: i,
                      email: trimmedCurrentEmail.substring(0, 20) + '...'
                    }, 'warn');
                  }
                }
              } else {
                logger.event('task.email.fetch.skipped', {
                  runId: task.runId,
                  presetId: task.presetId,
                  stepIndex: i,
                  hasEmail: !!currentEmail,
                  emailValue: currentEmail ? String(currentEmail).substring(0, 30) : 'undefined'
                }, 'debug');
              }
            } catch (e: any) {
              logger.event('task.email.fetch.save.err', {
                runId: task.runId,
                presetId: task.presetId,
                stepIndex: i,
                err: String(e?.message || e),
              }, 'error');
            }
          }
        }

        // Special-case: for navigate, verify returned URL matches expected pattern.
        // Behavior: if HTTP 200 but returned URL does NOT match expected -> treat as stopped.
        if (st.type === 'navigate') {
          let retUrl = (normalizeExecResult(resp) && typeof normalizeExecResult(resp).url === 'string')
            ? normalizeExecResult(resp).url
            : ((resp && resp.body && typeof resp.body.url === 'string') ? resp.body.url : '');

          // navigateコマンドでURLが空文字列の場合、postWaitSecondsの待機後にevalでURLを取得
          // 注意: postWaitSecondsの待機は既に3581-3605行目で実行されているため、ここでは待機しない
          if ((!retUrl || retUrl.trim() === '') && st.postWaitSeconds && typeof st.postWaitSeconds === 'number' && st.postWaitSeconds > 0) {
            try {
              // evalコマンドでwindow.location.hrefを取得
              const evalBody = {
                contextId: actualContainerId,
                command: 'eval' as const,
                eval: 'window.location.href'
              };
              const evalResp = await callExec(evalBody);

              // evalの結果からURLを取得（複数のパターンを試す）
              if (evalResp && evalResp.ok && evalResp.body) {
                let evalUrl = '';
                // パターン1: resp.body.resultが文字列の場合
                if (typeof evalResp.body.result === 'string') {
                  evalUrl = String(evalResp.body.result);
                }
                // パターン2: resp.body.resultがオブジェクトで、resultプロパティがある場合
                else if (evalResp.body.result && typeof evalResp.body.result === 'object' && typeof evalResp.body.result.result === 'string') {
                  evalUrl = String(evalResp.body.result.result);
                }
                // パターン3: normalizeExecResultを使用
                else {
                  const normalized = normalizeExecResult(evalResp);
                  if (normalized && typeof normalized === 'string') {
                    evalUrl = String(normalized);
                  } else if (normalized && typeof normalized === 'object' && typeof normalized.result === 'string') {
                    evalUrl = String(normalized.result);
                  }
                }

                if (evalUrl && evalUrl.trim() !== '') {
                  retUrl = evalUrl.trim();
                  logger.event('task.navigate.url.retrieved_after_wait', {
                    runId: task.runId,
                    presetId: task.presetId,
                    stepIndex: i,
                    url: retUrl,
                    postWaitSeconds: st.postWaitSeconds
                  }, 'debug');
                } else {
                  logger.event('task.navigate.url.retrieve_after_wait.empty', {
                    runId: task.runId,
                    presetId: task.presetId,
                    stepIndex: i,
                    evalRespBody: JSON.stringify(evalResp.body).substring(0, 200)
                  }, 'warn');
                }
              }
            } catch (e: any) {
              logger.event('task.navigate.url.retrieve_after_wait.err', {
                runId: task.runId,
                presetId: task.presetId,
                stepIndex: i,
                err: String(e?.message || e)
              }, 'warn');
            }
          }

          // Determine expected pattern for navigate step.
          // Priority:
          //  1) st.expected.urlContains (preset configured expected contains)
          //  2) cmdPayload.url (the navigate target)
          //  3) st.url fallback
          let expectedCandidate: string | null = null;
          if (st && st.expected && typeof st.expected.urlContains === 'string' && st.expected.urlContains) {
            try {
              expectedCandidate = applyTemplate(st.expected.urlContains, gatheredVars);
            } catch (e) {
              expectedCandidate = st.expected.urlContains;
            }
          }
          if (!expectedCandidate) {
            expectedCandidate = cmdPayload.url || (st.url || null);
          }

          if (expectedCandidate) {
            const expectedStr = String(expectedCandidate);
            let okMatch = false;
            if (expectedStr.startsWith('re:')) {
              try {
                const re = new RegExp(expectedStr.slice(3));
                okMatch = re.test(retUrl);
              } catch (e) {
                okMatch = retUrl === expectedStr;
              }
            } else {
              // If the configured expected came from urlContains, treat it as substring match.
              // Otherwise (when expected is a full URL), allow exact or prefix match.
              const cameFromUrlContains = (st && st.expected && typeof st.expected.urlContains === 'string' && st.expected.urlContains);
              if (cameFromUrlContains) {
                okMatch = retUrl.includes(expectedStr);
              } else {
                // Special case: if expected URL is a search URL with q parameter, allow any query value
                if (expectedStr.startsWith('https://x.com/search?q=') || expectedStr.startsWith('https://twitter.com/search?q=')) {
                  okMatch = retUrl.startsWith('https://x.com/search?q=') || retUrl.startsWith('https://twitter.com/search?q=');
                } else {
                  // Normalize URLs by decoding them for comparison to handle encoding differences
                  let normalizedExpected = expectedStr;
                  let normalizedRet = retUrl;
                  try {
                    normalizedExpected = decodeURIComponent(expectedStr);
                    normalizedRet = decodeURIComponent(retUrl);
                  } catch (e) {
                    // If decoding fails, fall back to original strings
                  }
                  okMatch = retUrl === expectedStr || retUrl.startsWith(expectedStr) || normalizedRet === normalizedExpected || normalizedRet.startsWith(normalizedExpected);
                }
              }
            }
            if (!okMatch) {
              stopped = true;
              runLog.error = `navigate stopped: url mismatch (expected ${expectedStr}, got ${retUrl})`;
              break;
            }
          }
        }

        // stoppedフラグが設定されている場合はステップのループを抜ける
        if (stopped) {
          break;
        }
      }
    } // end of for loop (step execution)
  } catch (e: any) {
    runLog.error = String(e?.message || e);
    logger.event('task.run.err', { runId: task.runId, err: runLog.error }, 'error');
  } finally {
    // do not close here when export opened the container;
    // closing will be handled by the worker after any configured waitMinutes
    try {
      runLog.openedByExport = !!openedByExport;
    } catch (ee: any) {
      runLog.openedByExport = !!openedByExport;
    }
    runLog.end = new Date().toISOString();
    finalStatus = stopped ? 'stopped' : (runLog.error ? 'failed' : 'ok');
    const status = stopped ? 'stopped' : (runLog.error ? 'failed' : 'done');
    const stepCount = Array.isArray(runLog.steps) ? runLog.steps.length : 0;
    logger.event('task.run.finished', { runId: task.runId, presetId: task.presetId, status: finalStatus, error: runLog.error || null, steps: stepCount }, runLog.error ? 'warn' : 'info');

    // Mark post library item as used if execution succeeded
    // 注意: 
    // - post_library_idで明示的に指定された場合は投稿前に既に使用済みに変更済み（1230-1233行目）
    // - use_post_libraryフラグの場合、getUnusedPostItem()内で既に使用済みにマーク済み（1208行目）
    // - 自動取得（{{db_post_content}}使用）の場合、トランザクション内で既に使用済みにマーク済み（2752-2805行目）
    // したがって、ここでの使用済みマーク処理は不要（ログのみ記録）
    if (postLibraryItem && finalStatus === 'ok') {
      const explicitlySpecified = !!(task.overrides?.post_library_id || task.overrides?.postLibraryId);

      if (explicitlySpecified) {
        // post_library_idで明示的に指定された場合は既に投稿前に使用済みに変更済み
        logger.event('task.post_library.already_marked_used', { runId: task.runId, postId: postLibraryItem.id }, 'debug');
      } else {
        // use_post_libraryフラグまたは自動取得の場合、既に使用済みにマーク済み（ログのみ記録）
        logger.event('task.post_library.already_marked_used', { runId: task.runId, postId: postLibraryItem.id, note: 'marked during acquisition' }, 'debug');
      }
    }
    // persist task_runs entry
    try {
      // 全タスク共通の待機時間を使用
      const wm = getGlobalWaitMinutes();
      const statusToInsert = (wm > 0 && finalStatus === 'ok')
        ? 'waiting_success'
        : (wm > 0 && finalStatus === 'failed')
          ? 'waiting_failed'
          : (wm > 0 && finalStatus === 'stopped')
            ? 'waiting_stopped'
            : finalStatus;
      dbRun('INSERT INTO task_runs(runId, task_id, started_at, ended_at, status, result_json) VALUES(?,?,?,?,?,?)',
        [task.runId, task.id || null, Date.parse(runLog.start) || Date.now(), Date.parse(runLog.end) || Date.now(), statusToInsert, JSON.stringify(runLog)]);
      logger.event('task.run.persist', { runId: task.runId, insertedStatus: statusToInsert, waitMinutes: wm }, 'info');
    } catch (e: any) {
      logger.event('task.run.persist.err', { err: String(e?.message || e), runId: task.runId }, 'warn');
    }
    fs.writeFileSync(logPath, JSON.stringify(runLog, null, 2), 'utf8');
    // Note: tasks table status update is handled by startWorker() to properly handle waitMinutes
  }
  return finalStatus;
}

export async function startWorker(queueName: string = DEFAULT_QUEUE_NAME) {
  const queueState = getQueueState(queueName);
  if (queueState.running) return;
  queueState.running = true;
  logger.event('task.worker.start', { queueName }, 'info');

  // On startup, mark any stale 'running' tasks as 'done' (stopped due to server restart)
  // Also mark 'failed' and 'stopped' tasks as 'done' so they don't appear in the active task list
  try {
    const staleRows: any[] = dbQuery('SELECT id, runId FROM tasks WHERE status = ? AND queue_name = ?', ['running', queueName]);
    if (staleRows && staleRows.length > 0) {
      for (const row of staleRows) {
        dbRun('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?', ['done', Date.now(), row.id]);
        // Also update task_runs status to stopped (if exists) to record that it was interrupted
        try {
          dbRun('UPDATE task_runs SET status = ? WHERE runId = ?', ['stopped', row.runId]);
        } catch (trErr: any) {
          // task_runs entry might not exist yet, which is fine
          logger.event('task.worker.reset_stale.task_runs_update.err', { runId: row.runId, err: String(trErr?.message || trErr), queueName }, 'debug');
        }
        logger.event('task.worker.reset_stale', { runId: row.runId, queueName, newStatus: 'done' }, 'info');
      }
    }
    // Clean up failed/stopped tasks on startup
    // BUT: Only clean up if execution is enabled - if stopped, keep them in stopped state
    // IMPORTANT: Only mark as 'done' if task_runs entry exists (task was actually executed)
    // If task_runs entry doesn't exist, the task was never executed, so don't mark as done
    if (queueState.executionEnabled) {
      const finishedRows: any[] = dbQuery(
        `SELECT t.id, t.runId 
         FROM tasks t
         INNER JOIN task_runs tr ON t.runId = tr.runId
         WHERE t.status IN (?, ?) AND t.queue_name = ?`,
        ['failed', 'stopped', queueName]
      );
      if (finishedRows && finishedRows.length > 0) {
        for (const row of finishedRows) {
          dbRun('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?', ['done', Date.now(), row.id]);
          logger.event('task.worker.cleanup_finished', { runId: row.runId, queueName }, 'info');
        }
      }
      // For tasks that are failed/stopped but have no task_runs entry (never executed),
      // reset them to pending so they can be executed
      const unfinishedRows: any[] = dbQuery(
        `SELECT t.id, t.runId 
         FROM tasks t
         LEFT JOIN task_runs tr ON t.runId = tr.runId
         WHERE t.status IN (?, ?) AND t.queue_name = ? AND tr.runId IS NULL`,
        ['failed', 'stopped', queueName]
      );
      if (unfinishedRows && unfinishedRows.length > 0) {
        for (const row of unfinishedRows) {
          dbRun('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?', ['pending', Date.now(), row.id]);
          logger.event('task.worker.reset_unexecuted', { runId: row.runId, queueName, oldStatus: 'failed/stopped', newStatus: 'pending' }, 'info');
        }
      }
    }
  } catch (e: any) {
    logger.event('task.worker.reset_stale.err', { err: String(e?.message || e), queueName }, 'warn');
  }

  let waitingBlockLogged = false;
  while (true) {
    // Refresh executionEnabled state from memory storage in case it was updated by another process
    try {
      const storedExecutionEnabled = memGet(`executionEnabled_${queueName}`);
      if (typeof storedExecutionEnabled === 'boolean') {
        queueState.executionEnabled = storedExecutionEnabled;
      }
    } catch (e: any) {
      logger.event('task.worker.refresh_execution_state.err', { err: String(e?.message || e), queueName }, 'warn');
    }

    if (!queueState.executionEnabled) {
      await new Promise(r => setTimeout(r, 1000));
      continue;
    }
    // Check container browser connectivity before attempting to fetch/run tasks.
    // If the container browser process (export server) is unreachable, pause worker and retry.
    try {
      const okConn = await canConnectToContainerBrowser(2000);
      if (!okConn) {
        const currentFailureCount = (consecutiveContainerBrowserConnectionFailures.get(queueName) || 0) + 1;
        consecutiveContainerBrowserConnectionFailures.set(queueName, currentFailureCount);
        logger.event('task.worker.no_cb_conn', { host: CB_HOST, port: CB_PORT, failureCount: currentFailureCount, queueName }, 'warn');

        // 3回連続失敗時はキュー実行を停止し、Discord通知を送信する（タスク状態は変更しない）
        if (currentFailureCount >= 3) {
          try {
            const cntRow: any = dbQuery('SELECT COUNT(*) AS count FROM tasks WHERE status = ? AND queue_name = ?', ['pending', queueName])[0];
            const pendingCount = Number(cntRow?.count || 0) || 0;

            // キュー実行を停止（UIのトグル表示も停止中になる）
            setExecutionEnabled(false, queueName);
            setExecutionConnectivityIssue(`接続できなかったため停止中になりました（${getQueueDisplayName(queueName)} / ${CB_HOST}:${CB_PORT}）`);
            logger.event('task.worker.stop_queue_due_to_cb_conn', { queueName, pendingCount, host: CB_HOST, port: CB_PORT }, 'warn');

            // Discord通知
            const settings = loadSettings();
            if (settings.discordWebhookUrl && pendingCount > 0) {
              await sendDiscordNotificationForContainerBrowser(settings.discordWebhookUrl, queueName, pendingCount, CB_HOST, CB_PORT);
            }

            // 接続失敗回数をリセット（停止後は再カウントしない）
            consecutiveContainerBrowserConnectionFailures.set(queueName, 0);
          } catch (stopErr: any) {
            logger.event('task.worker.stop_due_to_cb_conn.err', { err: String(stopErr?.message || stopErr), queueName }, 'error');
          }
        }

        // back off a bit before retrying
        await new Promise(r => setTimeout(r, 5000));
        continue;
      } else {
        // 接続成功時は失敗回数をリセット
        if (consecutiveContainerBrowserConnectionFailures.get(queueName) !== 0) {
          consecutiveContainerBrowserConnectionFailures.set(queueName, 0);
          logger.event('task.worker.cb_conn.recovered', { queueName }, 'info');
        }
      }
    } catch (e: any) {
      const currentFailureCount = (consecutiveContainerBrowserConnectionFailures.get(queueName) || 0) + 1;
      consecutiveContainerBrowserConnectionFailures.set(queueName, currentFailureCount);
      logger.event('task.worker.conncheck.err', { err: String(e?.message || e), failureCount: currentFailureCount, queueName }, 'warn');

      // 3回連続失敗時はキュー実行を停止し、Discord通知を送信する（タスク状態は変更しない）
      if (currentFailureCount >= 3) {
        try {
          const cntRow: any = dbQuery('SELECT COUNT(*) AS count FROM tasks WHERE status = ? AND queue_name = ?', ['pending', queueName])[0];
          const pendingCount = Number(cntRow?.count || 0) || 0;

          setExecutionEnabled(false, queueName);
          setExecutionConnectivityIssue(`接続できなかったため停止中になりました（${getQueueDisplayName(queueName)} / ${CB_HOST}:${CB_PORT}）`);
          logger.event('task.worker.stop_queue_due_to_cb_conn', { queueName, pendingCount, host: CB_HOST, port: CB_PORT }, 'warn');

          // Discord通知
          const settings = loadSettings();
          if (settings.discordWebhookUrl && pendingCount > 0) {
            await sendDiscordNotificationForContainerBrowser(settings.discordWebhookUrl, queueName, pendingCount, CB_HOST, CB_PORT);
          }

          // 接続失敗回数をリセット（停止後は再カウントしない）
          consecutiveContainerBrowserConnectionFailures.set(queueName, 0);
        } catch (stopErr: any) {
          logger.event('task.worker.stop_due_to_cb_conn.err', { err: String(stopErr?.message || stopErr), queueName }, 'error');
        }
      }

      await new Promise(r => setTimeout(r, 5000));
      continue;
    }
    if (hasWaitingTasks(queueName)) {
      if (!waitingBlockLogged) {
        logger.event('task.worker.waiting_block', { reason: 'waiting task exists', queueName }, 'info');
        waitingBlockLogged = true;
      }
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    // CRITICAL FIX: Check if there's already a running task - only one task should run at a time per queue
    try {
      const runningRows: any[] = dbQuery('SELECT 1 FROM tasks WHERE status = ? AND queue_name = ? LIMIT 1', ['running', queueName]);
      if (runningRows && runningRows.length > 0) {
        // Another task is already running in this queue, wait before checking again
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
    } catch (e: any) {
      logger.event('task.worker.check_running.err', { err: String(e?.message || e), queueName }, 'warn');
    }
    waitingBlockLogged = false;
    // スケジュールチェックがリクエストされた場合、即座にタスクをチェック
    if (queueState.scheduleCheckRequested) {
      queueState.scheduleCheckRequested = false;
      logger.event('task.worker.schedule_check_triggered', { queueName }, 'info');
    }
    // メモリキューを優先順位でソート: 過去の予定時刻 > 即時実行
    // メモリキューには即時実行可能なタスク（scheduled_at <= now または null）のみが追加される
    const now = Date.now();
    if (queueState.queue.length > 0) {
      queueState.queue.sort((a, b) => {
        const aScheduled = a.scheduledAt || null;
        const bScheduled = b.scheduledAt || null;
        const aIsPast = aScheduled !== null && aScheduled < now;
        const bIsPast = bScheduled !== null && bScheduled < now;
        const aIsNull = aScheduled === null;
        const bIsNull = bScheduled === null;
        // 過去の予定時刻を最優先
        if (aIsPast && !bIsPast) return -1;
        if (!aIsPast && bIsPast) return 1;
        // 次に即時実行（scheduled_at IS NULL）
        if (aIsNull && !bIsNull) return 1;
        if (!aIsNull && bIsNull) return -1;
        // 同じ優先度内では、scheduled_atの昇順（nullの場合は0として扱う）
        const aOrder = aScheduled !== null ? aScheduled : 0;
        const bOrder = bScheduled !== null ? bScheduled : 0;
        return aOrder - bOrder;
      });
    }
    let t: Task | undefined = queueState.queue.shift();
    // if no in-memory task, try fetch one from DB pending
    if (!t) {
      try {
        // CRITICAL FIX: Use transaction to atomically fetch and mark task as running
        // This prevents multiple workers from picking up the same task simultaneously
        // Note: transaction returns T | Promise<T>, but since we're using synchronous operations,
        // it will return T (Task | undefined) synchronously
        const fetchedTask = transaction(() => {
          // 過去の予定時刻（scheduled_at < now）を最優先、次に即時実行（scheduled_at IS NULL）、最後に未来の予定時刻（scheduled_at = now）
          // ORDER BY: 1) 過去の予定時刻優先（scheduled_at < now）、2) 即時実行（scheduled_at IS NULL）、3) 同じ優先度内ではscheduled_at/created_atの昇順
          const rows: any[] = dbQuery(
            'SELECT id, runId, preset_id as presetId, container_id as containerId, overrides_json as overridesJson, scheduled_at as scheduledAt, group_id as groupId, wait_minutes as waitMinutes FROM tasks WHERE status = ? AND queue_name = ? AND (scheduled_at IS NULL OR scheduled_at <= ?) ORDER BY CASE WHEN scheduled_at IS NULL THEN 1 WHEN scheduled_at < ? THEN 0 ELSE 1 END, scheduled_at ASC, created_at ASC LIMIT 1',
            ['pending', queueName, now, now]
          );
          if (rows && rows.length) {
            const row = rows[0];
            // Atomically update status to 'running' only if still 'pending'
            // This ensures only one worker can claim this task
            const updateResult = dbRun(
              'UPDATE tasks SET status = ?, updated_at = ? WHERE id = ? AND status = ?',
              ['running', Date.now(), row.id, 'pending']
            );
            // Check if update was successful (affected rows > 0)
            // In better-sqlite3, RunResult has changes property
            if (updateResult && updateResult.changes > 0) {
              // タスクごとの waitMinutes は無視（後方互換のため型定義上は設定するが、実際の待機時間には使用しない）
              // 実際の待機時間は全タスク共通の設定（getGlobalWaitMinutes）を使用
              const parsedWaitMinutes = (() => {
                if (typeof row.waitMinutes === 'number' && Number.isFinite(row.waitMinutes)) return row.waitMinutes;
                const asNum = Number(row.waitMinutes);
                return Number.isFinite(asNum) ? asNum : 0;
              })();
              return { id: row.id, runId: row.runId, presetId: row.presetId, containerId: row.containerId, overrides: (() => { try { return JSON.parse(row.overridesJson || '{}'); } catch { return {}; } })(), scheduledAt: row.scheduledAt, groupId: row.groupId, waitMinutes: parsedWaitMinutes, queueName };
            } else {
              // Another worker already claimed this task, return undefined
              logger.event('task.worker.claim_failed', { runId: row.runId, queueName }, 'debug');
              return undefined;
            }
          }
          return undefined;
        }) as Task | undefined;
        t = fetchedTask;
      } catch (e: any) {
        logger.event('task.worker.db.err', { err: String(e?.message || e) }, 'error');
        // If task was marked as running but failed to create task object, reset it
        if (t && t.runId) {
          try {
            dbRun('UPDATE tasks SET status = ?, updated_at = ? WHERE runId = ?', ['pending', Date.now(), t.runId]);
            logger.event('task.worker.db.reset_failed', { runId: t.runId }, 'warn');
          } catch (resetErr: any) {
            logger.event('task.worker.db.reset.err', { runId: t.runId, err: String(resetErr?.message || resetErr) }, 'error');
          }
          t = undefined;
        }
      }
    }
    // If execution is disabled, continue waiting instead of breaking
    if (!queueState.executionEnabled) {
      await new Promise(r => setTimeout(r, 1000));
      continue;
    }
    if (!t) {
      // Check if there's a scheduled task in the future
      try {
        const now = Date.now();
        const nextRow: any = dbQuery('SELECT MIN(scheduled_at) AS next FROM tasks WHERE status = ? AND scheduled_at > ? AND queue_name = ?', ['pending', now, queueName]);
        if (nextRow && nextRow.next && Number.isFinite(nextRow.next)) {
          // There's a scheduled task in the future
          const waitMs = nextRow.next - now;
          if (waitMs <= 0) {
            // Time has already passed, continue immediately to check again
            logger.event('task.worker.scheduled_time_passed', { nextScheduledAt: nextRow.next, now, queueName }, 'info');
            continue;
          }
          // Wait until it's time, but check scheduleCheckRequested flag periodically
          const checkInterval = 1000; // Check every 1 second
          const totalWait = waitMs;
          let waited = 0;
          while (waited < totalWait) {
            const remainingWait = Math.min(checkInterval, totalWait - waited);
            await new Promise(r => setTimeout(r, remainingWait));
            waited += remainingWait;
            // If schedule check was requested (timer fired), break immediately
            if (queueState.scheduleCheckRequested) {
              queueState.scheduleCheckRequested = false;
              logger.event('task.worker.schedule_check_interrupted', { waited, totalWait, queueName }, 'info');
              break;
            }
          }
          if (waited >= totalWait) {
            logger.event('task.worker.waiting_for_scheduled', { nextScheduledAt: nextRow.next, waitMs: totalWait, queueName }, 'info');
          }
          continue; // Continue loop to check for the scheduled task
        }
      } catch (e: any) {
        logger.event('task.worker.check_scheduled.err', { err: String(e?.message || e), queueName }, 'warn');
      }
      // No scheduled tasks, break the loop
      break;
    }
    // CRITICAL FIX: For in-memory tasks, mark as running just before runTask() is called
    // For DB-fetched tasks, they are already marked as 'running' in the transaction above
    let taskMarkedAsRunning = false;
    let taskFromDb = false; // Track if task was fetched from DB (already marked as running)
    try {
      if (t.runId) {
        try {
          // Check current status
          const checkRows: any[] = dbQuery('SELECT id, status FROM tasks WHERE runId = ? LIMIT 1', [t.runId]);
          if (checkRows && checkRows.length) {
            const currentStatus = checkRows[0].status;
            if (currentStatus === 'running') {
              // Task is already marked as running (from DB fetch transaction)
              taskMarkedAsRunning = true;
              taskFromDb = true;
              logger.event('task.worker.already_marked_running', { runId: t.runId, source: 'db_transaction' }, 'info');
            } else if (currentStatus === 'pending') {
              // Task from memory queue - mark as running now
              // Use runId to update since t.id might not be set for memory queue tasks
              const updateResult = dbRun('UPDATE tasks SET status = ?, updated_at = ? WHERE runId = ? AND status = ?', ['running', Date.now(), t.runId, 'pending']);
              if (updateResult && updateResult.changes > 0) {
                taskMarkedAsRunning = true;
                // Update t.id from DB if not set
                if (!t.id) {
                  t.id = checkRows[0].id;
                }
                logger.event('task.worker.mark_running', { runId: t.runId, source: 'memory_queue' }, 'info');
              } else {
                // Another worker already claimed this task
                logger.event('task.worker.claim_failed_memory', { runId: t.runId }, 'warn');
                await new Promise(r => setTimeout(r, 100));
                continue; // Skip this task and try next one
              }
            } else {
              // Task is in unexpected state (done, failed, etc.) - skip it
              logger.event('task.worker.unexpected_status', { runId: t.runId, status: currentStatus }, 'warn');
              continue;
            }
          } else {
            // Task not found in DB - skip it
            logger.event('task.worker.not_found', { runId: t.runId }, 'warn');
            continue;
          }
        } catch (checkErr: any) {
          logger.event('task.worker.status_check.err', { runId: t.runId, err: String(checkErr?.message || checkErr) }, 'error');
          // On error, skip this task to avoid getting stuck
          continue;
        }
      }
      // Now actually run the task
      const finalStatus = await runTask(t);

      // 連続失敗回数の追跡と自動停止処理
      if (finalStatus === 'failed') {
        const currentCount = (consecutiveFailureCounts.get(queueName) || 0) + 1;
        consecutiveFailureCounts.set(queueName, currentCount);
        logger.event('task.consecutive_failure', { queueName, count: currentCount }, 'warn');

        // 3回連続失敗時に自動停止
        if (currentCount >= 3) {
          logger.event('task.auto_stop', { queueName, failureCount: currentCount }, 'error');
          setExecutionEnabled(false, queueName);
          consecutiveFailureCounts.set(queueName, 0); // リセット（通知後）

          // Discord通知を送信
          const settings = loadSettings();
          if (settings.discordWebhookUrl) {
            await sendDiscordNotification(settings.discordWebhookUrl, queueName, currentCount);
          }
        }
      } else if (finalStatus === 'ok' || finalStatus === 'stopped') {
        // 成功または停止時は連続失敗回数をリセット
        if (consecutiveFailureCounts.get(queueName) !== 0) {
          consecutiveFailureCounts.set(queueName, 0);
          logger.event('task.consecutive_failure.reset', { queueName }, 'info');
        }
      }

      // 全タスク共通の待機時間を使用（タスクごとの waitMinutes は無視）
      const waitMinutes = getGlobalWaitMinutes();
      logger.event('task.worker.wait_minutes', { runId: t.runId, waitMinutes, finalStatus, taskWaitMinutes: t.waitMinutes }, 'info');

      // Bannedの場合の特別処理: runLogを読み込んでbannedフラグを確認
      let isBannedTask = false;
      try {
        const logPath = path.join(ensureLogsDir(), `${t.runId}.json`);
        if (fs.existsSync(logPath)) {
          const raw = fs.readFileSync(logPath, 'utf8');
          const runLog = JSON.parse(raw || '{}');
          isBannedTask = runLog.banned === true;
        }
      } catch (e: any) {
        // ログ読み込みエラーは無視（通常の処理を続行）
      }

      const statusMap: Record<RunTaskFinalStatus, WaitingStatus> = {
        ok: 'waiting_success',
        failed: 'waiting_failed',
        stopped: 'waiting_stopped',
      };
      let waitingStatus: WaitingStatus | null = null;

      // Bannedの場合は待機せず、すぐにstoppedにして次のタスクに進む
      if (isBannedTask && finalStatus === 'stopped') {
        // Bannedの場合は待機せず、すぐにstoppedにして次のタスクに進む
        dbRun('UPDATE tasks SET status = ?, updated_at = ? WHERE runId = ?', ['stopped', Date.now(), t.runId]);
        try {
          dbRun('UPDATE task_runs SET status = ? WHERE runId = ?', ['stopped', t.runId]);
        } catch (e: any) {
          logger.event('task.worker.update_run_banned.err', { runId: t.runId, err: String(e?.message || e) }, 'warn');
        }
        logger.event('task.worker.banned_skipped', { runId: t.runId, finalStatus }, 'info');
        // コンテナを閉じる処理もスキップ（Bannedの場合はコンテナを開いていない）
        await new Promise(r => setTimeout(r, 100)); // ループ継続前に少し待機
        continue; // 次のタスクに進む
      }

      if (waitMinutes > 0 && statusMap[finalStatus]) {
        waitingStatus = statusMap[finalStatus];
        dbRun('UPDATE tasks SET status = ?, updated_at = ? WHERE runId = ?', [waitingStatus, Date.now(), t.runId]);
        try {
          // reflect waiting status also in task_runs so UI doesn't treat the run as finished immediately
          dbRun('UPDATE task_runs SET status = ? WHERE runId = ?', [waitingStatus, t.runId]);
        } catch (e: any) {
          logger.event('task.worker.update_run_waiting.err', { runId: t.runId, err: String(e?.message || e) }, 'warn');
        }
      }
      // Close container after task execution (regardless of waitMinutes)
      // コンテナIDは runLog.containerId（実際に使用されたID）を優先、次に t.containerId（定義値）
      logger.event('task.worker.close_container.start', { runId: t.runId, taskContainerId: t.containerId || null }, 'info');
      let containerIdToClose: string | null = null;
      try {
        const logPath = path.join(ensureLogsDir(), `${t.runId}.json`);
        if (fs.existsSync(logPath)) {
          const raw = fs.readFileSync(logPath, 'utf8');
          const runLog = JSON.parse(raw || '{}');
          // runLog.containerId を優先（実際に使用されたコンテナID、新規作成時など）
          // 次に t.containerId（元のタスク定義値）
          containerIdToClose = runLog.containerId || t.containerId || null;
          logger.event('task.worker.close_container.read_log', { runId: t.runId, containerId: containerIdToClose, source: runLog.containerId ? 'runLog' : 'task_def', logPath }, 'info');
        } else {
          logger.event('task.worker.close_container.log_not_found', { runId: t.runId, logPath }, 'warn');
          // ログが見つからない場合は、タスク定義から取得
          containerIdToClose = t.containerId || null;
        }
      } catch (e: any) {
        logger.event('task.worker.close_container.read_log.err', { runId: t.runId, err: String(e?.message || e) }, 'warn');
        // エラー時は、タスク定義からフォールバック
        containerIdToClose = t.containerId || null;
      }

      if (containerIdToClose) {
        logger.event('task.worker.close_container.attempt', { runId: t.runId, containerId: containerIdToClose }, 'info');
        try {
          const logPath = path.join(ensureLogsDir(), `${t.runId}.json`);
          if (fs.existsSync(logPath)) {
            const raw = fs.readFileSync(logPath, 'utf8');
            const runLog = JSON.parse(raw || '{}');

            // タスク実行完了後、コンテナを閉じる前に10秒待機（コンテナは開いたまま）
            const preCloseWaitMs = 10000;
            logger.event('task.worker.close_container.pre_wait', { runId: t.runId, containerId: containerIdToClose, waitMs: preCloseWaitMs }, 'info');
            await new Promise(r => setTimeout(r, preCloseWaitMs));
            logger.event('task.worker.close_container.pre_wait.completed', { runId: t.runId, containerId: containerIdToClose }, 'info');

            const closed = await closeContainer(containerIdToClose);
            const isOpenedByExport = runLog.openedByExport === true;

            // ページ遷移が発生した場合、複数のコンテナIDでクローズを試行する
            // ページ遷移は「最後のステップで URL が変わった」ことから検出
            let pageTransitioned = false;
            if (!closed.ok && isOpenedByExport && runLog.steps && Array.isArray(runLog.steps)) {
              const lastStep = runLog.steps[runLog.steps.length - 1];
              if (lastStep && lastStep.result && lastStep.result.body) {
                const finalUrl = lastStep.result.body.url;
                const startUrl = runLog.steps[0]?.result?.body?.url;

                // ページ遷移を検出
                if (finalUrl && startUrl && finalUrl !== startUrl) {
                  pageTransitioned = true;
                  logger.event('task.worker.close_container.page_transitioned', {
                    runId: t.runId,
                    startUrl,
                    finalUrl,
                    containerId: containerIdToClose
                  }, 'info');

                  // ページ遷移時は、元のコンテナIDが無効化されている可能性があるため、
                  // エラーを成功として扱う（コンテナは既に廃棄されたと判断）
                  logger.event('task.worker.close_container.page_transition_fallback', {
                    runId: t.runId,
                    containerId: containerIdToClose,
                    closeError: closed.body?.error || closed.error || 'unknown'
                  }, 'warn');
                }
              }
            }

            // openedByExportの場合、404エラーなどの失敗を成功として扱う
            // 特にページ遷移が検出された場合は、コンテナが無効化されたと判断
            let finalClosed: any = closed;
            if (!closed.ok && isOpenedByExport) {
              logger.event('task.worker.close_container.error_ignored', {
                runId: t.runId,
                containerId: containerIdToClose,
                originalClosed: closed.closed,
                originalOk: closed.ok,
                openedByExport: true,
                pageTransitioned
              }, 'warn');
              finalClosed = { ok: true, closed: true, fallback: true, reason: pageTransitioned ? 'page_transition_detected' : 'export_mode_error_ignored' };
            } else {
              logger.event('task.worker.close_container.result', {
                runId: t.runId,
                containerId: containerIdToClose,
                closed: closed.ok,
                closedStatus: closed.closed,
                closedBody: JSON.stringify(closed).substring(0, 200),
                openedByExport: isOpenedByExport
              }, closed.ok ? 'info' : 'warn');
            }

            runLog.closed = finalClosed;
            runLog.closeAt = new Date().toISOString();
            fs.writeFileSync(logPath, JSON.stringify(runLog, null, 2), 'utf8');
            // update task_runs.result_json to include closed info
            try {
              const row = dbQuery<any>('SELECT id, result_json FROM task_runs WHERE runId = ? LIMIT 1', [t.runId])[0];
              if (row && row.result_json) {
                const existing = (() => { try { return JSON.parse(row.result_json); } catch { return null; } })() || {};
                existing.closed = finalClosed;
                dbRun('UPDATE task_runs SET result_json = ? WHERE runId = ?', [JSON.stringify(existing), t.runId]);
              }
            } catch (e: any) { logger.event('task.worker.update_run_close.err', { runId: t.runId, err: String(e?.message || e) }, 'warn'); }
          } else {
            // ログがなくても containerId がある限りクローズは試行する（未クローズ残り対策）
            logger.event('task.worker.close_container.log_not_found_on_close', { runId: t.runId, logPath }, 'warn');
            const preCloseWaitMs = 10000;
            logger.event('task.worker.close_container.pre_wait', { runId: t.runId, containerId: containerIdToClose, waitMs: preCloseWaitMs }, 'info');
            await new Promise(r => setTimeout(r, preCloseWaitMs));
            logger.event('task.worker.close_container.pre_wait.completed', { runId: t.runId, containerId: containerIdToClose }, 'info');
            const closed = await closeContainer(containerIdToClose);
            logger.event('task.worker.close_container.result', {
              runId: t.runId,
              containerId: containerIdToClose,
              closed: closed.ok,
              closedStatus: closed.closed,
              closedBody: JSON.stringify(closed).substring(0, 200),
              logNotFound: true,
            }, closed.ok ? 'info' : 'warn');
          }
        } catch (e: any) {
          logger.event('task.worker.close_container.scan.err', { runId: t.runId, err: String(e?.message || e) }, 'error');
          // 例外時も containerId があればクローズ試行（未クローズ残り対策）
          if (containerIdToClose) {
            try {
              const closed = await closeContainer(containerIdToClose);
              logger.event('task.worker.close_container.result', {
                runId: t.runId,
                containerId: containerIdToClose,
                closed: closed.ok,
                closedStatus: closed.closed,
                scanErrRecovery: true,
              }, closed.ok ? 'info' : 'warn');
            } catch (closeErr: any) {
              logger.event('task.worker.close_container.scan_err_recovery_failed', { runId: t.runId, containerId: containerIdToClose, err: String(closeErr?.message || closeErr) }, 'warn');
            }
          }
        }
      } else {
        logger.event('task.worker.close_container.no_id', { runId: t.runId, taskContainerId: t.containerId || null }, 'warn');
      }
      if (waitMinutes) {
        logger.event('task.waiting.start', { runId: t.runId, waitMinutes, finalStatus, waitingStatus: Boolean(waitingStatus) }, 'info');
        await waitWithCancellation(t.runId, waitMinutes, queueName);
        logger.event('task.waiting.end', { runId: t.runId, waitMinutes, finalStatus }, 'info');
      }
      // Update task status to 'done' after execution (or after waiting period)
      if (waitingStatus) {
        const postStatus = finalStatus === 'ok' ? 'done' : finalStatus;
        dbRun('UPDATE tasks SET status = ?, updated_at = ? WHERE runId = ?', [postStatus, Date.now(), t.runId]);
        try {
          dbRun('UPDATE task_runs SET status = ? WHERE runId = ?', [finalStatus, t.runId]);
        } catch (e: any) {
          logger.event('task.worker.update_run_postwait.err', { runId: t.runId, err: String(e?.message || e) }, 'warn');
        }
      } else {
        // If no waitMinutes, mark task as 'done' immediately
        const postStatus = finalStatus === 'ok' ? 'done' : finalStatus;
        dbRun('UPDATE tasks SET status = ?, updated_at = ? WHERE runId = ?', [postStatus, Date.now(), t.runId]);
        logger.event('task.worker.mark_done', { runId: t.runId, finalStatus, postStatus }, 'info');
      }
    } catch (e: any) {
      logger.event('task.worker.taskerr', { runId: t.runId, err: String(e?.message || e) }, 'error');
      // CRITICAL FIX: If task was marked as running but runTask() failed,
      // reset it to pending so it can be retried
      // IMPORTANT: Only reset to pending if runTask() was never called (taskMarkedAsRunning is true but runTask() threw before completion)
      // If runTask() was called and completed (even with error), it will have already created task_runs entry, so we should mark as failed
      const runTaskWasCalled = taskMarkedAsRunning; // If we marked as running, we attempted to call runTask
      const hasTaskRunEntry = (() => {
        try {
          const existingRun = dbQuery<any>('SELECT id FROM task_runs WHERE runId = ? LIMIT 1', [t.runId])[0];
          return !!existingRun;
        } catch {
          return false;
        }
      })();

      if (taskMarkedAsRunning && t && t.runId) {
        // If runTask() was never actually called (error occurred before runTask()), reset to pending
        // If runTask() was called and created a task_runs entry, mark as failed
        if (!hasTaskRunEntry) {
          // runTask() was never called, reset to pending
          try {
            dbRun('UPDATE tasks SET status = ?, updated_at = ? WHERE runId = ?', ['pending', Date.now(), t.runId]);
            logger.event('task.worker.reset_on_err', { runId: t.runId, reason: 'runTask never called', error: String(e?.message || e) }, 'warn');
          } catch (resetErr: any) {
            logger.event('task.worker.reset_on_err.db.err', { runId: t.runId, err: String(resetErr?.message || resetErr) }, 'error');
          }
        } else {
          // runTask() was called and created task_runs entry, mark as failed
          try {
            dbRun('UPDATE tasks SET status = ?, updated_at = ? WHERE runId = ?', ['failed', Date.now(), t.runId]);
            // Also update task_runs if it exists
            try {
              const existingRun = dbQuery<any>('SELECT id FROM task_runs WHERE runId = ? LIMIT 1', [t.runId])[0];
              if (existingRun) {
                dbRun('UPDATE task_runs SET status = ? WHERE runId = ?', ['failed', t.runId]);
              }
            } catch (updateRunErr: any) {
              logger.event('task.worker.update_run_on_err.err', { runId: t.runId, err: String(updateRunErr?.message || updateRunErr) }, 'warn');
            }
            logger.event('task.worker.mark_failed_on_err', { runId: t.runId, reason: 'runTask called but failed', error: String(e?.message || e) }, 'warn');
          } catch (updateErr: any) {
            logger.event('task.worker.update_on_err.err', { runId: t.runId, err: String(updateErr?.message || updateErr) }, 'error');
          }
        }
      }
      // CRITICAL FIX: Even on error, ensure container is closed
      try {
        // Close container if it exists (check both t.containerId and runLog.containerId)
        logger.event('task.worker.close_on_err.start', { runId: t.runId, taskContainerId: t.containerId || null }, 'info');
        let containerIdToClose: string | null = t.containerId || null;
        if (!containerIdToClose) {
          try {
            const logPath = path.join(ensureLogsDir(), `${t.runId}.json`);
            if (fs.existsSync(logPath)) {
              const raw = fs.readFileSync(logPath, 'utf8');
              const runLog = JSON.parse(raw || '{}');
              containerIdToClose = runLog.containerId || null;
              logger.event('task.worker.close_on_err.read_log', { runId: t.runId, containerId: containerIdToClose }, 'info');
            } else {
              logger.event('task.worker.close_on_err.log_not_found', { runId: t.runId }, 'warn');
            }
          } catch (e: any) {
            logger.event('task.worker.close_on_err.read_log.err', { runId: t.runId, err: String(e?.message || e) }, 'warn');
          }
        }
        if (containerIdToClose) {
          try {
            let openedByExport = false;
            try {
              const logPath = path.join(ensureLogsDir(), `${t.runId}.json`);
              if (fs.existsSync(logPath)) {
                const raw = fs.readFileSync(logPath, 'utf8');
                const runLog = JSON.parse(raw || '{}');
                openedByExport = runLog.openedByExport === true;
              }
            } catch (e: any) {
              // ログ読み込みエラーは無視して続行
            }

            logger.event('task.worker.close_on_err.attempt', { runId: t.runId, containerId: containerIdToClose }, 'info');

            // タスク実行完了後（エラー時も含む）、コンテナを閉じる前に10秒待機（コンテナは開いたまま）
            const preCloseWaitMs = 10000;
            logger.event('task.worker.close_on_err.pre_wait', { runId: t.runId, containerId: containerIdToClose, waitMs: preCloseWaitMs }, 'info');
            await new Promise(r => setTimeout(r, preCloseWaitMs));
            logger.event('task.worker.close_on_err.pre_wait.completed', { runId: t.runId, containerId: containerIdToClose }, 'info');

            const closed = await closeContainer(containerIdToClose) as unknown as { ok: boolean; closed: boolean; status?: number };

            // openedByExportの場合、404エラーなどの失敗を成功として扱う
            if (!closed.ok && openedByExport) {
              logger.event('task.worker.close_on_err.error_ignored', {
                runId: t.runId,
                containerId: containerIdToClose,
                originalClosed: closed.closed,
                originalOk: closed.ok,
                openedByExport: true
              }, 'warn');
            } else {
              logger.event('task.worker.close_on_err.result', {
                runId: t.runId,
                containerId: containerIdToClose,
                closed: closed.ok,
                closedStatus: closed.closed,
                openedByExport
              }, closed.ok ? 'info' : 'warn');
            }
          } catch (closeErr: any) {
            logger.event('task.worker.close_on_err.outer.err', {
              runId: t.runId,
              containerId: containerIdToClose,
              err: String(closeErr?.message || closeErr)
            }, 'error');
          }
        } else {
          logger.event('task.worker.close_on_err.no_id', { runId: t.runId, taskContainerId: t.containerId || null }, 'warn');
        }
      } catch (closeErr: any) {
        logger.event('task.worker.close_on_err.outer.err', { runId: t.runId, err: String(closeErr?.message || closeErr) }, 'error');
      }
    }
    // CRITICAL FIX: After task completion, continue loop but check for running tasks before next iteration
    // The check for running tasks at the start of the loop ensures only one task runs at a time per queue
    await new Promise(r => setTimeout(r, 100));
  }
  queueState.running = false;
  scheduleNearestPendingTask(queueName);
  logger.event('task.worker.idle', { queueName }, 'info');
}

// Synchronous version used by worker loop to sweep expired waiting tasks
function sweepWaitingTasksSync(queueName: string = DEFAULT_QUEUE_NAME) {
  try {
    const now = Date.now();
    // 全タスク共通の待機時間を使用
    const globalWaitMinutes = getGlobalWaitMinutes();
    const rows: any[] = dbQuery('SELECT runId, status, updated_at FROM tasks WHERE status IN (?,?,?) AND queue_name = ?', ['waiting_success', 'waiting_failed', 'waiting_stopped', queueName]);
    for (const r of rows || []) {
      try {
        const runId = String(r.runId);
        const taskStatus = String(r.status || '');
        const lastRun = dbQuery<any>('SELECT ended_at, status FROM task_runs WHERE runId = ? ORDER BY started_at DESC LIMIT 1', [runId])[0];
        // task_runs が存在しない waiting_stopped は「未実行の停止扱い」なので、
        // 待機時間を設けず即座に pending へ戻す（例: コンテナブラウザ接続失敗時の退避）
        if (!lastRun && taskStatus === 'waiting_stopped') {
          try {
            dbRun('UPDATE tasks SET status = ?, updated_at = ? WHERE runId = ?', ['pending', Date.now(), runId]);
            logger.event('task.sweep.reset_unexecuted_immediate', { runId, from: taskStatus, to: 'pending', queueName }, 'info');
          } catch (e: any) {
            logger.event('task.sweep.reset_unexecuted_immediate.err', { runId, err: String(e?.message || e), queueName }, 'warn');
          }
          continue;
        }
        // task_runsエントリが存在しない場合（例：コンテナブラウザ接続失敗などで未実行のまま待機状態になったタスク）、
        // tasksテーブルのupdated_atを基準に待機時間を計算する
        let endedAt = 0;
        if (lastRun && lastRun.ended_at) {
          endedAt = Number(lastRun.ended_at) || 0;
        } else {
          // task_runsエントリが存在しない場合は、tasks.updated_atを使用
          endedAt = Number(r.updated_at) || 0;
        }
        if (endedAt === 0) continue; // 基準時刻が取得できない場合はスキップ
        const deadline = endedAt + Math.round(globalWaitMinutes * 60000);
        if (deadline <= now) {
          // map waiting_* to final/post statuses
          const finalStatus = taskStatus === 'waiting_success' ? 'ok' : (taskStatus === 'waiting_failed' ? 'failed' : (taskStatus === 'waiting_stopped' ? 'stopped' : null));
          if (!finalStatus) continue;

          // IMPORTANT: Only mark as 'done' if task_runs entry exists (task was actually executed)
          // If task_runs entry doesn't exist, the task was never executed (e.g., container browser connection failure),
          // so reset it to 'pending' instead of marking as 'done'
          if (!lastRun) {
            // task_runsエントリが存在しない場合（実行されていないタスク）、pendingに戻す
            try {
              dbRun('UPDATE tasks SET status = ?, updated_at = ? WHERE runId = ?', ['pending', Date.now(), runId]);
              logger.event('task.sweep.reset_unexecuted', { runId, from: taskStatus, to: 'pending' }, 'info');
            } catch (e: any) {
              logger.event('task.sweep.reset_unexecuted.err', { runId, err: String(e?.message || e) }, 'warn');
            }
            continue;
          }

          const postStatus = finalStatus === 'ok' ? 'done' : finalStatus;
          try {
            dbRun('UPDATE tasks SET status = ?, updated_at = ? WHERE runId = ?', [postStatus, Date.now(), runId]);
            // task_runsエントリが存在する場合のみ更新
            dbRun('UPDATE task_runs SET status = ? WHERE runId = ?', [finalStatus, runId]);
            logger.event('task.sweep.updated', { runId, from: taskStatus, toTaskStatus: postStatus, toRunStatus: finalStatus, hasTaskRun: true }, 'info');
          } catch (e: any) {
            logger.event('task.sweep.update.err', { runId, err: String(e?.message || e) }, 'warn');
          }
        }
      } catch (e: any) {
        logger.event('task.sweep.row.err', { err: String(e?.message || e) }, 'warn');
      }
    }
  } catch (e: any) {
    logger.event('task.sweep.err', { err: String(e?.message || e) }, 'warn');
  }
}

// start on import: async wrapper for potential future use
async function sweepWaitingTasks(queueName: string = DEFAULT_QUEUE_NAME) {
  sweepWaitingTasksSync(queueName);
}

// start on import: first sweep waiting tasks (in case process restarted), then start worker for each queue
for (const queueName of ALL_QUEUE_NAMES) {
  sweepWaitingTasks(queueName).catch(() => { });
  startWorker(queueName).catch(() => { });
}

export { parsePresetStepsJson, resolveStepTimeoutMs };


// Remove queued tasks from in-memory queue by runId.
export function removeQueuedTask(runId: string, queueName: string = DEFAULT_QUEUE_NAME) {
  if (!runId) return 0;
  const queueState = getQueueState(queueName);
  let removed = 0;
  for (let i = queueState.queue.length - 1; i >= 0; i--) {
    try {
      if (String(queueState.queue[i].runId) === String(runId)) {
        queueState.queue.splice(i, 1);
        removed++;
      }
    } catch (e) {
      // ignore
    }
  }
  if (removed) logger.event('task.queue.removed', { runId, removed, queueName }, 'info');
  return removed;
}

export function cancelWaitingRun(runId: string, queueName: string = DEFAULT_QUEUE_NAME) {
  if (!runId) return false;
  const queueState = getQueueState(queueName);
  const resolver = queueState.waitingResolvers.get(runId);
  if (!resolver) return false;
  try {
    resolver();
    logger.event('task.waiting.cancelled', { runId, queueName }, 'info');
  } catch (e: any) {
    logger.event('task.waiting.cancelled.err', { runId, err: String(e?.message || e), queueName }, 'warn');
  }
  return true;
}

/**
 * 指定されたキューのすべてのタスクの予定時刻を更新する
 * @param scheduledAt 新しい予定時刻（ミリ秒のUnixタイムスタンプ）
 * @param queueName キュー名（デフォルト: QUEUE_2_NAME）
 * @returns 更新されたタスク数
 */
export function updateAllTasksScheduledAt(scheduledAt: number, queueName: string = QUEUE_2_NAME): number {
  try {
    const result = dbRun(
      'UPDATE tasks SET scheduled_at = ?, updated_at = ? WHERE queue_name = ?',
      [scheduledAt, Date.now(), queueName]
    );
    const updatedCount = (result as any).changes || 0;
    logger.event('task.scheduled_at.bulk_update', { queueName, scheduledAt, updatedCount }, 'info');
    return updatedCount;
  } catch (e: any) {
    logger.event('task.scheduled_at.bulk_update.err', { queueName, err: String(e?.message || e) }, 'error');
    throw e;
  }
}


