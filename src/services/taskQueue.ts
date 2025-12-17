import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { exportRestored } from './exportedProfiles.js';
import * as PresetService from './presets.js';
import { logger } from '../utils/logger.js';
import { run as dbRun, query as dbQuery, memGet, memSet, transaction } from '../drivers/db.js';
import { loadSettings } from './appSettings.js';

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
import { openContainer, createContainer } from '../drivers/browser.js';
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
  } catch (e:any) {
    logger.event('task.config.reload.err', { err: String(e?.message||e) }, 'warn');
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
  return new Promise((resolve) => {
    try {
      const sock = net.createConnection({ host: CB_HOST, port: CB_PORT }, () => {
        try { sock.destroy(); } catch {}
        resolve(true);
      });
      sock.setTimeout(timeoutMs, () => {
        try { sock.destroy(); } catch {}
        resolve(false);
      });
      sock.on('error', () => {
        try { sock.destroy(); } catch {}
        resolve(false);
      });
    } catch (e) {
      resolve(false);
    }
  });
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
const ALL_QUEUE_NAMES = [
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
      startWorker(queueName).catch((e)=>logger.event('task.worker.err',{err:String(e), queueName},'error'));
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
      startWorker(queueName).catch((e)=>logger.event('task.worker.err',{err:String(e), queueName},'error'));
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
  } catch (e:any) {
    logger.event('task.schedule-next.err', { err: String(e?.message||e), queueName }, 'warn');
  }
}

function hasWaitingTasks(queueName: string = DEFAULT_QUEUE_NAME) {
  try {
    // Before checking if there are waiting tasks, sweep expired ones
    sweepWaitingTasksSync(queueName);
    const rows: any[] = dbQuery('SELECT 1 FROM tasks WHERE status IN (?,?,?) AND queue_name = ? LIMIT 1', ['waiting_success', 'waiting_failed', 'waiting_stopped', queueName]);
    return Array.isArray(rows) && rows.length > 0;
  } catch (e:any) {
    logger.event('task.worker.waiting_check.err', { err: String(e?.message||e), queueName }, 'warn');
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
  try { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); } catch {}
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
  } catch (e:any) {
    logger.event('task.enqueue.db.err', { err: String(e?.message||e), runId, queueName }, 'warn');
  }
  // start worker if not running
  if (!queueState.running) {
    startWorker(queueName).catch((e)=>logger.event('task.worker.err',{err:String(e), queueName},'error'));
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
    startWorker(queueName).catch((e)=>logger.event('task.worker.err',{err:String(e), queueName},'error'));
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
  
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    abortController.abort();
  }, timeoutMs);
  
  const requestBody = JSON.stringify(body);
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
        bodyPreview: typeof parsedBody === 'string' ? parsedBody.substring(0, 200) : JSON.stringify(parsedBody).substring(0, 200),
        command: body?.command || 'unknown',
        contextId: body?.contextId || 'unknown',
      }, 'warn');
    }
    
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
      command: body?.command || 'unknown',
      contextId: body?.contextId || 'unknown',
      bodyPreview: requestBody.substring(0, 200),
    }, 'error');
    
    // エラーレスポンスを返す（呼び出し元で処理できるように）
    return {
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
  }
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

