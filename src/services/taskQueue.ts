import fs from 'node:fs';
import path from 'node:path';
import { exportRestored } from './exportedProfiles.js';
import * as PresetService from './presets.js';
import { logger } from '../utils/logger.js';
import { run as dbRun, query as dbQuery, memGet, memSet } from '../drivers/db.js';
import { loadSettings } from './appSettings.js';
const cfg = loadSettings();
const CB_HOST = process.env.CONTAINER_EXPORT_HOST || cfg.containerBrowserHost || '127.0.0.1';
const CB_PORT = Number(process.env.CONTAINER_EXPORT_PORT || cfg.containerBrowserPort || 3001);

function normalizeTimeoutSeconds(raw: unknown, fallback = 10) {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 1) return raw;
  if (typeof raw === 'string') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 1) return parsed;
  }
  return fallback;
}

function parsePresetStepsJson(stepsJson: string) {
  let parsed: any = [];
  try {
    parsed = JSON.parse(stepsJson || '[]');
  } catch {
    parsed = [];
  }
  let steps: any[] = [];
  let defaultTimeoutSeconds = 10;
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
  runId: string;
  presetId: number;
  containerId?: string;
  overrides?: any;
  scheduledAt?: number;
  groupId?: string;
  waitMinutes?: number;
};

type WaitingStatus = 'waiting_success' | 'waiting_failed' | 'waiting_stopped';

const queue: Task[] = [];
let running = false;
let executionEnabled = true;
const storedExecutionEnabled = memGet('executionEnabled');
if (typeof storedExecutionEnabled === 'boolean') executionEnabled = storedExecutionEnabled;
let pendingScheduleTimer: NodeJS.Timeout | null = null;

function clearPendingTimer() {
  if (pendingScheduleTimer) {
    clearTimeout(pendingScheduleTimer);
    pendingScheduleTimer = null;
  }
}
function schedulePendingCheckFor(timeMs?: number) {
  if (!timeMs || !Number.isFinite(timeMs)) return;
  const delay = Math.max(timeMs - Date.now(), 0);
  if (delay <= 0) {
    startWorker().catch((e)=>logger.event('task.worker.err',{err:String(e)},'error'));
    return;
  }
  clearPendingTimer();
  pendingScheduleTimer = setTimeout(() => {
    pendingScheduleTimer = null;
    startWorker().catch((e)=>logger.event('task.worker.err',{err:String(e)},'error'));
  }, delay);
}

function scheduleNearestPendingTask() {
  try {
    const now = Date.now();
    const nextRow: any = dbQuery('SELECT MIN(scheduled_at) AS next FROM tasks WHERE status = ? AND scheduled_at > ?', ['pending', now]);
    if (nextRow && nextRow.next && Number.isFinite(nextRow.next)) {
      schedulePendingCheckFor(nextRow.next);
    }
  } catch (e:any) {
    logger.event('task.schedule-next.err', { err: String(e?.message||e) }, 'warn');
  }
}

function nowTs() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function ensureLogsDir() {
  const d = path.resolve('logs');
  try { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); } catch {}
  return d;
}

export function enqueueTask(task: Omit<Task, 'runId'>) {
  const runId = `run-${task.presetId}-${nowTs()}`;
  const normalizedWaitMinutes = Number.isFinite(task.waitMinutes ?? NaN) ? task.waitMinutes : 10;
  const t: Task = Object.assign({ runId, waitMinutes: normalizedWaitMinutes }, task);
  const now = Date.now();
  const shouldQueue = !t.scheduledAt || t.scheduledAt <= now;
  if (shouldQueue) {
    queue.push(t);
  } else {
    schedulePendingCheckFor(t.scheduledAt);
  }
  // Reduced noisy logging: only record enqueue at debug level. Keep DB/error logs as warnings/errors.
  logger.event('task.enqueue', { runId, presetId: task.presetId }, 'debug');
  // persist task to DB
  try {
    dbRun(
      'INSERT INTO tasks(runId, preset_id, container_id, overrides_json, scheduled_at, status, created_at, updated_at, group_id, wait_minutes) VALUES(?,?,?,?,?,?,?,?,?,?)',
      [runId, task.presetId, task.containerId || null, JSON.stringify(task.overrides || {}), task.scheduledAt || null, 'pending', Date.now(), Date.now(), task.groupId || null, normalizedWaitMinutes]
    );
  } catch (e:any) {
    logger.event('task.enqueue.db.err', { err: String(e?.message||e), runId }, 'warn');
  }
  // start worker if not running
  if (!running) {
    startWorker().catch((e)=>logger.event('task.worker.err',{err:String(e)},'error'));
  }
  return runId;
}

