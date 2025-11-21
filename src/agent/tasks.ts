import crypto from 'node:crypto';
import { dispatch } from './executor';
import { memSet } from './memory';
import type { PlannerResultV2 } from './planner';
import { logger } from '../utils/logger.js';

export type TaskStatus = "planning" | "waiting_confirm" | "running" | "blocked" | "done" | "failed" | "stopped";

export type RunLogEntry = {
  index: number;
  capability: string;
  args: Record<string, any>;
  ok: boolean;
  result?: any;
  error?: string;
  ts: string;
}

export type Task = {
  id: string;
  chatId?: string;
  createdAt: string;
  status: TaskStatus;
  plannerResult: any;
  currentStepIndex: number;
  logs: RunLogEntry[];
}

const tasks = new Map<string, Task>();

function genId() {
  return `task-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

export function createTask(chatId: string | undefined, plannerResult: PlannerResultV2 | any): Task {
  const id = genId();
  const t: Task = {
    id,
    chatId,
    createdAt: new Date().toISOString(),
    status: 'planning',
    plannerResult,
    currentStepIndex: 0,
    logs: []
  };
  tasks.set(id, t);
  return t;
}

export function getTask(id: string): Task | undefined {
  return tasks.get(id);
}

export function listTasks(): Task[] {
  return Array.from(tasks.values());
}

async function runCapability(cap: string, args: any): Promise<{ ok: boolean; result?: any; error?: string }> {
  // Map high-level capabilities to executor primitives where possible
  try {
    if (cap === 'x_open_profile') {
      // prefer navigate to profile URL
      let account = args.accountTag || args.screenName;
      if (typeof account === 'string' && account.startsWith('@')) account = account.slice(1);
      const url = args.url || (account ? `https://x.com/${account}` : undefined);
      const ctxId = args.containerId || args.contextId;
      if (!url) return { ok: false, error: 'missing accountTag/screenName/url' };
      return await dispatch({ capability: 'navigate', args: { contextId: ctxId, url } });
    }
    if (cap === 'x_collect_recent_posts') {
      // placeholder: in real impl this would scrape the profile page in browser
      const max = Number(args.maxCount || 20);
      const posts: any[] = []; // empty placeholder
      return { ok: true, result: { posts, count: posts.length } };
    }
    if (cap === 'x_like_recent_posts') {
      // placeholder: pretend we liked min(maxLikes,0)
      const maxLikes = Number(args.maxLikes || args.max || 0);
      // In a fuller impl we would read memGet(`task.${taskId}.posts`) etc.
      return { ok: true, result: { liked: 0, requested: maxLikes } };
    }
    if (cap === 'run_preset') {
      // delegate to existing server-side task queue via enqueueTask is handled elsewhere (server.ts).
      // Here we simply return ok with a note.
      return { ok: true, result: { queued: true, presetId: args.presetId || args.id || null } };
    }
    // Fallback: call dispatcher directly for primitive capabilities
    return await dispatch({ capability: cap, args });
  } catch (e:any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export async function runTask(taskOrId: Task | string): Promise<Task> {
  const task = typeof taskOrId === 'string' ? tasks.get(taskOrId) : taskOrId;
  if (!task) throw new Error('task not found');
  if (!task.plannerResult) throw new Error('plannerResult missing in task');

  task.status = 'running';
  const steps: any[] | null | undefined = task.plannerResult.steps;
  try {
    if (steps && Array.isArray(steps) && steps.length > 0) {
      for (let i = task.currentStepIndex; i < steps.length; i++) {
        const st = steps[i];
        const cap = String(st.capability || st.capability || '');
        const args = st.arguments || {};
        const entryBase: RunLogEntry = { index: i, capability: cap, args, ok: false, ts: new Date().toISOString() };
        // execute capability
        const resp = await runCapability(cap, args);
        entryBase.ok = !!resp.ok;
        entryBase.result = resp.result;
        if (!resp.ok) entryBase.error = resp.error;
        task.logs.push(entryBase);
        // store collected posts or other results to memory if needed
        try {
          if (cap === 'x_collect_recent_posts' && entryBase.ok && entryBase.result && Array.isArray(entryBase.result.posts)) {
            memSet(`task.${task.id}.posts`, entryBase.result.posts);
          }
        } catch (e:any) { /* ignore mem write errors */ }
        task.currentStepIndex = i + 1;
        // blocked detection
        if (!entryBase.ok) {
          const err = (entryBase.error || '').toLowerCase();
          if (err.includes('captcha') || err.includes('2fa') || err.includes('user interaction') || err.includes('blocked')) {
            task.status = 'blocked';
            tasks.set(task.id, task);
            return task;
          } else {
            // non-blocking error -> mark failed and stop
            task.status = 'failed';
            tasks.set(task.id, task);
            return task;
          }
        }
      }
      task.status = 'done';
    } else {
      // no steps: treat as single capability fallback (plannerResult.capability)
      const cap = String(task.plannerResult.capability || '');
      const args = task.plannerResult.arguments || {};
      const entryBase: RunLogEntry = { index: 0, capability: cap, args, ok: false, ts: new Date().toISOString() };
      const resp = await runCapability(cap, args);
      entryBase.ok = !!resp.ok;
      entryBase.result = resp.result;
      if (!resp.ok) entryBase.error = resp.error;
      task.logs.push(entryBase);
      task.status = entryBase.ok ? 'done' : 'failed';
    }
  } catch (e:any) {
    task.status = 'failed';
    task.logs.push({ index: task.currentStepIndex, capability: 'internal', args: {}, ok: false, error: String(e?.message || e), ts: new Date().toISOString() });
  } finally {
    tasks.set(task.id, task);
    logger.event('task.run.complete', { taskId: task.id, status: task.status }, task.status === 'done' ? 'info' : 'warn');
  }
  return task;
}