async function closeContainer(containerId: string, timeoutMs = 30000) {
  logger.event('task.close_container.call', { containerId, timeoutMs }, 'info');
  try {
    const url = `http://${CB_HOST}:${CB_PORT}/internal/export-restored/close`;
    logger.event('task.close_container.request', { containerId, url }, 'info');
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: containerId, timeoutMs }) });
    const j = await res.json().catch(()=>({ ok:false }));
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
  } catch (e:any) { 
    logger.event('task.close_container.error', { containerId, err: String(e?.message||e), stack: e?.stack?.substring(0, 200) }, 'error');
    return { ok:false, error: String(e?.message||e) }; 
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
  
  // db_*パラメータは常にDBから取得（overridesの値は無視）
  // container_idからx_accountsテーブルを参照して各種パラメータを取得
  if (task.containerId) {
    try {
      let containerNameForLookup: string | null = null;
      const containerIdStr = String(task.containerId);
      
      // UUID形式かどうかを判定
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
              containerNameForLookup = String(containerRow.name);
              logger.event('task.container_name.resolved', { runId: task.runId, containerId: containerIdStr, containerName: containerNameForLookup }, 'debug');
            }
            containerDb.close();
          } else {
            logger.event('task.container_db.not_found', { runId: task.runId, containerId: containerIdStr, dbPath: containerDbPath }, 'warn');
          }
        } catch (e: any) {
          logger.event('task.container_name.resolve_err', { runId: task.runId, containerId: containerIdStr, err: String(e?.message || e) }, 'warn');
        }
      } else {
        // UUID形式でない場合、そのままコンテナ名として使用
        containerNameForLookup = containerIdStr;
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
        xAccount = dbQuery<any>('SELECT x_password, email, email_password FROM x_accounts WHERE container_id = ? LIMIT 1', [containerNameForLookup])[0];
      }
      
      // コンテナ名で見つからない場合、UUIDでも検索を試みる（後方互換性）
      if (!xAccount && isUuid) {
        xAccount = dbQuery<any>('SELECT x_password, email, email_password FROM x_accounts WHERE container_id = ? LIMIT 1', [containerIdStr])[0];
        if (xAccount) {
          logger.event('task.x_account.found_by_uuid', { runId: task.runId, containerId: containerIdStr }, 'debug');
        }
      }
      
      if (xAccount) {
        // db_x_password: x_accounts.x_passwordから取得
        if (xAccount.x_password) {
          gatheredVars.db_x_password = String(xAccount.x_password);
          logger.event('task.db_x_password.loaded', { runId: task.runId, containerId: task.containerId, containerName: containerNameForLookup, hasPassword: !!gatheredVars.db_x_password }, 'debug');
        } else {
          logger.event('task.db_x_password.not_found', { runId: task.runId, containerId: task.containerId, containerName: containerNameForLookup }, 'warn');
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
        
        // db_new_email: x_accounts.emailから取得（新しいメールアドレスとして使用）
        if (xAccount.email) {
          gatheredVars.db_new_email = String(xAccount.email);
          logger.event('task.db_new_email.loaded', { runId: task.runId, containerId: task.containerId, containerName: containerNameForLookup, email: gatheredVars.db_new_email }, 'debug');
        } else {
          logger.event('task.db_new_email.not_found', { runId: task.runId, containerId: task.containerId, containerName: containerNameForLookup, xAccountExists: true }, 'warn');
        }
      } else {
        logger.event('task.x_account.not_found', { runId: task.runId, containerId: task.containerId, containerName: containerNameForLookup, isUuid }, 'warn');
      }
    } catch (e: any) {
      logger.event('task.db_params.load_err', { runId: task.runId, containerId: task.containerId, err: String(e?.message || e) }, 'warn');
    }
  } else {
    logger.event('task.db_params.no_container', { runId: task.runId }, 'warn');
  }
  
  function applyTemplate(src: string | null | undefined, vars: Record<string, any> | undefined, allowEmpty: boolean = false) {
    if (!src) return src;
    const s = String(src);
    // ネストしたプロパティに対応: {{variable.property.subproperty}} 形式をサポート
    const re = /\{\{([A-Za-z0-9_][A-Za-z0-9_.-]*)\}\}/g;
    const missing: string[] = [];
    const out = s.replace(re, (_, path) => {
      if (!vars) {
        missing.push(path);
        return 'undefined';
      }
      // プロパティパスを分割（例: "pr_post_info.account_id" -> ["pr_post_info", "account_id"]）
      const parts = path.split('.');
      let value: any = vars;
      // ネストしたプロパティにアクセス
      for (const part of parts) {
        if (value === null || value === undefined || typeof value !== 'object') {
          missing.push(path);
          return 'undefined';
        }
        value = value[part];
        if (value === undefined || value === null) {
          missing.push(path);
          return 'undefined';
        }
      }
      const valueStr = String(value);
      // 空文字列の場合は undefined を返す（JavaScriptの || 演算子が機能するように）
      // これにより、const batchSize = {{batch_size}} || 5; のようなコードが正しく動作する
      if (valueStr === '' || valueStr.trim() === '') {
        return 'undefined';
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
    if (trulyMissing.length && !allowEmpty) throw new Error(`template variables missing: ${trulyMissing.join(',')}`);
    return out;
  }
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
    // ここでは先にopenContainerを呼ばない（コンテナステップでcreateContainerが呼ばれる）
    if (containerName && !hasContainerStep) {
      // コンテナ名が指定されていて、コンテナステップがない場合のみ、ここでコンテナを開く
      // コンテナブラウザのAPIはUUIDで検索する必要があるため、名前からUUIDを取得する
      let containerIdForOpen: string = String(containerName);
      
      // コンテナ名がUUID形式でない場合、コンテナDBからUUIDを取得
      const isUuidFormat = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(containerIdForOpen);
      if (!isUuidFormat) {
        try {
          // コンテナDBからUUIDを取得
          const os = await import('node:os');
          const appData = os.platform() === 'win32' ? process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming') : path.join(os.homedir(), '.config');
          const dbPath = process.env.DEFAULT_CB_DB || path.join(appData, 'container-browser', 'data.db');
          if (fs.existsSync(dbPath)) {
            const Database = (await import('better-sqlite3')).default;
            const db = new Database(dbPath, { readonly: true });
            const row = db.prepare('SELECT id FROM containers WHERE name = ?').get(containerIdForOpen) as { id: string } | undefined;
            db.close();
            if (row && row.id) {
              containerIdForOpen = row.id; // UUIDに更新
              logger.event('task.container.name_to_uuid_for_open', { name: containerName, uuid: containerIdForOpen }, 'info');
            } else {
              logger.event('task.container.name_not_found_in_db_for_open', { name: containerName }, 'warn');
              // DBに存在しない場合、名前のまま試行（コンテナブラウザのAPIが名前を直接受け付ける可能性があるため）
            }
          }
        } catch (e: any) {
          logger.event('task.container.uuid_lookup.err_for_open', { err: String(e) }, 'warn');
          // UUID取得に失敗しても続行（コンテナ名のまま使用）
        }
      }
      
      actualContainerId = containerIdForOpen;
      logger.event('task.container.create', { runId: task.runId, containerName: containerName, containerId: containerIdForOpen }, 'info');
      
      // プロキシ設定を取得（コンテナを開く際にプロキシを上書きできるようにする）
      const proxyRaw = gatheredVars.proxy || task.overrides?.proxy;
      let proxy: { server: string; username?: string; password?: string } | undefined = undefined;
      
      if (proxyRaw && String(proxyRaw).trim() !== '') {
        const proxyStr = String(proxyRaw).trim();
        const parts = proxyStr.split(':');
        if (parts.length >= 3) {
          // IP:PORT:USERNAME:PASSWORD 形式
          proxy = {
            server: parts[0].trim() + ':' + parts[1].trim(),
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
      
      // Container Browserでコンテナを開く（UUIDで検索する必要がある）
      const openResult = await openContainer({
        id: containerIdForOpen, // UUID形式のIDを渡す
        ensureAuth: false, // トークンログインの場合は後で設定するため、ここではfalse
        timeoutMs: 60000,
        proxy: proxy
      });
      
      if (!openResult.ok) {
        throw new Error(`Failed to open/create container: ${openResult.message}`);
      }
      
      // actualContainerIdは既にUUID形式になっている
      
      openedByExport = true;
      runLog.open = { ok: true, lastSessionId: null, containerId: actualContainerId, created: true };
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
        
        // プロキシ設定を取得（コンテナを開く際にプロキシを上書きできるようにする）
        const proxyRaw = gatheredVars.proxy || task.overrides?.proxy;
        let proxy: { server: string; username?: string; password?: string } | undefined = undefined;
        
        if (proxyRaw && String(proxyRaw).trim() !== '') {
          const proxyStr = String(proxyRaw).trim();
          const parts = proxyStr.split(':');
          if (parts.length >= 3) {
            // IP:PORT:USERNAME:PASSWORD 形式
            proxy = {
              server: parts[0].trim() + ':' + parts[1].trim(),
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
        
        // Container Browserでコンテナを開く
        const openResult = await openContainer({
          id: actualContainerId,
          ensureAuth: false, // トークンログインの場合は後で設定するため、ここではfalse
          timeoutMs: 60000,
          proxy: proxy
        });
        
        if (!openResult.ok) {
          throw new Error(`Failed to open container: ${openResult.message}`);
        }
        
        openedByExport = true;
        runLog.open = { ok: true, lastSessionId: null, containerId: actualContainerId };
        runLog.containerId = actualContainerId;
      } else {
        // コンテナ作成ステップがある場合、containerIdがnullでも実行可能
        // コンテナ作成ステップでコンテナを作成するため、ここでは何もしない
        actualContainerId = null;
        openedByExport = false;
        runLog.open = { ok: true, lastSessionId: null, willCreateInStep: true };
      }
    }

    if (!runLog.open || !runLog.open.ok) throw new Error(`exportRestored failed: ${JSON.stringify(runLog.open)}`);

    // Load post library item if enabled
    if (preset.use_post_library) {
      postLibraryItem = PresetService.getUnusedPostItem();
      if (postLibraryItem) {
        logger.event('task.post_library.loaded', { runId: task.runId, postId: postLibraryItem.id }, 'info');
        // Merge post library data into gathered vars
        gatheredVars.post_content = postLibraryItem.content;
        gatheredVars.post_media = postLibraryItem.media || [];
      } else {
        logger.event('task.post_library.not_found', { runId: task.runId }, 'warn');
      }
    }

    // Load post library item by ID if specified (for X投稿 with local media)
    // X投稿データのIDで指定された場合、投稿前に使用済みに変更する
    const postLibraryIdRaw = task.overrides?.post_library_id || gatheredVars.post_library_id;
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
        hasMedia: (gatheredVars.post_media_paths as string[]).length > 0,
        markedUsedBeforePost: true
      }, 'info');
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
    
    for (let i=0;i<steps.length;i++) {
      const st = steps[i];
      
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
        
        // プロキシ設定を取得（テンプレート変数から）
        // 形式: IP:PORT:USERNAME:PASSWORD
        const proxyRaw = st.proxy || (st.params && st.params.proxy) || gatheredVars.proxy || task.overrides?.proxy;
        
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
        
        // コンテナ指定ステップの場合は、必ず新規作成を実行
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
        // デバッグモードと同様に、openContainerを呼ばずにコンテナIDを直接使用する
        // （/internal/execエンドポイントはコンテナIDを直接受け入れる）
        openedByExport = false;
        runLog.containerId = actualContainerId;
        runLog.steps.push({ 
          index: i, 
          step: st, 
          result: { ok: true, containerId: actualContainerId, message: 'Container created and ready' } 
        });
        
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
          // テンプレート変数を展開
          const itemsValue = applyTemplate(String(itemsRaw), gatheredVars);
          
          // 配列として解釈を試みる
          if (Array.isArray(itemsValue)) {
            itemsArray = itemsValue;
          } else if (typeof itemsValue === 'string' && itemsValue.trim() !== '') {
            // カンマ区切りの文字列を配列に変換
            try {
              itemsArray = itemsValue.split(',').map((item: string) => item.trim()).filter((item: string) => item);
            } catch (e) {
              itemsArray = [];
            }
          } else {
            // テンプレート変数から取得を試みる
            const varName = String(itemsRaw).replace(/\{\{|\}\}/g, '').trim();
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
                // post_library_id は必須パラメータ（overridesまたはgatheredVarsから取得）
                const postLibraryIdRaw = task.overrides?.post_library_id || gatheredVars.post_library_id;
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
                innerCmdPayload.eval = applyTemplate(rawEval, gatheredVars);
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
                          // container_group_membersテーブルに追加（既に存在する場合は更新）
                          dbRun(
                            'INSERT INTO container_group_members(container_id, group_id, created_at, updated_at) VALUES(?,?,?,?) ON CONFLICT(container_id) DO UPDATE SET group_id=excluded.group_id, updated_at=excluded.updated_at',
                            [String(containerIdForGroup), bannedGroup.id, now, now]
                          );
                          
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
                  // save_media ステップの場合、innerResp.body をそのまま保存
                  // その他のステップでは innerResp.body を保存
                  let valueToSave: any;
                  if (innerStep.type === 'eval' && innerResp.body && typeof innerResp.body === 'object' && 'result' in innerResp.body) {
                    valueToSave = innerResp.body.result;
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
                  
                  // pr_save_result が設定された場合、pr_search_resultsをDBに保存
                  if (resultVar === 'pr_save_result' || resultVar.includes('save_result')) {
                    logger.event('task.for.save_posts.condition_met', {
                      runId: task.runId,
                      presetId: task.presetId,
                      stepIndex: i,
                      loopIndex,
                      innerStepIndex: innerIdx,
                      resultVar,
                      hasPrSearchResults: !!(gatheredVars.pr_search_results),
                      prSearchResultsType: typeof gatheredVars.pr_search_results,
                      prSearchResultsKeys: gatheredVars.pr_search_results && typeof gatheredVars.pr_search_results === 'object' ? Object.keys(gatheredVars.pr_search_results) : null,
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
                        const searchResults = gatheredVars.pr_search_results;
                      
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
                          
                          logger.event('task.for.save_posts.start', {
                            runId: task.runId,
                            presetId: task.presetId,
                            stepIndex: i,
                            loopIndex,
                            postsCount: searchResults.posts.length,
                            totalSaved,
                            maxPosts
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
          
          if (task.containerId && (typeof followerCount === 'number' || typeof followingCount === 'number')) {
            // x_accountsテーブルのcontainer_idにはUUID形式のIDが保存されている
            // したがって、task.containerId（UUID）を直接使用する
            const containerIdForUpdate = String(task.containerId);
            
            const updateFields: string[] = [];
            
            if (typeof followerCount === 'number') {
              updateFields.push('follower_count = ?');
            }
            
            if (typeof followingCount === 'number') {
              updateFields.push('following_count = ?');
            }
            
            if (updateFields.length > 0) {
              // 既存のレコードが存在するか確認（UUID形式のcontainer_idで検索）
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
                // レコードが存在しない場合はINSERT
                const insertFields = ['container_id', 'created_at', 'updated_at'];
                const insertValues: any[] = [containerIdForUpdate, now, now];
                const insertPlaceholders: string[] = ['?', '?', '?'];
                
                if (typeof followerCount === 'number') {
                  insertFields.push('follower_count');
                  insertValues.push(followerCount);
                  insertPlaceholders.push('?');
                }
                if (typeof followingCount === 'number') {
                  insertFields.push('following_count');
                  insertValues.push(followingCount);
                  insertPlaceholders.push('?');
                }
                
                const insertSql = `INSERT INTO x_accounts (${insertFields.join(', ')}) VALUES (${insertPlaceholders.join(', ')})`;
                dbRun(insertSql, insertValues);
              }
              
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
                error: 'containerIdが設定されていないか、pr_follower_count/pr_following_countが数値ではありません',
                hasContainerId: !!task.containerId,
                pr_follower_count: typeof followerCount === 'number' ? followerCount : null,
                pr_following_count: typeof followingCount === 'number' ? followingCount : null,
              }
            };
            logger.event('task.save_follower_count.invalid_params', {
              runId: task.runId,
              presetId: task.presetId,
              index: i,
              hasContainerId: !!task.containerId,
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
        runLog.steps.push({ index:i, step: st, result: resp });
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
          // navigateステップの前に、post_library_id が指定されている場合、DBからURLを取得
          const postLibraryIdRaw = gatheredVars.post_library_id || (task.overrides?.post_library_id);
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
          // URL must start with http:// or https://
          if (!String(cmdPayload.url).match(/^https?:\/\//)) {
            throw new Error(`invalid URL format (must start with http:// or https://): ${cmdPayload.url}`);
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
          if (st.type === 'click' || st.type === 'type') {
            const rawSel = (task.overrides && task.overrides.selector) ? task.overrides.selector : st.selector;
            cmdPayload.selector = applyTemplate(rawSel, gatheredVars);
          }
          if (st.type === 'eval') {
            // ステップ5（stepIndex 4）の前処理：メールアドレス自動取得
            // タスク実行（フルプリセット実行）でも、デバッグモードと同じメールアドレス自動取得を実行
            if (task.presetId === 22 && i === 4) {
              const needsEmail = !gatheredVars?.db_new_email || 
                                 String(gatheredVars.db_new_email).trim() === '';
              
              if (needsEmail) {
                try {
                  // x_accountsのemailも確認（既に設定されている場合はスキップ）
                  const xAccountCheck = dbQuery<{ email: string | null }>(
                    'SELECT email FROM x_accounts WHERE container_id = ?',
                    [actualContainerId || task.containerId]
                  );
                  
                  if (!xAccountCheck?.[0]?.email) {
                    logger.event('task.auto_acquire_email.start', {
                      runId: task.runId,
                      presetId: task.presetId,
                      stepIndex: i,
                      containerId: actualContainerId || task.containerId
                    }, 'info');
                    
                    // メールアドレスを取得して登録（排他制御付き、リトライ処理付き）
                    let emailData: { email: string; password: string } | null = null;
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
                          
                          // 4. x_accountsに登録
                          const containerIdForUpdate = actualContainerId || task.containerId;
                          dbRun(
                            'UPDATE x_accounts SET email = ?, email_password = ?, updated_at = ? WHERE container_id = ?',
                            [email, password, now, containerIdForUpdate]
                          );
                          
                          logger.event('task.auto_acquire_email.success', {
                            runId: task.runId,
                            presetId: task.presetId,
                            stepIndex: i,
                            containerId: containerIdForUpdate,
                            emailAccountId: emailAccount.id,
                            email: email.substring(0, 20) + '...',
                            retry
                          }, 'info');
                          
                          return { email, password };
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
                      // gatheredVarsに反映
                      gatheredVars.db_new_email = emailData.email;
                      gatheredVars.db_email_credential = `${emailData.email}:${emailData.password}`;
                      
                      logger.event('task.auto_acquire_email.gathered_vars_set', {
                        runId: task.runId,
                        presetId: task.presetId,
                        stepIndex: i,
                        hasDbNewEmail: !!gatheredVars.db_new_email,
                        hasDbEmailCredential: !!gatheredVars.db_email_credential
                      }, 'debug');
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
                  } else {
                    // x_accountsに既にemailが設定されている場合は、それをdb_new_emailに設定
                    gatheredVars.db_new_email = xAccountCheck[0].email;
                    logger.event('task.auto_acquire_email.skipped_already_set', {
                      runId: task.runId,
                      presetId: task.presetId,
                      stepIndex: i,
                      containerId: actualContainerId || task.containerId,
                      email: xAccountCheck[0].email?.substring(0, 20) + '...'
                    }, 'debug');
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
            cmdPayload.eval = applyTemplate(rawEval, gatheredVars, hasSkipLogic);
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
        } catch (te:any) {
          runLog.steps.push({ index:i, step: st, result: null, error: String(te?.message||te) });
          runLog.error = `template substitution failed: ${String(te?.message||te)}`;
          throw new Error(runLog.error);
        }
      }
      // save_follower_countの場合は既にrespが設定されているので、callExecをスキップ
      if (st.type !== 'save_follower_count') {
        if (st.type === 'type') cmdPayload.text = st.text || '';
        const options = Object.assign({}, (st.options && typeof st.options === 'object') ? st.options : {});
        options.timeoutMs = resolveStepTimeoutMs(st, defaultTimeoutSeconds);
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
                    const subjectPattern = st.subject_pattern || st.subjectPattern || 'verification|確認コード|code';
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
        runLog.steps.push({ index:i, step: st, result: resp });
        // special wait handled above
      } else {
        resp = await callExec(cmdPayload);
        runLog.steps.push({ index:i, step: st, result: resp });
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
                  // container_group_membersテーブルに追加（既に存在する場合は更新）
                  dbRun(
                    'INSERT INTO container_group_members(container_id, group_id, created_at, updated_at) VALUES(?,?,?,?) ON CONFLICT(container_id) DO UPDATE SET group_id=excluded.group_id, updated_at=excluded.updated_at',
                    [String(containerIdForGroup), bannedGroup.id, now, now]
                  );
                  
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
        stopped = true;
        const stopReason = normalizeExecResult(resp)?.reason || resp.body?.reason || 'stopped';
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
          const body = resp.body as any;
          valueToSave = (body.result && typeof body.result === 'object') ? body.result : body;
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
      }
      
      // Special-case: for navigate, verify returned URL matches expected pattern.
      // Behavior: if HTTP 200 but returned URL does NOT match expected -> treat as stopped.
      if (st.type === 'navigate') {
        const retUrl = (normalizeExecResult(resp) && typeof normalizeExecResult(resp).url === 'string')
          ? normalizeExecResult(resp).url
          : ((resp && resp.body && typeof resp.body.url === 'string') ? resp.body.url : '');
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
    }
  } // end of for loop (step execution)
} catch (e:any) {
  runLog.error = String(e?.message || e);
    logger.event('task.run.err', { runId: task.runId, err: runLog.error }, 'error');
  } finally {
    // do not close here when export opened the container;
    // closing will be handled by the worker after any configured waitMinutes
    try {
      runLog.openedByExport = !!openedByExport;
    } catch (ee:any) {
      runLog.openedByExport = !!openedByExport;
    }
    runLog.end = new Date().toISOString();
    finalStatus = stopped ? 'stopped' : (runLog.error ? 'failed' : 'ok');
    const status = stopped ? 'stopped' : (runLog.error ? 'failed' : 'done');
    const stepCount = Array.isArray(runLog.steps) ? runLog.steps.length : 0;
    logger.event('task.run.finished', { runId: task.runId, presetId: task.presetId, status: finalStatus, error: runLog.error || null, steps: stepCount }, runLog.error ? 'warn' : 'info');
    
    // Mark post library item as used if execution succeeded
    // 注意: post_library_idで指定された場合は投稿前に既に使用済みに変更済み
    if (postLibraryItem && finalStatus === 'ok') {
      // post_library_idで指定された場合は既に使用済みに変更済みなので、use_post_libraryフラグの場合のみ更新
      const postLibraryIdRaw = task.overrides?.post_library_id || gatheredVars.post_library_id;
      const presetForCheck = PresetService.getPreset(task.presetId) as any;
      if (!postLibraryIdRaw && presetForCheck?.use_post_library) {
        // use_post_libraryフラグの場合のみ、成功時に使用済みに更新
        try {
          PresetService.markPostItemUsed(postLibraryItem.id);
          logger.event('task.post_library.marked_used', { runId: task.runId, postId: postLibraryItem.id }, 'info');
        } catch (e:any) {
          logger.warn({ msg: 'task.post_library.mark_used.err', runId: task.runId, err: String(e?.message||e) });
        }
      } else if (postLibraryIdRaw) {
        // post_library_idで指定された場合は既に投稿前に使用済みに変更済み
        logger.event('task.post_library.already_marked_used', { runId: task.runId, postId: postLibraryItem.id }, 'debug');
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
    } catch (e:any) {
      logger.event('task.run.persist.err', { err: String(e?.message||e), runId: task.runId }, 'warn');
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
  
  // On startup, reset any stale 'running' tasks to 'pending' (in case of process restart)
  // Also mark 'failed' and 'stopped' tasks as 'done' so they don't appear in the active task list
  try {
    const staleRows: any[] = dbQuery('SELECT id, runId FROM tasks WHERE status = ? AND queue_name = ?', ['running', queueName]);
    if (staleRows && staleRows.length > 0) {
      for (const row of staleRows) {
        dbRun('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?', ['pending', Date.now(), row.id]);
        logger.event('task.worker.reset_stale', { runId: row.runId, queueName }, 'info');
      }
    }
    // Clean up failed/stopped tasks on startup
    // BUT: Only clean up if execution is enabled - if stopped, keep them in stopped state
    if (queueState.executionEnabled) {
      const finishedRows: any[] = dbQuery('SELECT id, runId FROM tasks WHERE status IN (?, ?) AND queue_name = ?', ['failed', 'stopped', queueName]);
      if (finishedRows && finishedRows.length > 0) {
        for (const row of finishedRows) {
          dbRun('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?', ['done', Date.now(), row.id]);
          logger.event('task.worker.cleanup_finished', { runId: row.runId, queueName }, 'info');
        }
      }
    }
  } catch (e:any) {
    logger.event('task.worker.reset_stale.err', { err: String(e?.message||e), queueName }, 'warn');
  }
  
  let waitingBlockLogged = false;
  while (true) {
    // Refresh executionEnabled state from memory storage in case it was updated by another process
    try {
      const storedExecutionEnabled = memGet(`executionEnabled_${queueName}`);
      if (typeof storedExecutionEnabled === 'boolean') {
        queueState.executionEnabled = storedExecutionEnabled;
      }
    } catch (e:any) {
      logger.event('task.worker.refresh_execution_state.err', { err: String(e?.message||e), queueName }, 'warn');
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
        
        // 3回連続失敗時にpendingタスクをwaiting_stoppedに変更してDiscord通知を送信
        if (currentFailureCount >= 3) {
          try {
            // pendingタスクをwaiting_stoppedに変更
            const pendingRows: any[] = dbQuery('SELECT id, runId FROM tasks WHERE status = ? AND queue_name = ?', ['pending', queueName]);
            if (pendingRows && pendingRows.length > 0) {
              let stoppedCount = 0;
              for (const row of pendingRows) {
                dbRun('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?', ['waiting_stopped', Date.now(), row.id]);
                stoppedCount++;
                logger.event('task.worker.stop_due_to_cb_conn', { runId: row.runId, queueName }, 'warn');
              }
              
              // Discord通知を送信
              const settings = loadSettings();
              if (settings.discordWebhookUrl && stoppedCount > 0) {
                await sendDiscordNotificationForContainerBrowser(settings.discordWebhookUrl, queueName, stoppedCount, CB_HOST, CB_PORT);
              }
              
              // 接続失敗回数をリセット（通知後は再カウントしない）
              consecutiveContainerBrowserConnectionFailures.set(queueName, 0);
            }
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
    } catch (e:any) {
      const currentFailureCount = (consecutiveContainerBrowserConnectionFailures.get(queueName) || 0) + 1;
      consecutiveContainerBrowserConnectionFailures.set(queueName, currentFailureCount);
      logger.event('task.worker.conncheck.err', { err: String(e?.message||e), failureCount: currentFailureCount, queueName }, 'warn');
      
      // 3回連続失敗時にpendingタスクをwaiting_stoppedに変更してDiscord通知を送信
      if (currentFailureCount >= 3) {
        try {
          // pendingタスクをwaiting_stoppedに変更
          const pendingRows: any[] = dbQuery('SELECT id, runId FROM tasks WHERE status = ? AND queue_name = ?', ['pending', queueName]);
          if (pendingRows && pendingRows.length > 0) {
            let stoppedCount = 0;
            for (const row of pendingRows) {
              dbRun('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?', ['waiting_stopped', Date.now(), row.id]);
              stoppedCount++;
              logger.event('task.worker.stop_due_to_cb_conn', { runId: row.runId, queueName }, 'warn');
            }
            
            // Discord通知を送信
            const settings = loadSettings();
            if (settings.discordWebhookUrl && stoppedCount > 0) {
              await sendDiscordNotificationForContainerBrowser(settings.discordWebhookUrl, queueName, stoppedCount, CB_HOST, CB_PORT);
            }
            
            // 接続失敗回数をリセット（通知後は再カウントしない）
            consecutiveContainerBrowserConnectionFailures.set(queueName, 0);
          }
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
    } catch (e:any) {
      logger.event('task.worker.check_running.err', { err: String(e?.message||e), queueName }, 'warn');
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
        // 過去の予定時刻（scheduled_at < now）を最優先、次に即時実行（scheduled_at IS NULL）、最後に未来の予定時刻（scheduled_at = now）
        // ORDER BY: 1) 過去の予定時刻優先（scheduled_at < now）、2) 即時実行（scheduled_at IS NULL）、3) 同じ優先度内ではscheduled_at/created_atの昇順
        const rows: any[] = dbQuery(
          'SELECT id, runId, preset_id as presetId, container_id as containerId, overrides_json as overridesJson, scheduled_at as scheduledAt, group_id as groupId, wait_minutes as waitMinutes FROM tasks WHERE status = ? AND queue_name = ? AND (scheduled_at IS NULL OR scheduled_at <= ?) ORDER BY CASE WHEN scheduled_at IS NULL THEN 1 WHEN scheduled_at < ? THEN 0 ELSE 1 END, scheduled_at ASC, created_at ASC LIMIT 1',
          ['pending', queueName, now, now]
        );
        if (rows && rows.length) {
          const row = rows[0];
          // タスクごとの waitMinutes は無視（後方互換のため型定義上は設定するが、実際の待機時間には使用しない）
          // 実際の待機時間は全タスク共通の設定（getGlobalWaitMinutes）を使用
          const parsedWaitMinutes = (() => {
            if (typeof row.waitMinutes === 'number' && Number.isFinite(row.waitMinutes)) return row.waitMinutes;
            const asNum = Number(row.waitMinutes);
            return Number.isFinite(asNum) ? asNum : 0;
          })();
          t = { id: row.id, runId: row.runId, presetId: row.presetId, containerId: row.containerId, overrides: (()=>{ try{ return JSON.parse(row.overridesJson||'{}'); }catch{return {};}})(), scheduledAt: row.scheduledAt, groupId: row.groupId, waitMinutes: parsedWaitMinutes, queueName };
          // CRITICAL FIX: Do NOT mark as running here - mark it just before runTask() is called
          // This prevents tasks from being stuck in 'running' state if runTask() is never called
        }
      } catch (e:any) {
        logger.event('task.worker.db.err', { err: String(e?.message||e) }, 'error');
        // If task was marked as running but failed to create task object, reset it
        if (t && t.runId) {
          try {
            dbRun('UPDATE tasks SET status = ?, updated_at = ? WHERE runId = ?', ['pending', Date.now(), t.runId]);
            logger.event('task.worker.db.reset_failed', { runId: t.runId }, 'warn');
          } catch (resetErr:any) {
            logger.event('task.worker.db.reset.err', { runId: t.runId, err: String(resetErr?.message||resetErr) }, 'error');
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
      } catch (e:any) {
        logger.event('task.worker.check_scheduled.err', { err: String(e?.message||e), queueName }, 'warn');
      }
      // No scheduled tasks, break the loop
      break;
    }
    // CRITICAL FIX: Mark as running ONLY just before runTask() is called
    // This ensures the task is actually about to be executed
    let taskMarkedAsRunning = false;
    try {
      if (t.runId) {
        try {
          // Double-check: ensure task is still pending (not already running by another worker)
          const checkRows: any[] = dbQuery('SELECT id, status FROM tasks WHERE runId = ? LIMIT 1', [t.runId]);
          if (checkRows && checkRows.length) {
            const currentStatus = checkRows[0].status;
            if (currentStatus === 'pending') {
              // Update to running only if still pending
              dbRun('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?', ['running', Date.now(), checkRows[0].id]);
              taskMarkedAsRunning = true;
              logger.event('task.worker.mark_running', { runId: t.runId }, 'info');
            } else if (currentStatus === 'running') {
              // Already running - might be a race condition, log and skip
              logger.event('task.worker.already_running', { runId: t.runId }, 'warn');
              // Reset task to pending so it can be retried
              dbRun('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?', ['pending', Date.now(), checkRows[0].id]);
              await new Promise(r => setTimeout(r, 100));
              continue; // Skip this task and try next one
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
        } catch (checkErr:any) {
          logger.event('task.worker.status_check.err', { runId: t.runId, err: String(checkErr?.message||checkErr) }, 'error');
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
      const statusMap: Record<RunTaskFinalStatus, WaitingStatus> = {
        ok: 'waiting_success',
        failed: 'waiting_failed',
        stopped: 'waiting_stopped',
      };
      let waitingStatus: WaitingStatus | null = null;
      if (waitMinutes > 0 && statusMap[finalStatus]) {
        waitingStatus = statusMap[finalStatus];
        dbRun('UPDATE tasks SET status = ?, updated_at = ? WHERE runId = ?', [waitingStatus, Date.now(), t.runId]);
        try {
          // reflect waiting status also in task_runs so UI doesn't treat the run as finished immediately
          dbRun('UPDATE task_runs SET status = ? WHERE runId = ?', [waitingStatus, t.runId]);
        } catch (e:any) {
          logger.event('task.worker.update_run_waiting.err', { runId: t.runId, err: String(e?.message||e) }, 'warn');
        }
      }
      // Close container after task execution (regardless of waitMinutes)
      // コンテナIDは t.containerId または runLog.containerId から取得
      logger.event('task.worker.close_container.start', { runId: t.runId, taskContainerId: t.containerId || null }, 'info');
      let containerIdToClose: string | null = t.containerId || null;
      if (!containerIdToClose) {
        try {
          const logPath = path.join(ensureLogsDir(), `${t.runId}.json`);
          if (fs.existsSync(logPath)) {
            const raw = fs.readFileSync(logPath, 'utf8');
            const runLog = JSON.parse(raw || '{}');
            containerIdToClose = runLog.containerId || null;
            logger.event('task.worker.close_container.read_log', { runId: t.runId, containerId: containerIdToClose, logPath }, 'info');
          } else {
            logger.event('task.worker.close_container.log_not_found', { runId: t.runId, logPath }, 'warn');
          }
        } catch (e:any) {
          logger.event('task.worker.close_container.read_log.err', { runId: t.runId, err: String(e?.message||e) }, 'warn');
        }
      }
      
      if (containerIdToClose) {
        logger.event('task.worker.close_container.attempt', { runId: t.runId, containerId: containerIdToClose }, 'info');
        try {
          const logPath = path.join(ensureLogsDir(), `${t.runId}.json`);
          if (fs.existsSync(logPath)) {
            const raw = fs.readFileSync(logPath, 'utf8');
            const runLog = JSON.parse(raw || '{}');
            
            // openedByExportがtrueの場合、コンテナはエクスポート機能側で管理されているため、閉じる処理をスキップ
            if (runLog.openedByExport === true) {
              logger.event('task.worker.close_container.skipped_by_export', { runId: t.runId, containerId: containerIdToClose }, 'info');
              runLog.closed = { ok: true, closed: true, message: 'skipped (container managed by export function)' };
              runLog.closeAt = new Date().toISOString();
              fs.writeFileSync(logPath, JSON.stringify(runLog, null, 2), 'utf8');
            } else {
              try {
                const closed = await closeContainer(containerIdToClose) as unknown as { ok: boolean; closed: boolean };
                logger.event('task.worker.close_container.result', { 
                  runId: t.runId, 
                  containerId: containerIdToClose, 
                  closed: closed.ok, 
                  closedStatus: closed.closed,
                  closedBody: JSON.stringify(closed).substring(0, 200)
                }, closed.ok ? 'info' : 'warn');
                runLog.closed = closed;
                runLog.closeAt = new Date().toISOString();
                fs.writeFileSync(logPath, JSON.stringify(runLog, null, 2), 'utf8');
                // update task_runs.result_json to include closed info
                try {
                  const row = dbQuery<any>('SELECT id, result_json FROM task_runs WHERE runId = ? LIMIT 1', [t.runId])[0];
                  if (row && row.result_json) {
                    const existing = (()=>{ try { return JSON.parse(row.result_json); } catch { return null; } })() || {};
                    existing.closed = closed;
                    dbRun('UPDATE task_runs SET result_json = ? WHERE runId = ?', [JSON.stringify(existing), t.runId]);
                  }
                } catch (e:any) { logger.event('task.worker.update_run_close.err', { runId: t.runId, err: String(e?.message||e) }, 'warn'); }
              } catch (e:any) {
                logger.event('task.worker.close_container.err', { runId: t.runId, containerId: containerIdToClose, err: String(e?.message||e), stack: e?.stack?.substring(0, 200) }, 'error');
              }
            }
          } else {
            logger.event('task.worker.close_container.log_not_found_on_close', { runId: t.runId, logPath }, 'warn');
          }
        } catch (e:any) { 
          logger.event('task.worker.close_container.scan.err', { runId: t.runId, err: String(e?.message||e) }, 'error'); 
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
        } catch (e:any) {
          logger.event('task.worker.update_run_postwait.err', { runId: t.runId, err: String(e?.message||e) }, 'warn');
        }
      } else {
        // If no waitMinutes, mark task as 'done' immediately
        const postStatus = finalStatus === 'ok' ? 'done' : finalStatus;
        dbRun('UPDATE tasks SET status = ?, updated_at = ? WHERE runId = ?', [postStatus, Date.now(), t.runId]);
        logger.event('task.worker.mark_done', { runId: t.runId, finalStatus, postStatus }, 'info');
      }
    } catch (e:any) {
      logger.event('task.worker.taskerr', { runId: t.runId, err: String(e?.message||e) }, 'error');
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
            logger.event('task.worker.reset_on_err', { runId: t.runId, reason: 'runTask never called', error: String(e?.message||e) }, 'warn');
          } catch (resetErr:any) {
            logger.event('task.worker.reset_on_err.db.err', { runId: t.runId, err: String(resetErr?.message||resetErr) }, 'error');
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
            } catch (updateRunErr:any) {
              logger.event('task.worker.update_run_on_err.err', { runId: t.runId, err: String(updateRunErr?.message||updateRunErr) }, 'warn');
            }
            logger.event('task.worker.mark_failed_on_err', { runId: t.runId, reason: 'runTask called but failed', error: String(e?.message||e) }, 'warn');
          } catch (updateErr:any) {
            logger.event('task.worker.update_on_err.err', { runId: t.runId, err: String(updateErr?.message||updateErr) }, 'error');
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
          } catch (e:any) {
            logger.event('task.worker.close_on_err.read_log.err', { runId: t.runId, err: String(e?.message||e) }, 'warn');
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
            } catch (e:any) {
              // ログ読み込みエラーは無視して続行
            }
            
            // openedByExportがtrueの場合、コンテナはエクスポート機能側で管理されているため、閉じる処理をスキップ
            if (openedByExport) {
              logger.event('task.worker.close_on_err.skipped_by_export', { runId: t.runId, containerId: containerIdToClose }, 'info');
            } else {
              logger.event('task.worker.close_on_err.attempt', { runId: t.runId, containerId: containerIdToClose }, 'info');
              try {
                const closed = await closeContainer(containerIdToClose) as unknown as { ok: boolean; closed: boolean };
                logger.event('task.worker.close_on_err.result', { 
                  runId: t.runId, 
                  containerId: containerIdToClose, 
                  closed: closed.ok, 
                  closedStatus: closed.closed
                }, closed.ok ? 'info' : 'warn');
              } catch (closeErr:any) {
                logger.event('task.worker.close_on_err.err', { 
                  runId: t.runId, 
                  containerId: containerIdToClose, 
                  err: String(closeErr?.message||closeErr),
                  stack: closeErr?.stack?.substring(0, 200)
                }, 'error');
                throw closeErr;
              }
            }
          } catch (closeErr:any) {
            logger.event('task.worker.close_on_err.outer.err', { 
              runId: t.runId, 
              containerId: containerIdToClose, 
              err: String(closeErr?.message||closeErr) 
            }, 'error');
          }
        } else {
          logger.event('task.worker.close_on_err.no_id', { runId: t.runId, taskContainerId: t.containerId || null }, 'warn');
        }
      } catch (closeErr:any) {
        logger.event('task.worker.close_on_err.outer.err', { runId: t.runId, err: String(closeErr?.message||closeErr) }, 'error');
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
    const rows: any[] = dbQuery('SELECT runId, status FROM tasks WHERE status IN (?,?,?) AND queue_name = ?', ['waiting_success', 'waiting_failed', 'waiting_stopped', queueName]);
    for (const r of rows || []) {
      try {
        const runId = String(r.runId);
        const taskStatus = String(r.status || '');
        const lastRun = dbQuery<any>('SELECT ended_at, status FROM task_runs WHERE runId = ? ORDER BY started_at DESC LIMIT 1', [runId])[0];
        if (!lastRun) continue;
        const endedAt = Number(lastRun.ended_at) || 0;
        const deadline = endedAt + Math.round(globalWaitMinutes * 60000);
        if (deadline <= now) {
          // map waiting_* to final/post statuses
          const finalStatus = taskStatus === 'waiting_success' ? 'ok' : (taskStatus === 'waiting_failed' ? 'failed' : (taskStatus === 'waiting_stopped' ? 'stopped' : null));
          if (!finalStatus) continue;
          const postStatus = finalStatus === 'ok' ? 'done' : finalStatus;
          try {
            dbRun('UPDATE tasks SET status = ?, updated_at = ? WHERE runId = ?', [postStatus, Date.now(), runId]);
            dbRun('UPDATE task_runs SET status = ? WHERE runId = ?', [finalStatus, runId]);
            logger.event('task.sweep.updated', { runId, from: taskStatus, toTaskStatus: postStatus, toRunStatus: finalStatus }, 'info');
          } catch (e:any) {
            logger.event('task.sweep.update.err', { runId, err: String(e?.message||e) }, 'warn');
          }
        }
      } catch (e:any) {
        logger.event('task.sweep.row.err', { err: String(e?.message || e) }, 'warn');
      }
    }
  } catch (e:any) {
    logger.event('task.sweep.err', { err: String(e?.message || e) }, 'warn');
  }
}

// start on import: async wrapper for potential future use
async function sweepWaitingTasks(queueName: string = DEFAULT_QUEUE_NAME) {
  sweepWaitingTasksSync(queueName);
}

// start on import: first sweep waiting tasks (in case process restarted), then start worker for each queue
for (const queueName of ALL_QUEUE_NAMES) {
  sweepWaitingTasks(queueName).catch(()=>{});
  startWorker(queueName).catch(()=>{});
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
  } catch (e:any) {
    logger.event('task.waiting.cancelled.err', { runId, err: String(e?.message||e), queueName }, 'warn');
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