export function setExecutionEnabled(enabled: boolean) {
  executionEnabled = !!enabled;
  logger.event('task.execution.toggle', { enabled: executionEnabled }, executionEnabled ? 'info' : 'warn');
  try { memSet('executionEnabled', executionEnabled); } catch (e) { logger.event('kv.set.err', { err: String(e) }, 'warn'); }
  return executionEnabled;
}

export function isExecutionEnabled() {
  return executionEnabled;
}

async function callExec(body: any) {
  const url = `http://${CB_HOST}:${CB_PORT}/internal/exec`;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const txt = await res.text();
  try { return { status: res.status, ok: res.ok, body: JSON.parse(txt) }; } catch { return { status: res.status, ok: res.ok, body: txt }; }
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
  if (body.didAction === false) {
    const reason = String(body.reason || '').toLowerCase();
    return reason.includes('like-not-confirmed') || reason.includes('like-uncertain') || reason.includes('stop');
  }
  return false;
}

type RunTaskFinalStatus = 'ok' | 'failed' | 'stopped';

async function closeContainer(containerId: string, timeoutMs = 30000) {
  try {
    const url = `http://${CB_HOST}:${CB_PORT}/internal/export-restored/close`;
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: containerId, timeoutMs }) });
    const j = await res.json().catch(()=>({ ok:false }));
    return { status: res.status, ok: res.ok, body: j };
  } catch (e:any) { return { ok:false, error: String(e?.message||e) }; }
}

async function runTask(task: Task): Promise<RunTaskFinalStatus> {
  const logsDir = ensureLogsDir();
  const logPath = path.join(logsDir, `${task.runId}.json`);
  const runLog: any = { runId: task.runId, presetId: task.presetId, containerId: task.containerId || null, start: new Date().toISOString(), steps: [] };
  logger.event('task.run.start', { runId: task.runId, presetId: task.presetId, containerId: task.containerId || null }, 'info');
  let finalStatus: RunTaskFinalStatus = 'failed';
  let stopped = false;
  let openedByExport = false;
  function applyTemplate(src: string | null | undefined, vars: Record<string, any> | undefined) {
    if (!src) return src;
    const s = String(src);
    const re = /\{\{([A-Za-z0-9_-]+)\}\}/g;
    const missing: string[] = [];
    const out = s.replace(re, (_, name) => {
      if (!vars || typeof vars[name] === 'undefined' || vars[name] === null) {
        missing.push(name);
        return '';
      }
      return String(vars[name]);
    });
    if (missing.length) throw new Error(`template variables missing: ${missing.join(',')}`);
    return out;
  }
  try {
    const preset = PresetService.getPreset(task.presetId);
    if (!preset) throw new Error('preset not found');
    // open container if provided
    if (!task.containerId) throw new Error('containerId required');
    // SKIP exportRestored: directly proceed to use existing container context (debug-like behavior)
    openedByExport = false;
    runLog.open = { ok: true, lastSessionId: null, skippedExport: true };

    if (!runLog.open || !runLog.open.ok) throw new Error(`exportRestored failed: ${JSON.stringify(runLog.open)}`);

    // execute preset steps sequentially
    const { steps, defaultTimeoutSeconds } = parsePresetStepsJson(preset.steps_json || '[]');
    for (let i=0;i<steps.length;i++) {
      const st = steps[i];
      const cmdPayload: any = { contextId: task.containerId, command: st.type };
      try {
        if (st.type === 'navigate') {
          const raw = (task.overrides && task.overrides.url) ? task.overrides.url : st.url;
          cmdPayload.url = applyTemplate(raw, task.overrides && task.overrides.vars ? task.overrides.vars : undefined);
        }
        if (st.type === 'click' || st.type === 'type') {
          const rawSel = (task.overrides && task.overrides.selector) ? task.overrides.selector : st.selector;
          cmdPayload.selector = applyTemplate(rawSel, task.overrides && task.overrides.vars ? task.overrides.vars : undefined);
        }
        if (st.type === 'eval') {
          const rawEval = (task.overrides && typeof task.overrides === 'object' && task.overrides.eval) ? task.overrides.eval : (st.code || st.eval || (st.params && (st.params.eval || st.params.code)));
          if (!rawEval) throw new Error('eval missing');
          cmdPayload.eval = applyTemplate(rawEval, task.overrides && task.overrides.vars ? task.overrides.vars : undefined);
        }
      } catch (te:any) {
        runLog.steps.push({ index:i, step: st, result: null, error: String(te?.message||te) });
        runLog.error = `template substitution failed: ${String(te?.message||te)}`;
        throw new Error(runLog.error);
      }
      if (st.type === 'type') cmdPayload.text = st.text || '';
      const options = Object.assign({}, (st.options && typeof st.options === 'object') ? st.options : {});
      options.timeoutMs = resolveStepTimeoutMs(st, defaultTimeoutSeconds);
      cmdPayload.options = options;
      // special-case: handle 'wait' locally since export-server may not support 'wait' command
      let resp;
      if (st.type === 'wait') {
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
            let lastResp = null;
            while (Date.now() - start < timeout) {
              try {
                lastResp = await callExec({ contextId: task.containerId, command: 'eval', eval: `!!document.querySelector(${JSON.stringify(selector)})` });
              } catch (e) { lastResp = null; }
            if (lastResp && lastResp.body === true) { found = true; break; }
            await new Promise(r => setTimeout(r, 500));
          }
          resp = { status: 200, ok: true, body: { found, lastResp } };
          if (!found) resp.ok = false;
        }
        }
        runLog.steps.push({ index:i, step: st, result: resp });
      } else {
        resp = await callExec(cmdPayload);
        runLog.steps.push({ index:i, step: st, result: resp });
      }
      const normalized = normalizeExecResult(resp);
      let reason: string | null = null;
      if (normalized && typeof normalized.reason === 'string') {
        reason = normalized.reason;
      } else if (resp && resp.body && typeof resp.body === 'object') {
        if (typeof resp.body.reason === 'string') reason = resp.body.reason;
        else if (typeof resp.body.error === 'string') reason = resp.body.error;
      }
      const stepEventLevel: 'info' | 'warn' = resp && resp.ok ? 'info' : 'warn';
      logger.event('task.step', {
        runId: task.runId,
        presetId: task.presetId,
        index: i,
        type: st.type,
        description: st.description || null,
        ok: Boolean(resp && resp.ok),
        statusCode: resp ? resp.status : null,
        reason,
        waitStep: st.type === 'wait',
      }, stepEventLevel);
      if (!resp.ok) {
        if (isStopResponse(resp)) {
          stopped = true;
          const reason = normalizeExecResult(resp)?.reason || resp.body?.reason || 'stopped';
          runLog.error = `step stopped: ${reason}`;
          break;
        }
        runLog.error = `step failed: ${i}`;
        break;
      }
    }
  } catch (e:any) {
    runLog.error = String(e?.message || e);
    logger.event('task.run.err', { runId: task.runId, err: runLog.error }, 'error');
  } finally {
    // always attempt close
    try {
      if (openedByExport && task.containerId) {
        const closed = await closeContainer(task.containerId);
        runLog.closed = closed;
      }
    } catch (ee:any) {
      runLog.closeError = String(ee?.message||ee);
    }
    runLog.end = new Date().toISOString();
    finalStatus = stopped ? 'stopped' : (runLog.error ? 'failed' : 'ok');
    const status = stopped ? 'stopped' : (runLog.error ? 'failed' : 'done');
    const stepCount = Array.isArray(runLog.steps) ? runLog.steps.length : 0;
    logger.event('task.run.finished', { runId: task.runId, presetId: task.presetId, status: finalStatus, error: runLog.error || null, steps: stepCount }, runLog.error ? 'warn' : 'info');
    // persist task_runs entry
    try {
      // If task has waitMinutes configured, insert initial run row with waiting_* status
      const wm = (typeof task.waitMinutes === 'number' && Number.isFinite(task.waitMinutes) && task.waitMinutes > 0) ? Number(task.waitMinutes) : 0;
      const statusToInsert = (wm && finalStatus === 'ok')
        ? 'waiting_success'
        : (wm && finalStatus === 'failed')
          ? 'waiting_failed'
          : (wm && finalStatus === 'stopped')
            ? 'waiting_stopped'
            : finalStatus;
      dbRun('INSERT INTO task_runs(runId, task_id, started_at, ended_at, status, result_json) VALUES(?,?,?,?,?,?)',
        [task.runId, null, Date.parse(runLog.start) || Date.now(), Date.parse(runLog.end) || Date.now(), statusToInsert, JSON.stringify(runLog)]);
      logger.event('task.run.persist', { runId: task.runId, insertedStatus: statusToInsert, waitMinutes: wm }, 'info');
    } catch (e:any) {
      logger.event('task.run.persist.err', { err: String(e?.message||e), runId: task.runId }, 'warn');
    }
    fs.writeFileSync(logPath, JSON.stringify(runLog, null, 2), 'utf8');
    // update tasks table status
    try {
      dbRun('UPDATE tasks SET status = ?, updated_at = ? WHERE runId = ?', [status, Date.now(), task.runId]);
    } catch (e:any) {
      logger.event('task.update.status.err', { err: String(e?.message||e), runId: task.runId }, 'warn');
    }
  }
  return finalStatus;
}

export async function startWorker() {
  if (running) return;
  running = true;
  logger.event('task.worker.start', {}, 'info');
  while (true) {
    if (!executionEnabled) {
      await new Promise(r => setTimeout(r, 1000));
      continue;
    }
    let t: Task | undefined = queue.shift();
    // if no in-memory task, try fetch one from DB pending
    if (!t) {
      try {
        const now = Date.now();
        const rows: any[] = dbQuery('SELECT id, runId, preset_id as presetId, container_id as containerId, overrides_json as overridesJson, scheduled_at as scheduledAt, group_id as groupId, wait_minutes as waitMinutes FROM tasks WHERE status = ? AND (scheduled_at IS NULL OR scheduled_at <= ?) ORDER BY created_at ASC LIMIT 1', ['pending', now]);
        if (rows && rows.length) {
          const row = rows[0];
          // mark as running
          dbRun('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?', ['running', Date.now(), row.id]);
          const parsedWaitMinutes = (() => {
            if (typeof row.waitMinutes === 'number' && Number.isFinite(row.waitMinutes)) return row.waitMinutes;
            const asNum = Number(row.waitMinutes);
            return Number.isFinite(asNum) ? asNum : 10;
          })();
          t = { runId: row.runId, presetId: row.presetId, containerId: row.containerId, overrides: (()=>{ try{ return JSON.parse(row.overridesJson||'{}'); }catch{return {};}})(), scheduledAt: row.scheduledAt, groupId: row.groupId, waitMinutes: parsedWaitMinutes };
        }
      } catch (e:any) {
        logger.event('task.worker.db.err', { err: String(e?.message||e) }, 'error');
      }
    }
    if (!t) break;
    try {
      const finalStatus = await runTask(t);
      const waitMinutes = (typeof t.waitMinutes === 'number' && Number.isFinite(t.waitMinutes) && t.waitMinutes > 0) ? t.waitMinutes : 0;
      const statusMap: Record<RunTaskFinalStatus, WaitingStatus> = {
        ok: 'waiting_success',
        failed: 'waiting_failed',
        stopped: 'waiting_stopped',
      };
      let waitingStatus: WaitingStatus | null = null;
      if (waitMinutes && statusMap[finalStatus]) {
        waitingStatus = statusMap[finalStatus];
        dbRun('UPDATE tasks SET status = ?, updated_at = ? WHERE runId = ?', [waitingStatus, Date.now(), t.runId]);
        try {
          // reflect waiting status also in task_runs so UI doesn't treat the run as finished immediately
          dbRun('UPDATE task_runs SET status = ? WHERE runId = ?', [waitingStatus, t.runId]);
        } catch (e:any) {
          logger.event('task.worker.update_run_waiting.err', { runId: t.runId, err: String(e?.message||e) }, 'warn');
        }
      }
      if (waitMinutes) {
        logger.event('task.waiting.start', { runId: t.runId, waitMinutes, finalStatus, waitingStatus: Boolean(waitingStatus) }, 'info');
        await new Promise(r => setTimeout(r, waitMinutes * 60000));
        logger.event('task.waiting.end', { runId: t.runId, waitMinutes, finalStatus }, 'info');
      }
      if (waitingStatus) {
        const postStatus = finalStatus === 'ok' ? 'done' : finalStatus;
        dbRun('UPDATE tasks SET status = ?, updated_at = ? WHERE runId = ?', [postStatus, Date.now(), t.runId]);
        try {
          dbRun('UPDATE task_runs SET status = ? WHERE runId = ?', [finalStatus, t.runId]);
        } catch (e:any) {
          logger.event('task.worker.update_run_postwait.err', { runId: t.runId, err: String(e?.message||e) }, 'warn');
        }
      }
    } catch (e:any) {
      logger.event('task.worker.taskerr', { runId: t.runId, err: String(e?.message||e) }, 'error');
    }
    // small pause to avoid tight loop
    await new Promise(r => setTimeout(r, 50));
  }
  running = false;
  scheduleNearestPendingTask();
  logger.event('task.worker.idle', {}, 'info');
}

// start on import
startWorker().catch(()=>{});

export { parsePresetStepsJson, resolveStepTimeoutMs };


