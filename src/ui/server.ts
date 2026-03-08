// esbuildのログを抑制（tsx起動前に設定）
if (!process.env.ESBUILD_LOG_LEVEL) {
  process.env.ESBUILD_LOG_LEVEL = 'silent';
}
import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import Database from 'better-sqlite3';
import type { Request, Response, NextFunction } from 'express';
import { initDb, query as dbQuery, memGet, memSet, run as dbRun, transaction } from '../drivers/db';
import { chatText, chatJson } from '../drivers/openai';
import { logger } from '../utils/logger';
import { openContainer, createContainer, closeContainer, navigateInContext, evalInContext, getPageHtml, buildTypeAsEvalCode } from '../drivers/browser';
import crypto from 'node:crypto';
import keytar from 'keytar';
import { exportRestored, deleteExported } from '../services/exportedProfiles';
import * as PresetService from '../services/presets';
import child_process from 'node:child_process';
import { enqueueTask, setExecutionEnabled, isExecutionEnabled, parsePresetStepsJson, resolveStepTimeoutMs, removeQueuedTask, cancelWaitingRun, reloadContainerBrowserConfig, canConnectToContainerBrowser, getExecutionConnectivityIssue, setExecutionConnectivityIssue, ALL_QUEUE_NAMES } from '../services/taskQueue';
import { loadSettings, saveSettings, type AppSettings } from '../services/appSettings';

const spawnedMap = new Map<number, child_process.ChildProcess>();
// local accounts management and container-db helpers
const ACC_PATH = path.join(process.cwd(), 'config', 'accounts.json');
function readAccounts(): Array<{name:string; profileUserDataDir:string}> { try { return JSON.parse(fs.readFileSync(ACC_PATH,'utf8')); } catch { return []; } }
function writeAccounts(items: any[]) { fs.mkdirSync(path.dirname(ACC_PATH), { recursive: true }); fs.writeFileSync(ACC_PATH, JSON.stringify(items, null, 2), 'utf8'); }
function appData(): string { return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'); }
function dirFromPartition(partition: string): string { const base = String(partition || '').replace(/^persist:/, ''); return path.join(appData(), 'container-browser', 'Partitions', base); }
import { dispatch } from '../agent/executor';
import { scanContainers, findCompanionDbs, inspectDbSchema, importAccounts } from '../services/profiles';

const app = express();
let currentSettings = loadSettings();
const DASHBOARD_PORT = Number(process.env.DASHBOARD_PORT || currentSettings.dashboardPort || 5174);

function getContainerExportConfig() {
  const host = process.env.CONTAINER_EXPORT_HOST || currentSettings.containerBrowserHost || '127.0.0.1';
  const port = Number(process.env.CONTAINER_EXPORT_PORT || currentSettings.containerBrowserPort || 3001);
  return { host, port };
}

/** Container Browser の host/port（taskQueue と同一の設定を使用。 /internal/exec 用） */
function getContainerBrowserConfig() {
  const host = currentSettings.containerBrowserHost || '127.0.0.1';
  const port = Number(currentSettings.containerBrowserPort || 3001);
  return { host, port };
}

function persistSettings(partial: Partial<AppSettings>) {
  currentSettings = saveSettings(partial);
  return currentSettings;
}

initDb({ wal: true });

// サーバー起動時にすべてのキューの実行状態を停止にする（タスクが一斉に実行されるのを防ぐ）
try {
  for (const queueName of ALL_QUEUE_NAMES) {
    setExecutionEnabled(false, queueName);
  }
  logger.event('system.startup.queues_stopped', { queueCount: ALL_QUEUE_NAMES.length }, 'info');
} catch (e: any) {
  logger.event('system.startup.queues_stop.err', { err: String(e?.message||e) }, 'warn');
}

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: true }));

// Import multer for file uploads
import multer from 'multer';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024, files: 4 } });

// HTTP 計測ミドルウェア (軽量)
app.use((req: Request, res: Response, next: NextFunction) => {
  const t0 = Date.now();
  const { method, url } = req;
  const bodyPreview = (() => {
    try {
      const s = JSON.stringify(req.body ?? {});
      return s.length > 500 ? s.slice(0, 500) + '...(truncated)' : s;
    } catch { return ''; }
  })();
  const pathOnly = String(url || '').split('?')[0];
  const skipPaths = ['/api/tasks', '/api/health', '/api/task_runs', '/api/containers', '/api/kv/taskListBulkWaitMinutes'];
  if (skipPaths.some(p => pathOnly.startsWith(p))) {
    return next();
  }
  logger.event('http.req', { method, url, bodyPreview }, 'info');
  res.on('finish', () => {
    const ms = Date.now() - t0;
    const status = res.statusCode;
    logger.event('http.res', { method, url, status, ms, contentLength: res.getHeader('Content-Length') }, status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info');
  });
  next();
});

// Save settings, reload runtime config, and check connectivity to container-export server.
app.post('/api/settings/save_and_check', async (req, res) => {
  try {
    const partial = req.body || {};
    const persisted = persistSettings(partial);
    // attempt TCP connect to the persisted host/port
    const host = persisted.containerBrowserHost || '127.0.0.1';
    const port = Number(persisted.containerBrowserPort || 3001);
    const net = await import('node:net');
    const ok = await new Promise<boolean>((resolve) => {
      try {
        const sock = net.createConnection({ host, port }, () => {
          try { sock.destroy(); } catch {}
          resolve(true);
        });
        sock.setTimeout(2000, () => { try { sock.destroy(); } catch {} ; resolve(false); });
        sock.on('error', () => { try { sock.destroy(); } catch {} ; resolve(false); });
      } catch (e) {
        resolve(false);
      }
    });
    // reload taskQueue config so worker uses new settings
    try { reloadContainerBrowserConfig(); } catch (e:any) { logger.event('settings.reload.err', { err: String(e?.message||e) }, 'warn'); }
    return res.json({ ok: true, host, port, connected: ok, settings: persisted });
  } catch (e:any) {
    logger.event('api.settings.save_and_check.err', { err: String(e?.message||e) }, 'error');
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Utility for container-browser default path (env override)
function defaultCbDir(): string {
  const appdata = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appdata, 'container-browser');
}
function defaultContainerDb(): string {
  return process.env.DEFAULT_CB_DB || path.join(defaultCbDir(), 'data.db');
}

/**
 * コンテナID（UUID）からコンテナ名（XID）を取得する
 * @param containerId コンテナID（UUID）
 * @returns コンテナ名（XID）、見つからない場合はnull
 */
function getContainerNameFromId(containerId: string): string | null {
  try {
    const dbPath = defaultContainerDb();
    if (!fs.existsSync(dbPath)) {
      logger.event('api.container_name_from_id.db_not_found', { containerId, dbPath }, 'warn');
      return null;
    }
    
    const containers = probeContainersFromDb(dbPath);
    const container = containers.find((c: any) => String(c.id) === String(containerId));
    
    if (container && container.name) {
      const containerName = String(container.name);
      logger.event('api.container_name_from_id.resolved', { containerId, containerName }, 'debug');
      return containerName;
    }
    
    logger.event('api.container_name_from_id.not_found', { containerId }, 'warn');
    return null;
  } catch (e: any) {
    logger.event('api.container_name_from_id.err', { containerId, err: String(e?.message || e) }, 'warn');
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
      logger.event('api.x_account.group_move_info.updated', {
        containerId,
        previousGroupName: previousGroupNameValue,
        newGroupId,
        movedAt
      }, 'debug');
    } else {
      logger.event('api.x_account.group_move_info.not_found', {
        containerId,
        isUuidFormat
      }, 'warn');
    }
  } catch (e: any) {
    logger.event('api.x_account.group_move_info.update_failed', {
      containerId,
      newGroupId,
      error: String(e?.message || e)
    }, 'error');
  }
}

function probeContainersFromDb(dbPath: string) {
  if (!fs.existsSync(dbPath)) throw new Error(`db not found: ${dbPath}`);
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare(`
    SELECT id,name,userDataDir,partition,updatedAt
    FROM containers ORDER BY updatedAt DESC
  `).all();
  return rows.map((r: any) => ({ id: r.id, name: r.name || r.id, dir: (r.userDataDir && String(r.userDataDir).trim()) ? r.userDataDir : dirFromPartition(r.partition), partition: r.partition, updatedAt: r.updatedAt }));
}

/**
 * コンテナ名（XID）からコンテナID（UUID）を取得する
 * @param containerName コンテナ名（XID）
 * @returns コンテナID（UUID）、見つからない場合はnull
 */
function getContainerIdFromName(containerName: string): string | null {
  try {
    const dbPath = defaultContainerDb();
    if (!fs.existsSync(dbPath)) {
      logger.event('debug.container_id_from_name.db_not_found', { containerName, dbPath }, 'warn');
      return null;
    }
    
    const containerDb = new Database(dbPath, { readonly: true });
    const containerRow = containerDb.prepare('SELECT id FROM containers WHERE name = ? LIMIT 1').get(containerName) as { id?: string } | undefined;
    containerDb.close();
    
    if (containerRow && containerRow.id) {
      const containerId = String(containerRow.id);
      logger.event('debug.container_id_from_name.resolved', { containerName, containerId }, 'debug');
      return containerId;
    }
    
    logger.event('debug.container_id_from_name.not_found', { containerName }, 'warn');
    return null;
  } catch (e: any) {
    logger.event('debug.container_id_from_name.err', { containerName, err: String(e?.message || e) }, 'warn');
    return null;
  }
}

// モデル一覧（簡易）
app.get('/api/models', (_req, res) => {
  res.json(['gpt-5-nano', 'gpt-5-mini', 'gpt-4o-mini']);
});



// 健康チェック
app.get('/api/health', async (req, res) => {
  const dbPath = path.resolve('storage', 'app.db');
  const shotsDir = path.resolve('shots');
  let shotsCount = 0;
  try {
    shotsCount = fs.readdirSync(shotsDir).filter(f => f.toLowerCase().endsWith('.png')).length;
  } catch {}
  
  // Container Browser のヘルスチェック
  const { checkContainerBrowserHealth } = await import('../drivers/browser');
  const cbHealth = await checkContainerBrowserHealth();
  
  res.json({ 
    ok: true, 
    dbPath, 
    shotsDir, 
    shotsCount,
    containerBrowser: cbHealth,
  });
});

app.get('/api/settings', (_req, res) => {
  try {
    res.json({ ok: true, settings: currentSettings });
  } catch (e:any) {
    logger.event('api.settings.get.err', { err: String(e?.message || e) }, 'error');
    res.status(500).json({ ok:false, error: 'settings_load_failed' });
  }
});

app.post('/api/settings', (req, res) => {
  try {
    const body = req.body || {};
    const updates: Partial<AppSettings> = {};
    if (typeof body.dashboardPort !== 'undefined') {
      const parsed = Number(body.dashboardPort);
      if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) return res.status(400).json({ ok:false, error: 'dashboardPort invalid' });
      updates.dashboardPort = Math.round(parsed);
    }
    if (typeof body.containerBrowserPort !== 'undefined') {
      const parsed = Number(body.containerBrowserPort);
      if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) return res.status(400).json({ ok:false, error: 'containerBrowserPort invalid' });
      updates.containerBrowserPort = Math.round(parsed);
    }
    if (typeof body.containerBrowserHost !== 'undefined') {
      const host = String(body.containerBrowserHost).trim();
      if (!host) return res.status(400).json({ ok:false, error: 'containerBrowserHost invalid' });
      updates.containerBrowserHost = host;
    }
    if (typeof body.discordWebhookUrl !== 'undefined') {
      const url = String(body.discordWebhookUrl).trim();
      // 空文字列の場合は undefined に設定（削除）
      updates.discordWebhookUrl = url || undefined;
    }
    if (!Object.keys(updates).length) return res.status(400).json({ ok:false, error: 'nothing_to_update' });
    persistSettings(updates);
    res.json({ ok: true, settings: currentSettings, notice: '設定は保存されました。再起動して反映してください。' });
  } catch (e:any) {
    logger.event('api.settings.post.err', { err: String(e?.message || e) }, 'error');
    res.status(500).json({ ok:false, error: 'settings_save_failed' });
  }
});

// 管理向け：古い task_runs を最大 N 件削除する（同期実行・即時戻り値）
app.post('/api/admin/purge-task-runs', (req, res) => {
  try {
    const body = req.body || {};
    const olderThanDaysRaw = Number.isFinite(Number(body.olderThanDays)) ? Number(body.olderThanDays) : 30;
    const requestedMax = Number.isFinite(Number(body.maxPerBatch)) ? Math.max(1, Math.floor(Number(body.maxPerBatch))) : 1000;
    const maxPerBatch = Math.min(1000, requestedMax); // サーバ側上限
    const days = Math.max(1, Math.floor(olderThanDaysRaw));
    const cutoff = Date.now() - days * 24 * 3600 * 1000; // created_at は ms

    // 削除クエリ（サブクエリで LIMIT を適用）
    const info = dbRun(
      'DELETE FROM task_runs WHERE id IN (SELECT id FROM task_runs WHERE created_at < ? ORDER BY created_at ASC LIMIT ?)',
      [cutoff, maxPerBatch]
    );
    const removed = (info && (info as any).changes) ? (info as any).changes : 0;
    logger.event('api.purge.ok', { olderThanDays: days, maxPerBatch, removed }, 'info');
    return res.json({ ok: true, removed });
  } catch (e:any) {
    logger.event('api.purge.err', { err: String(e?.message || e) }, 'error');
    return res.status(500).json({ ok:false, error: 'purge_failed' });
  }
});

// 管理画面用の最小UI（ボタン + ローディング + アラート）
app.get('/admin/purge-ui', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html>
<html>
<head><meta charset="utf-8"><title>DB Purge</title></head>
<body style="font-family:system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', Arial;">
  <h3>古い実行ログを削除（task_runs）</h3>
  <label>保持日数（古いものを削除、日）: <input id="days" type="number" value="30" min="1" style="width:80px" /></label>
  <button id="btn" style="margin-left:12px">削除（最大1000件）</button>
  <span id="status" style="margin-left:12px"></span>
  <script>
    const btn = document.getElementById('btn');
    const daysInput = document.getElementById('days');
    const status = document.getElementById('status');
    btn.addEventListener('click', async () => {
      const days = Number(daysInput.value) || 30;
      btn.disabled = true;
      status.textContent = '削除中…';
      try {
        const resp = await fetch('/api/admin/purge-task-runs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ olderThanDays: days, maxPerBatch: 1000 })
        });
        const j = await resp.json();
        if (j && j.ok) {
          alert('削除完了。削除件数: ' + (j.removed || 0));
        } else {
          alert('削除に失敗しました: ' + (j && j.error ? j.error : 'unknown'));
        }
      } catch (e) {
        alert('通信エラー: ' + e);
      } finally {
        btn.disabled = false;
        status.textContent = '';
      }
    });
  </script>
</body>
</html>`);
});

function scheduleExit(reason: 'stop' | 'restart') {
  // 両方のキューを無効化
  setExecutionEnabled(false, 'default');
  setExecutionEnabled(false, 'queue2');
  logger.event('system.shutdown', { reason }, reason === 'restart' ? 'info' : 'warn');
  setTimeout(() => { process.exit(0); }, 600);
}

app.post('/api/system/stop', (_req, res) => {
  scheduleExit('stop');
  res.json({ ok:true, reason:'stop' });
});

app.post('/api/system/restart', (_req, res) => {
  scheduleExit('restart');
  res.json({ ok:true, reason:'restart' });
});


// posts 取得（shotUrl を付与）- 削除: postsテーブルは廃止されました。代わりに /api/x-posts を使用してください。
// app.get('/api/posts', (req, res) => {
//   const limit = Number(req.query.limit || 20);
//   const rows = dbQuery<any>('SELECT id,ts,platform,account,text_hash,url,result,evidence FROM posts ORDER BY id DESC LIMIT ?', [limit])
//     .map((r: any) => ({ ...r, shotUrl: r.evidence ? (`/shots/${path.basename(r.evidence)}`) : null }));
//   res.json(rows);
// });

// recent task_runs (executed runs)
app.get('/api/task_runs', (req, res) => {
  try {
    const rawLimit = Number(req.query.limit || 50);
    const limit = Math.min(Math.max(1, rawLimit), 200);
    const offset = Math.max(0, Number(req.query.offset || 0));
    
    // フィルター条件を取得
    const groupId = req.query.groupId ? String(req.query.groupId) : null;
    const containerId = req.query.containerId ? String(req.query.containerId) : null;
    const presetName = req.query.presetName ? String(req.query.presetName) : null;
    const status = req.query.status ? String(req.query.status) : null;
    
    // WHERE句を構築
    const whereConditions: string[] = [];
    const queryParams: any[] = [];
    
    // グループIDでフィルタリング（container_group_members経由）
    if (groupId === '__unassigned') {
      whereConditions.push(`(t.container_id IS NULL OR t.container_id NOT IN (SELECT container_id FROM container_group_members WHERE container_id IS NOT NULL))`);
    } else if (groupId && groupId !== '') {
      whereConditions.push(`t.container_id IN (SELECT container_id FROM container_group_members WHERE group_id = ?)`);
      queryParams.push(groupId);
    }
    
    // コンテナIDでフィルタリング（部分一致）
    if (containerId && containerId !== '') {
      // コンテナIDがカンマ区切りの場合は IN 句を使用、それ以外は部分一致
      if (containerId.includes(',')) {
        const ids = containerId.split(',').map(id => id.trim()).filter(Boolean);
        if (ids.length > 0) {
          const placeholders = ids.map(() => '?').join(',');
          whereConditions.push(`t.container_id IN (${placeholders})`);
          queryParams.push(...ids);
        }
      } else {
        whereConditions.push(`t.container_id LIKE ?`);
        queryParams.push(`%${containerId}%`);
      }
    }
    
    // プリセット名でフィルタリング（部分一致）
    if (presetName && presetName !== '') {
      whereConditions.push(`p.name LIKE ?`);
      queryParams.push(`%${presetName}%`);
    }
    
    // ステータスでフィルタリング
    if (status && status !== '') {
      if (status === 'success') {
        whereConditions.push(`(LOWER(tr.status) = 'ok' OR LOWER(tr.status) = 'done')`);
      } else if (status === 'not_success') {
        whereConditions.push(`(LOWER(tr.status) != 'ok' AND LOWER(tr.status) != 'done')`);
      } else if (status === 'failure') {
        whereConditions.push(`LOWER(tr.status) = 'failed'`);
      } else if (status === 'stopped') {
        whereConditions.push(`LOWER(tr.status) = 'stopped'`);
      }
    }
    
    // タスクキューでフィルタリング
    const queueName = req.query.queueName ? String(req.query.queueName) : null;
    if (queueName && queueName !== '') {
      whereConditions.push(`(t.queue_name = ? OR (t.queue_name IS NULL AND ? = 'default'))`);
      queryParams.push(queueName, queueName);
    }
    
    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';
    
    // JOIN を使って tasks, presets, container_group_members, container_groups と結合
    const sql = `
      SELECT DISTINCT 
        tr.id, tr.runId, tr.task_id, tr.started_at, tr.ended_at, tr.status, tr.result_json, 
        p.name AS presetName, 
        t.queue_name, t.container_id, t.group_id AS group_id,
        cg.name AS groupName
      FROM task_runs tr
      LEFT JOIN tasks t ON tr.runId = t.runId
      LEFT JOIN presets p ON t.preset_id = p.id
      LEFT JOIN container_groups cg ON t.group_id = cg.id
      ${whereClause}
      ORDER BY tr.started_at DESC
      LIMIT ? OFFSET ?
    `;
    queryParams.push(limit, offset);
    
    const rows = dbQuery<any>(sql, queryParams);
    
    // コンテナ名を解決するためのマップを作成
    const containerNameMap: Record<string, string> = {};
    const containerIds = rows
      .map((r: any) => r.container_id)
      .filter((id: any) => id && typeof id === 'string')
      .filter((id: string, index: number, self: string[]) => self.indexOf(id) === index);
    
    if (containerIds.length > 0) {
      const dbPath = defaultContainerDb();
      if (fs.existsSync(dbPath)) {
        try {
          const containers = probeContainersFromDb(dbPath);
          for (const c of containers || []) {
            const cid = String((c as any).id || '');
            const cname = String((c as any).name || '');
            if (cid) containerNameMap[cid] = cname || cid;
            if (cname) containerNameMap[cname] = cname;
          }
        } catch (e) {
          // コンテナ名の解決に失敗しても続行
        }
      }
    }
    
    // ステータスを正規化し、コンテナ名とグループ名を追加
    const out = rows.map((r:any) => {
      // normalize status for UI: ensure 'stopped' is distinguishable from 'failed'
      const rawStatus = (r && r.status) ? String(r.status) : '';
      let displayStatus = rawStatus;
      try {
        const s = rawStatus.toLowerCase();
        if (s === 'ok' || s === 'done') displayStatus = 'ok';
        else if (s === 'stopped') displayStatus = 'stopped';
        else if (s === 'failed') displayStatus = 'failed';
        else if (s.startsWith('waiting_')) displayStatus = s; // keep waiting_xxx as-is
        else displayStatus = rawStatus;
      } catch {
        displayStatus = rawStatus;
      }
      
      // コンテナ名を解決
      let containerName = '';
      if (r.container_id) {
        const containerId = String(r.container_id);
        containerName = containerNameMap[containerId] || containerId;
      }
      
      return { 
        ...r, 
        presetName: r.presetName || null, 
        displayStatus, 
        queueName: r.queue_name || 'default',
        containerName: containerName || null,
        groupName: r.groupName || null,
      };
    });
    res.json({ ok: true, items: out, limit, offset, page: Math.floor(offset / limit) });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e) }); }
});

// DELETE task run (物理削除)
app.delete('/api/task-runs/:runId', (req, res) => {
  try {
    const runId = String(req.params.runId || '');
    if (!runId) return res.status(400).json({ ok:false, error: 'runId required' });
    // task_runsテーブルから削除
    dbRun('DELETE FROM task_runs WHERE runId = ?', [runId]);
    // tasksテーブルからも削除
    dbRun('DELETE FROM tasks WHERE runId = ?', [runId]);
    res.json({ ok:true, runId });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

// containers list (from container-db)
app.get('/api/containers', (req, res) => {
  try {
    const dbPath = defaultContainerDb();
    const items = probeContainersFromDb(dbPath);
    // merge DB-backed group assignments if available, else fall back to memory assignments
    try {
      ensureContainerGroupsTables();
      const rows = dbQuery<any>('SELECT container_id, group_id FROM container_group_members', []);
      const dbAssign: Record<string, string|null> = {};
      for (const r of rows || []) {
        try { dbAssign[String(r.container_id)] = r.group_id || null; } catch {}
      }
      const memAssign: Record<string, string> = memGet('containerAssignments') || {};
      for (const it of items) {
        try {
          const cid = String((it as any).id || '');
          if (typeof dbAssign[cid] !== 'undefined') (it as any).groupId = dbAssign[cid];
          else (it as any).groupId = memAssign[cid] || null;
        } catch {}
      }
    } catch (e) { /* ignore */ }
    res.json({ ok:true, items });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

// Container groups: ensure tables then CRUD
function ensureContainerGroupsTables() {
  try {
    dbRun(`
      CREATE TABLE IF NOT EXISTS container_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        color TEXT,
        created_at INTEGER,
        updated_at INTEGER
      );
    `, []);
    dbRun(`
      CREATE TABLE IF NOT EXISTS container_group_members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        container_id TEXT NOT NULL,
        group_id TEXT,
        created_at INTEGER,
        updated_at INTEGER,
        UNIQUE(container_id)
      );
    `, []);
  } catch (e) {
    // ignore - errors will be surfaced by callers
  }
}

// GET /api/x-accounts - Xアカウント一覧取得（コンテナ情報とグループ情報を含む）
// x_accountsテーブルのcontainer_idはコンテナ名（XID）で保持されていることを前提とする
app.get('/api/x-accounts', (req, res) => {
  try {
    ensureContainerGroupsTables();
    // x_accountsテーブルからデータを取得
    // container_idはコンテナ名（XID）で保存されている
    const xAccounts = dbQuery<any>('SELECT * FROM x_accounts ORDER BY created_at DESC', []);
    
    // デバッグ: donna91yhv4jを含むアカウントを確認
    const donnaAccount = xAccounts.find((acc: any) => String(acc.container_id || '') === 'donna91yhv4j');
    if (donnaAccount) {
      logger.event('api.x-accounts.debug.donna91yhv4j.raw_query', {
        acc_id: donnaAccount.id,
        acc_container_id: donnaAccount.container_id,
        acc_x_password_raw: donnaAccount.x_password,
        acc_x_password_type: typeof donnaAccount.x_password,
        acc_x_password_null: donnaAccount.x_password === null,
        acc_x_password_undefined: donnaAccount.x_password === undefined,
        acc_keys: Object.keys(donnaAccount).join(','),
        acc_x_password_in_keys: 'x_password' in donnaAccount,
        acc_has_x_password_prop: donnaAccount.hasOwnProperty('x_password'),
        acc_x_password_value: String(donnaAccount.x_password || '(null/undefined)').substring(0, 30)
      }, 'info');
    }
    
    // コンテナ一覧を取得
    const dbPath = defaultContainerDb();
    const containers = probeContainersFromDb(dbPath);
    const containerMap: Record<string, any> = {};
    for (const c of containers || []) {
      try {
        const cid = String((c as any).id || ''); // UUID
        const cname = String((c as any).name || ''); // XID（コンテナ名）
        // x_accountsテーブルのcontainer_idはコンテナ名（XID）で保存されているため、コンテナ名でマッチング
        if (cname) containerMap[cname] = c;
        // 後方互換性のため、UUIDでもマッチング可能にする
        if (cid) containerMap[cid] = c;
      } catch {}
    }
    
    // グループ情報を取得
    // container_group_membersテーブルのcontainer_idはUUID形式で保存されている
    const groupRows = dbQuery<any>('SELECT container_id, group_id FROM container_group_members', []);
    const groupByContainer: Record<string, string> = {};
    for (const r of groupRows || []) {
      try {
        groupByContainer[String(r.container_id)] = String(r.group_id || '');
      } catch {}
    }
    
    const groups = dbQuery<any>('SELECT * FROM container_groups', []);
    const groupMap: Record<string, any> = {};
    for (const g of groups || []) {
      try {
        groupMap[String(g.id)] = g;
      } catch {}
    }
    
    // プロキシ情報を取得
    const proxies = dbQuery<any>('SELECT id, proxy_info FROM proxies', []);
    const proxyMap: Record<number, string> = {};
    for (const p of proxies || []) {
      try {
        proxyMap[Number(p.id)] = String(p.proxy_info || '');
      } catch {}
    }
    
    // x_accountsとコンテナ情報を結合
    // x_accounts.container_idはコンテナ名（XID）またはUUID形式の可能性がある
    const items = [];
    const seenUuids = new Set<string>(); // 重複チェック用（container_uuidで管理）
    
    for (const acc of xAccounts || []) {
      const containerIdFromDb = String(acc.container_id || '');
      
      // デバッグ: donna91yhv4jの場合のみログ出力
      if (containerIdFromDb === 'donna91yhv4j') {
        logger.event('api.x-accounts.debug.donna91yhv4j', { 
          acc_id: acc.id, 
          acc_container_id: acc.container_id,
          acc_x_password_raw: acc.x_password,
          acc_x_password_type: typeof acc.x_password,
          acc_x_password_null: acc.x_password === null,
          acc_x_password_undefined: acc.x_password === undefined,
          acc_keys: Object.keys(acc).join(','),
          acc_x_password_in_keys: 'x_password' in acc,
          acc_has_x_password_prop: acc.hasOwnProperty('x_password'),
          acc_x_password_value: String(acc.x_password || '(null/undefined)').substring(0, 20)
        }, 'debug');
      }
      
      // container_idがUUID形式かコンテナ名かを判定
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(containerIdFromDb);
      
      let container: any = null;
      let containerUuid = '';
      let containerName = '';
      
      if (isUuid) {
        // UUID形式の場合
        container = containerMap[containerIdFromDb];
        if (container) {
          containerUuid = containerIdFromDb;
          containerName = String((container as any).name || '');
        }
      } else {
        // コンテナ名（XID）形式の場合
        container = containerMap[containerIdFromDb];
        if (container) {
          containerUuid = String((container as any).id || '');
          containerName = containerIdFromDb;
        }
      }
      
      // コンテナが存在しない場合はスキップ（デバッグログ付き）
      if (!container || !containerUuid) {
        logger.event('api.x-accounts.container_not_found', { container_id: containerIdFromDb, is_uuid: isUuid, available_names: Object.keys(containerMap).slice(0, 5) }, 'warn');
        continue;
      }
      
      // 重複チェック：同じcontainer_uuidが既に処理済みの場合はスキップ
      if (seenUuids.has(containerUuid)) {
        logger.event('api.x-accounts.duplicate_skipped', { container_id: containerIdFromDb, container_uuid: containerUuid }, 'info');
        continue;
      }
      seenUuids.add(containerUuid);
      
      // グループ情報はUUID形式で保存されているため、UUIDで検索
      const groupId = groupByContainer[containerUuid] || null;
      const group = groupId ? groupMap[groupId] : null;
      
      // x_passwordがnullまたは空の場合、再取得を試みる（フォールバック処理）
      let finalXPassword = acc.x_password;
      if (!finalXPassword || finalXPassword === null || finalXPassword === '' || finalXPassword === undefined) {
        const recheck = dbQuery<any>('SELECT x_password FROM x_accounts WHERE container_id = ? LIMIT 1', [containerIdFromDb]);
        if (recheck && recheck.length > 0 && recheck[0].x_password) {
          finalXPassword = recheck[0].x_password;
          // デバッグ: donna91yhv4jの場合のみ詳細ログ
          if (containerIdFromDb === 'donna91yhv4j') {
            logger.event('api.x-accounts.debug.donna91yhv4j.fallback', { 
              original_x_password: String(acc.x_password || '(null)').substring(0, 20),
              recheck_x_password: String(finalXPassword).substring(0, 20),
              acc_id: acc.id,
              acc_keys: Object.keys(acc).join(',')
            }, 'warn');
          }
        }
      }
      
      items.push({
        id: acc.id,
        container_id: containerName, // 表示用にはコンテナ名を使用
        container_uuid: containerUuid,
        container_name: containerName,
        email: acc.email,
        email_password: acc.email_password,
        x_username: acc.x_username,
        x_user_id: acc.x_user_id,
        x_password: finalXPassword,
        follower_count: acc.follower_count,
        following_count: acc.following_count,
        twofa_code: acc.twofa_code,
        auth_token: acc.auth_token,
        ct0: acc.ct0,
        proxy_id: acc.proxy_id,
        proxy_info: acc.proxy_id ? (proxyMap[Number(acc.proxy_id)] || null) : null,
        last_synced_at: acc.last_synced_at,
        created_at: acc.created_at,
        updated_at: acc.updated_at,
        group_id: groupId,
        group_name: group ? group.name : null,
        group_color: group ? group.color : null,
        profile_name: acc.profile_name || null,
        profile_bio: acc.profile_bio || null,
        profile_location: acc.profile_location || null,
        profile_website: acc.profile_website || null,
        profile_avatar_image_path: acc.profile_avatar_image_path || null,
        profile_banner_image_path: acc.profile_banner_image_path || null,
        notes: acc.notes || null,
      });
    }
    
    // container_id クエリがある場合は該当1件に絞る（コード取得セクション等でコンテナ指定取得に使用）
    const queryContainerId = req.query.container_id ? String(req.query.container_id).trim() : '';
    if (queryContainerId) {
      const filtered = items.filter((i: any) =>
        (i.container_id && String(i.container_id) === queryContainerId) ||
        (i.container_uuid && String(i.container_uuid) === queryContainerId)
      );
      return res.json({ ok: true, items: filtered });
    }

    logger.event('api.x-accounts.success', { total_x_accounts: xAccounts?.length || 0, matched_containers: items.length }, 'info');
    
    res.json({ ok: true, items });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// POST /api/admin/delete-x-accounts-by-group - 指定グループのコンテナに紐づくXアカウントデータを削除
app.post('/api/admin/delete-x-accounts-by-group', (req, res) => {
  try {
    ensureContainerGroupsTables();
    const { groupName = 'Banned' } = req.body || {};
    
    // グループ名でグループIDを取得
    const groupRows = dbQuery<any>('SELECT id FROM container_groups WHERE name = ?', [String(groupName)]);
    if (!groupRows || groupRows.length === 0) {
      return res.status(404).json({ ok: false, error: `グループ "${groupName}" が見つかりません` });
    }
    const groupId = String(groupRows[0].id);
    
    // そのグループに属するコンテナIDを取得
    const memberRows = dbQuery<any>('SELECT container_id FROM container_group_members WHERE group_id = ?', [groupId]);
    const containerIds = memberRows.map((r: any) => String(r.container_id));
    
    if (containerIds.length === 0) {
      return res.json({ ok: true, removed: 0, message: `グループ "${groupName}" にはコンテナが登録されていません` });
    }
    
    // コンテナIDに紐づくx_accountsを削除
    // container_id は UUID または XID（コンテナ名）の可能性があるため、両方のパターンでマッチング
    let deletedCount = 0;
    for (const containerId of containerIds) {
      const deleteResult = dbRun('DELETE FROM x_accounts WHERE container_id = ?', [containerId]);
      if (deleteResult && (deleteResult as any).changes) {
        deletedCount += (deleteResult as any).changes;
      }
    }
    
    logger.event('api.admin.delete-x-accounts-by-group.ok', { groupName, groupId, containerIds: containerIds.length, deletedCount }, 'info');
    res.json({ ok: true, removed: deletedCount, groupName, containerCount: containerIds.length });
  } catch (e: any) {
    logger.event('api.admin.delete-x-accounts-by-group.err', { err: String(e?.message || e) }, 'error');
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// GET /api/x-accounts/banned - Bannedグループに移動されたアカウント一覧取得
app.get('/api/x-accounts/banned', (req, res) => {
  try {
    ensureContainerGroupsTables();
    
    // クエリパラメータ取得
    const lastGroupName = req.query.lastGroupName ? String(req.query.lastGroupName) : null;
    const movedAtFrom = req.query.movedAtFrom ? Number(req.query.movedAtFrom) : null;
    const movedAtTo = req.query.movedAtTo ? Number(req.query.movedAtTo) : null;
    
    // BannedグループのIDを取得
    const bannedGroupRows = dbQuery<{ id: string }>('SELECT id FROM container_groups WHERE name = ?', ['Banned']);
    if (!bannedGroupRows || bannedGroupRows.length === 0) {
      return res.json({ ok: true, items: [] });
    }
    const bannedGroupId = String(bannedGroupRows[0].id);
    
    // Bannedグループに属するコンテナID（UUID形式）を取得
    const memberRows = dbQuery<{ container_id: string }>(
      'SELECT container_id FROM container_group_members WHERE group_id = ?',
      [bannedGroupId]
    );
    
    if (memberRows.length === 0) {
      return res.json({ ok: true, items: [] });
    }
    
    const containerUuids = memberRows.map(r => String(r.container_id));
    
    // コンテナDBからコンテナ情報を取得（UUID→コンテナ名のマッピングと作成日時）
    const dbPath = defaultContainerDb();
    const containerMap: Record<string, { name: string; createdAt: number | null }> = {};
    
    if (fs.existsSync(dbPath)) {
      try {
        const containerDb = new Database(dbPath, { readonly: true });
        const containerRows = containerDb.prepare(`
          SELECT id, name, createdAt
          FROM containers
          WHERE id IN (${containerUuids.map(() => '?').join(',')})
        `).all(...containerUuids) as Array<{ id: string; name: string; createdAt: number | null }>;
        containerDb.close();
        
        for (const row of containerRows) {
          containerMap[String(row.id)] = {
            name: String(row.name || row.id),
            createdAt: row.createdAt || null
          };
        }
      } catch (e: any) {
        logger.event('api.x-accounts.banned.container_db_err', { err: String(e?.message || e) }, 'warn');
      }
    }
    
    // x_accountsテーブルからデータを取得
    // container_idがUUID形式またはコンテナ名形式の両方に対応
    const whereConditions: string[] = [];
    const queryParams: any[] = [];
    
    // Bannedグループに属するコンテナの条件
    // x_accounts.container_idがUUID形式の場合
    const containerNames = Object.values(containerMap).map(c => c.name).filter(Boolean);
    
    // UUID形式とコンテナ名形式の両方の条件を構築
    const containerIdConditions: string[] = [];
    if (containerUuids.length > 0) {
      const uuidPlaceholders = containerUuids.map(() => '?').join(',');
      containerIdConditions.push(`xa.container_id IN (${uuidPlaceholders})`);
      queryParams.push(...containerUuids);
    }
    
    if (containerNames.length > 0) {
      const namePlaceholders = containerNames.map(() => '?').join(',');
      containerIdConditions.push(`xa.container_id IN (${namePlaceholders})`);
      queryParams.push(...containerNames);
    }
    
    if (containerIdConditions.length > 0) {
      whereConditions.push(`(${containerIdConditions.join(' OR ')})`);
    } else {
      // コンテナが見つからない場合は空の結果を返す
      return res.json({ ok: true, items: [] });
    }
    
    // last_group_moved_atがNULLでない（移動履歴がある）
    whereConditions.push('AND xa.last_group_moved_at IS NOT NULL');
    
    // 移動元グループでの絞り込み
    if (lastGroupName && lastGroupName.trim() !== '') {
      whereConditions.push('AND xa.last_group_name = ?');
      queryParams.push(lastGroupName.trim());
    }
    
    // 移動日時での範囲指定
    if (movedAtFrom !== null && !isNaN(movedAtFrom)) {
      whereConditions.push('AND xa.last_group_moved_at >= ?');
      queryParams.push(movedAtFrom);
    }
    if (movedAtTo !== null && !isNaN(movedAtTo)) {
      whereConditions.push('AND xa.last_group_moved_at <= ?');
      queryParams.push(movedAtTo);
    }
    
    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' ')}` : '';
    
    const sql = `
      SELECT 
        xa.container_id,
        xa.last_group_name,
        xa.last_group_moved_at
      FROM x_accounts xa
      ${whereClause}
      ORDER BY xa.last_group_moved_at DESC
    `;
    
    const xAccountRows = dbQuery<any>(sql, queryParams);
    
    // 結果を整形
    const items: Array<{
      container_id: string;
      container_name: string;
      last_group_name: string | null;
      last_group_moved_at: number | null;
      container_created_at: number | null;
    }> = [];
    
    for (const row of xAccountRows) {
      const containerIdFromDb = String(row.container_id || '');
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(containerIdFromDb);
      
      let containerName = containerIdFromDb;
      let containerUuid = '';
      let containerCreatedAt: number | null = null;
      
      if (isUuid) {
        // UUID形式の場合
        containerUuid = containerIdFromDb;
        const containerInfo = containerMap[containerUuid];
        if (containerInfo) {
          containerName = containerInfo.name;
          containerCreatedAt = containerInfo.createdAt;
        }
      } else {
        // コンテナ名形式の場合
        containerName = containerIdFromDb;
        // コンテナ名からUUIDを取得
        const containerInfo = Object.entries(containerMap).find(([_, info]) => info.name === containerName);
        if (containerInfo) {
          containerUuid = containerInfo[0];
          containerCreatedAt = containerInfo[1].createdAt;
        }
      }
      
      items.push({
        container_id: containerName,
        container_name: containerName,
        last_group_name: row.last_group_name || null,
        last_group_moved_at: row.last_group_moved_at || null,
        container_created_at: containerCreatedAt
      });
    }
    
    res.json({ ok: true, items });
  } catch (e: any) {
    logger.event('api.x-accounts.banned.err', { err: String(e?.message || e) }, 'error');
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// GET /api/proxies - プロキシ一覧取得（使用数を含む）
app.get('/api/proxies', (req, res) => {
  try {
    ensureContainerGroupsTables();
    
    // Bannedグループに属するコンテナIDを取得（除外対象）
    const bannedGroupRows = dbQuery<{ id: string }>('SELECT id FROM container_groups WHERE name = ?', ['Banned']);
    const excludedContainerIds = new Set<string>();
    
    if (bannedGroupRows && bannedGroupRows.length > 0) {
      const bannedGroupId = String(bannedGroupRows[0].id);
      const bannedMemberRows = dbQuery<{ container_id: string }>(
        'SELECT container_id FROM container_group_members WHERE group_id = ?',
        [bannedGroupId]
      );
      
      // コンテナマップを取得してUUID→コンテナ名（XID）の対応を取得
      const dbPath = defaultContainerDb();
      const containers = probeContainersFromDb(dbPath);
      const containerMap: Record<string, any> = {};
      for (const c of containers || []) {
        try {
          const cid = String((c as any).id || ''); // UUID
          const cname = String((c as any).name || ''); // XID（コンテナ名）
          if (cname) containerMap[cname] = c;
          if (cid) containerMap[cid] = c;
        } catch {}
      }
      
      // Bannedグループに属するコンテナID（UUIDとコンテナ名の両方）を除外リストに追加
      for (const row of bannedMemberRows || []) {
        const containerUuid = String(row.container_id || '');
        if (containerUuid) {
          excludedContainerIds.add(containerUuid);
          // UUIDに対応するコンテナ名（XID）も追加
          const container = containerMap[containerUuid];
          if (container) {
            const containerName = String((container as any).name || '');
            if (containerName) {
              excludedContainerIds.add(containerName);
            }
          }
        }
      }
    }
    
    // プロキシ情報と使用数を取得（Bannedグループを除外）
    const excludedParams = excludedContainerIds.size > 0 ? Array.from(excludedContainerIds) : [];
    const excludedPlaceholders = excludedContainerIds.size > 0 
      ? `AND xa.container_id NOT IN (${excludedParams.map(() => '?').join(',')})`
      : '';
    
    const proxies = dbQuery<{
      id: number;
      proxy_info: string;
      added_at: number;
      container_count: number;
    }>(`
      SELECT 
        p.id,
        p.proxy_info,
        p.added_at,
        COUNT(CASE WHEN xa.container_id IS NOT NULL ${excludedPlaceholders} THEN 1 END) as container_count
      FROM proxies p
      LEFT JOIN x_accounts xa ON p.id = xa.proxy_id
      GROUP BY p.id, p.proxy_info, p.added_at
      ORDER BY container_count DESC, p.added_at DESC
    `, excludedParams);

    // プロキシなしのアカウント数も取得（Bannedグループを除外）
    const noProxyCondition = excludedContainerIds.size > 0 
      ? `AND container_id NOT IN (${excludedParams.map(() => '?').join(',')})`
      : '';
    const noProxyCount = dbQuery<{ count: number }>(
      `SELECT COUNT(*) as count FROM x_accounts WHERE proxy_id IS NULL ${noProxyCondition}`,
      excludedParams
    )[0]?.count || 0;

    const items = proxies.map(p => ({
      id: p.id,
      proxy_info: p.proxy_info,
      added_at: p.added_at,
      container_count: p.container_count || 0,
    }));

    // プロキシなしのエントリを追加
    if (noProxyCount > 0) {
      items.push({
        id: 0,
        proxy_info: '(プロキシなし)',
        added_at: 0,
        container_count: noProxyCount,
      });
    }

    res.json({ ok: true, items });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// 統計情報取得API
app.get('/api/statistics', (req, res) => {
  try {
    ensureContainerGroupsTables();
    
    // 「X兵隊」で始まるグループ名のグループIDを取得
    // Bannedやロックメール未変更などのグループは除外（X兵隊で始まるもののみ対象）
    const targetGroups = dbQuery<{ id: string; name: string }>('SELECT id, name FROM container_groups WHERE name LIKE ?', ['X兵隊%']);
    const targetGroupIds = targetGroups.map(g => g.id);
    
    // デバッグ: 対象グループをログに記録
    try {
      logger.event('api.statistics.target_groups', { 
        groupCount: targetGroups.length, 
        groupNames: targetGroups.map(g => g.name),
        groupIds: targetGroupIds 
      }, 'info');
    } catch {}
    
    // 対象グループに属するコンテナUUIDを取得（重複を防ぐためにSetを使用）
    let targetContainerUuids: Set<string> = new Set();
    if (targetGroupIds.length > 0) {
      const placeholders = targetGroupIds.map(() => '?').join(',');
      const members = dbQuery<{ container_id: string }>(`SELECT DISTINCT container_id FROM container_group_members WHERE group_id IN (${placeholders})`, targetGroupIds);
      for (const m of members || []) targetContainerUuids.add(String(m.container_id));
    }
    
    // デバッグ: 対象コンテナUUID数をログに記録
    try {
      logger.event('api.statistics.target_container_uuids', { 
        count: targetContainerUuids.size 
      }, 'info');
    } catch {}
    
    // コンテナDBからUUID→コンテナ名（XID）のマッピングを作成
    // x_accountsテーブルのcontainer_idはコンテナ名（XID）形式で保存されているため、
    // コンテナ名のみをtargetContainerIdsに追加する
    let targetContainerIds: Set<string> = new Set();
    try {
      const dbPath = defaultContainerDb();
      if (fs.existsSync(dbPath)) {
        const containers = probeContainersFromDb(dbPath);
        for (const c of containers || []) {
          const cid = String((c as any).id || ''); // UUID
          const cname = String((c as any).name || ''); // XID（コンテナ名）
          if (targetContainerUuids.has(cid)) {
            // x_accounts.container_idはコンテナ名（XID）形式で保存されているため、コンテナ名のみを追加
            if (cname) targetContainerIds.add(cname); // コンテナ名形式のみ
          }
        }
      }
    } catch (e) {
      logger.event('api.statistics.container_db_err', { err: String(e) }, 'warn');
    }
    
    // デバッグ: 対象コンテナID数をログに記録
    try {
      logger.event('api.statistics.target_container_ids', { 
        count: targetContainerIds.size,
        targetContainerUuidsCount: targetContainerUuids.size,
        sampleIds: Array.from(targetContainerIds).slice(0, 10) // 最初の10個をサンプルとして記録
      }, 'info');
    } catch {}
    
    // 対象コンテナIDでフィルタリングしてアカウント統計を集計
    let accountCount = 0;
    let totalFollowers = 0;
    let totalFollowing = 0;
    
    if (targetContainerIds.size > 0) {
      // 対象コンテナIDのリストを作成（SQL IN句用）
      const containerIdList = Array.from(targetContainerIds);
      const placeholders = containerIdList.map(() => '?').join(',');
      
      // アカウントの総数
      const accountCountResult = dbQuery<{ count: number }>(`SELECT COUNT(*) as count FROM x_accounts WHERE container_id IN (${placeholders})`, containerIdList);
      accountCount = accountCountResult[0]?.count || 0;
      
      // デバッグ: 集計結果をログに記録
      try {
        // 全アカウント数も取得して比較（デバッグ用）
        const allAccountsResult = dbQuery<{ count: number }>('SELECT COUNT(*) as count FROM x_accounts', []);
        const allAccountCount = allAccountsResult[0]?.count || 0;
        
        // 対象外のcontainer_idを持つアカウントをサンプル取得（デバッグ用）
        // 最初の10件のユニークなcontainer_idを取得
        const unmatchedSamples = dbQuery<{ container_id: string; count: number }>(
          `SELECT container_id, COUNT(*) as count FROM x_accounts 
           WHERE container_id NOT IN (${placeholders}) 
           GROUP BY container_id 
           LIMIT 10`,
          containerIdList
        );
        
        // 重複調査: 同じcontainer_idを持つアカウントが複数存在するか確認
        const duplicateCheck = dbQuery<{ container_id: string; count: number }>(
          `SELECT container_id, COUNT(*) as count FROM x_accounts 
           WHERE container_id IN (${placeholders}) 
           GROUP BY container_id 
           HAVING COUNT(*) > 1 
           ORDER BY COUNT(*) DESC 
           LIMIT 20`,
          containerIdList
        );
        
        // 重複の統計情報
        const duplicateStats = {
          duplicateContainerCount: duplicateCheck.length,
          totalDuplicateAccounts: duplicateCheck.reduce((sum: number, d: any) => sum + (d.count - 1), 0), // 各コンテナの(件数-1)の合計
          maxDuplicateCount: duplicateCheck.length > 0 ? Math.max(...duplicateCheck.map((d: any) => d.count)) : 0,
          samples: duplicateCheck.slice(0, 10).map((d: any) => ({ container_id: d.container_id, count: d.count }))
        };
        
        logger.event('api.statistics.account_count', { 
          filteredCount: accountCount,
          allAccountCount: allAccountCount,
          targetContainerIdsCount: containerIdList.length,
          unmatchedContainerIdsSample: unmatchedSamples.map((s: any) => ({ container_id: s.container_id, count: s.count })),
          duplicateStats: duplicateStats
        }, 'info');
      } catch {}
      
      // 総フォロワー数
      const followerCountResult = dbQuery<{ total: number }>(`SELECT COALESCE(SUM(follower_count), 0) as total FROM x_accounts WHERE container_id IN (${placeholders}) AND follower_count IS NOT NULL`, containerIdList);
      totalFollowers = followerCountResult[0]?.total || 0;
      
      // 総フォロー数
      const followingCountResult = dbQuery<{ total: number }>(`SELECT COALESCE(SUM(following_count), 0) as total FROM x_accounts WHERE container_id IN (${placeholders}) AND following_count IS NOT NULL`, containerIdList);
      totalFollowing = followingCountResult[0]?.total || 0;
    } else {
      // 対象グループが見つからない場合は0を返す
      accountCount = 0;
      totalFollowers = 0;
      totalFollowing = 0;
    }

    // メール残数/総数
    const emailTotalResult = dbQuery<{ count: number }>('SELECT COUNT(*) as count FROM email_accounts', []);
    const emailTotal = emailTotalResult[0]?.count || 0;
    const emailRemainingResult = dbQuery<{ count: number }>('SELECT COUNT(*) as count FROM email_accounts WHERE used_at IS NULL', []);
    const emailRemaining = emailRemainingResult[0]?.count || 0;

    // プロフィール残数/総数
    const profileTotalResult = dbQuery<{ count: number }>('SELECT COUNT(*) as count FROM profile_templates', []);
    const profileTotal = profileTotalResult[0]?.count || 0;
    const profileRemainingResult = dbQuery<{ count: number }>('SELECT COUNT(*) as count FROM profile_templates WHERE used_at IS NULL', []);
    const profileRemaining = profileRemainingResult[0]?.count || 0;

    // プロキシ総数
    const proxyCountResult = dbQuery<{ count: number }>('SELECT COUNT(*) as count FROM proxies', []);
    const proxyCount = proxyCountResult[0]?.count || 0;

    // プロファイル画像総数/残数
    const profileIconTotalResult = dbQuery<{ count: number }>('SELECT COUNT(*) as count FROM profile_icons', []);
    const profileIconTotal = profileIconTotalResult[0]?.count || 0;
    const profileIconRemainingResult = dbQuery<{ count: number }>('SELECT COUNT(*) as count FROM profile_icons WHERE used = 0 OR used IS NULL', []);
    const profileIconRemaining = profileIconRemainingResult[0]?.count || 0;

    // ヘッダ画像総数/残数
    const headerIconTotalResult = dbQuery<{ count: number }>('SELECT COUNT(*) as count FROM header_icons', []);
    const headerIconTotal = headerIconTotalResult[0]?.count || 0;
    const headerIconRemainingResult = dbQuery<{ count: number }>('SELECT COUNT(*) as count FROM header_icons WHERE used = 0 OR used IS NULL', []);
    const headerIconRemaining = headerIconRemainingResult[0]?.count || 0;

    // タスクの実行状況
    // 実行中タスク数
    const runningTasksResult = dbQuery<{ count: number }>('SELECT COUNT(*) as count FROM tasks WHERE status = ?', ['running']);
    const runningTasks = runningTasksResult[0]?.count || 0;

    // 待機中タスク数（pending + waiting_*）
    // フロントエンド側のフィルター条件と一致：done/cancelled/実行済みで待機状態でないタスクを除外
    // pending ステータスで lastRun があるタスク（実行済みで待機状態でない）は除外
    // waiting_* ステータスのタスクは lastRun があってもカウント（実行済みだが待機状態）
    // 有効なキュー名（default, queue2-10）のみをカウント（存在しないキュー名のタスクを除外）
    const validQueueNames = ['default', 'queue2', 'queue3', 'queue4', 'queue5', 'queue6', 'queue7', 'queue8', 'queue9', 'queue10'];
    const queueNamePlaceholders = validQueueNames.map(() => '?').join(',');
    const waitingTasksSql = `
      SELECT COUNT(DISTINCT t.id) as count
      FROM tasks t
      LEFT JOIN (
        SELECT runId
        FROM task_runs
        GROUP BY runId
      ) tr ON t.runId = tr.runId
      WHERE t.status != ?
        AND t.status != ?
        AND (t.status = ? OR t.status LIKE ?)
        AND (t.queue_name IN (${queueNamePlaceholders}) OR (t.queue_name IS NULL))
        AND (
          tr.runId IS NULL
          OR t.status LIKE 'waiting_%'
        )
    `;
    const waitingTasksResult = dbQuery<{ count: number }>(waitingTasksSql, ['done', 'cancelled', 'pending', 'waiting_%', ...validQueueNames]);
    const waitingTasks = waitingTasksResult[0]?.count || 0;

    // 今日の日付範囲を計算（UNIXタイムスタンプ）
    const now = Date.now();
    const todayStart = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
    const todayEnd = new Date(new Date().setHours(23, 59, 59, 999)).getTime();

    // 今日の完了タスク数（task_runs.status = 'ok' かつ ended_atが今日）
    const todayCompletedResult = dbQuery<{ count: number }>('SELECT COUNT(*) as count FROM task_runs WHERE LOWER(status) = ? AND ended_at >= ? AND ended_at <= ?', ['ok', todayStart, todayEnd]);
    const todayCompleted = todayCompletedResult[0]?.count || 0;

    // 今日の失敗タスク数（task_runs.status = 'failed' かつ ended_atが今日）
    const todayFailedResult = dbQuery<{ count: number }>('SELECT COUNT(*) as count FROM task_runs WHERE LOWER(status) = ? AND ended_at >= ? AND ended_at <= ?', ['failed', todayStart, todayEnd]);
    const todayFailed = todayFailedResult[0]?.count || 0;

    // 当日の凍結数（account_status_events.event_type = 'suspended' かつ created_atが今日）
    let todaySuspended = 0;
    try {
      const todaySuspendedResult = dbQuery<{ count: number }>('SELECT COUNT(*) as count FROM account_status_events WHERE event_type = ? AND created_at >= ? AND created_at <= ?', ['suspended', todayStart, todayEnd]);
      todaySuspended = todaySuspendedResult[0]?.count || 0;
    } catch (e) {
      // テーブルが存在しない場合は0を返す
      todaySuspended = 0;
    }

    // 当日のロック数（account_status_events.event_type = 'locked' かつ created_atが今日）
    let todayLocked = 0;
    try {
      const todayLockedResult = dbQuery<{ count: number }>('SELECT COUNT(*) as count FROM account_status_events WHERE event_type = ? AND created_at >= ? AND created_at <= ?', ['locked', todayStart, todayEnd]);
      todayLocked = todayLockedResult[0]?.count || 0;
    } catch (e) {
      // テーブルが存在しない場合は0を返す
      todayLocked = 0;
    }

    // 当日のログイン必要数（account_status_events.event_type = 'login_required' かつ created_atが今日）
    let todayLoginRequired = 0;
    try {
      const todayLoginRequiredResult = dbQuery<{ count: number }>('SELECT COUNT(*) as count FROM account_status_events WHERE event_type = ? AND created_at >= ? AND created_at <= ?', ['login_required', todayStart, todayEnd]);
      todayLoginRequired = todayLoginRequiredResult[0]?.count || 0;
    } catch (e) {
      // テーブルが存在しない場合は0を返す
      todayLoginRequired = 0;
    }

    // 投稿ライブラリ総数/使用可能数
    let postLibraryTotal = 0;
    let postLibraryAvailable = 0;
    try {
      const postLibraryTotalResult = dbQuery<{ count: number }>('SELECT COUNT(*) as count FROM post_library', []);
      postLibraryTotal = postLibraryTotalResult[0]?.count || 0;
      // 使用可能な投稿数: used=0 AND rewritten_content IS NOT NULL AND rewritten_content != '' AND (media_paths IS NULL OR media_paths = '' OR download_status = 'completed')
      const postLibraryAvailableResult = dbQuery<{ count: number }>(
        `SELECT COUNT(*) as count FROM post_library 
         WHERE used = 0 
           AND rewritten_content IS NOT NULL 
           AND rewritten_content != '' 
           AND (media_paths IS NULL OR media_paths = '' OR download_status = 'completed')`,
        []
      );
      postLibraryAvailable = postLibraryAvailableResult[0]?.count || 0;
    } catch (e) {
      // テーブルが存在しない場合は0を返す
      postLibraryTotal = 0;
      postLibraryAvailable = 0;
    }

    res.json({
      ok: true,
      statistics: {
        accountCount,
        totalFollowers,
        totalFollowing,
        emailTotal,
        emailRemaining,
        profileTotal,
        profileRemaining,
        proxyCount,
        profileIconTotal,
        profileIconRemaining,
        headerIconTotal,
        headerIconRemaining,
        runningTasks,
        waitingTasks,
        todayCompleted,
        todayFailed,
        todaySuspended,
        todayLocked,
        todayLoginRequired,
        postLibraryTotal,
        postLibraryAvailable,
      },
    });
  } catch (e: any) {
    logger.warn({ msg: 'api.statistics.err', err: String(e?.message || e) });
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get('/api/container-groups', (req, res) => {
  try {
    ensureContainerGroupsTables();
    const rows = dbQuery<any>('SELECT id, name, description, color, created_at AS createdAt, updated_at AS updatedAt FROM container_groups ORDER BY name', []);
    res.json({ ok: true, items: rows });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

app.post('/api/container-groups', (req, res) => {
  try {
    ensureContainerGroupsTables();
    const { name, description, color } = req.body || {};
    if (!name) return res.status(400).json({ ok:false, error: 'name required' });
    const id = `g-${Date.now()}-${Math.floor(Math.random()*9999)}`;
    const now = Date.now();
    dbRun('INSERT INTO container_groups(id,name,description,color,created_at,updated_at) VALUES(?,?,?,?,?,?)', [id, String(name), String(description||''), String(color||'#cccccc'), now, now]);
    const g = { id, name: String(name), description: String(description || ''), color: String(color || '#cccccc'), createdAt: now, updatedAt: now };
    res.json({ ok:true, group: g });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

app.put('/api/container-groups/:id', (req, res) => {
  try {
    ensureContainerGroupsTables();
    const id = String(req.params.id || '');
    const { name, description, color } = req.body || {};
    if (!id) return res.status(400).json({ ok:false, error: 'id required' });
    const now = Date.now();
    dbRun('UPDATE container_groups SET name=?, description=?, color=?, updated_at=? WHERE id=?', [String(name||''), String(description||''), String(color||'#cccccc'), now, id]);
    const g = dbQuery<any>('SELECT id, name, description, color, created_at AS createdAt, updated_at AS updatedAt FROM container_groups WHERE id = ?', [id])[0] || null;
    if (!g) return res.status(404).json({ ok:false, error: 'group not found' });
    res.json({ ok:true, group: g });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

app.get('/api/container-groups/:id/members', (req, res) => {
  try {
    ensureContainerGroupsTables();
    const id = String(req.params.id || '');
    if (!id) return res.status(400).json({ ok:false, error: 'id required' });
    const rows = dbQuery<any>('SELECT COUNT(*) AS count FROM container_group_members WHERE group_id = ?', [id]);
    const count = rows[0]?.count || 0;
    res.json({ ok:true, count: Number(count) });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

app.delete('/api/container-groups/:id', (req, res) => {
  try {
    ensureContainerGroupsTables();
    const id = String(req.params.id || '');
    if (!id) return res.status(400).json({ ok:false, error: 'id required' });
    // check if group has containers assigned
    const memberRows = dbQuery<any>('SELECT COUNT(*) AS count FROM container_group_members WHERE group_id = ?', [id]);
    const memberCount = memberRows[0]?.count || 0;
    if (memberCount > 0) {
      return res.status(400).json({ ok:false, error: `このグループには ${memberCount} 個のコンテナが登録されているため削除できません` });
    }
    dbRun('DELETE FROM container_groups WHERE id = ?', [id]);
    res.json({ ok:true, removed: 1 });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

// Bulk assign containers to a group (placed before single-assign to avoid route conflict)
app.post('/api/containers/bulk/group', (req, res) => {
  try {
    ensureContainerGroupsTables();
    const { groupId, containerIds } = req.body || {};
    if (!Array.isArray(containerIds) || containerIds.length === 0) return res.status(400).json({ ok:false, error: 'containerIds required' });
    const now = Date.now();
    // Log request and insert all provided IDs (server will accept client-sent IDs)
    try { logger.event('api.container.bulk_assign.req', { groupId, containerIds }, 'info'); } catch {}
    try { memSet('lastBulkAssign', { ts: Date.now(), groupId, containerIds, headers: req.headers }); } catch(_) {}
    const tx = dbRun('BEGIN', []);
    try {
      for (const cid of containerIds) {
        dbRun('INSERT INTO container_group_members(container_id, group_id, created_at, updated_at) VALUES(?,?,?,?) ON CONFLICT(container_id) DO UPDATE SET group_id=excluded.group_id, updated_at=excluded.updated_at', [String(cid), (groupId==null)?null:String(groupId), now, now]);
        // x_accountsテーブルに移動情報を記録
        updateXAccountGroupMoveInfo(String(cid), (groupId==null)?null:String(groupId), now);
      }
      dbRun('COMMIT', []);
      try { logger.event('api.container.bulk_assign.ok', { groupId, assigned: containerIds.length }, 'info'); } catch {}
      res.json({ ok:true, assigned: containerIds.length, invalid: [], groupId: groupId || null });
    } catch (e) {
      dbRun('ROLLBACK', []);
      try { logger.event('api.container.bulk_assign.err', { err: String(e), groupId }, 'error'); } catch {}
      throw e;
    }
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

// Assign single container to group (upsert)
app.post('/api/containers/:id/group', (req, res) => {
  try {
    ensureContainerGroupsTables();
    const cid = String(req.params.id || '');
    const { groupId } = req.body || {};
    if (!cid) return res.status(400).json({ ok:false, error: 'container id required' });
    const now = Date.now();
    // use INSERT OR REPLACE to upsert based on UNIQUE(container_id)
    // Log and upsert without strict validation (accept IDs provided by client)
    try { logger.event('api.container.assign.req', { containerId: cid, groupId }, 'info'); } catch {}
    try { memSet('lastSingleAssign', { ts: Date.now(), containerId: cid, groupId, headers: req.headers }); } catch(_) {}
    
    // 移動前のグループ情報を取得（container_group_members更新前）
    const previousMembership = dbQuery<any>(
      'SELECT cgm.group_id, cg.name as group_name FROM container_group_members cgm LEFT JOIN container_groups cg ON cgm.group_id = cg.id WHERE cgm.container_id = ? LIMIT 1',
      [cid]
    )[0];
    const previousGroupName = previousMembership?.group_name || '(グループ未所属)';
    
    dbRun('INSERT INTO container_group_members(container_id, group_id, created_at, updated_at) VALUES(?,?,?,?) ON CONFLICT(container_id) DO UPDATE SET group_id=excluded.group_id, updated_at=excluded.updated_at', [cid, (groupId==null)?null:String(groupId), now, now]);
    // x_accountsテーブルに移動情報を記録
    updateXAccountGroupMoveInfo(cid, (groupId==null)?null:String(groupId), now, previousGroupName);
    try { logger.event('api.container.assign.ok', { containerId: cid, groupId }, 'info'); } catch {}
    res.json({ ok:true, id: cid, groupId: groupId == null ? null : String(groupId) });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

// Bulk assign containers to a group
app.post('/api/containers/bulk/group', (req, res) => {
  try {
    ensureContainerGroupsTables();
    const { groupId, containerIds } = req.body || {};
    if (!Array.isArray(containerIds) || containerIds.length === 0) return res.status(400).json({ ok:false, error: 'containerIds required' });
    const now = Date.now();
    // Log request and insert all provided IDs (server will accept client-sent IDs)
    try { logger.event('api.container.bulk_assign.req', { groupId, containerIds }, 'info'); } catch {}
    try { memSet('lastBulkAssign', { ts: Date.now(), groupId, containerIds, headers: req.headers }); } catch(_) {}
    const tx = dbRun('BEGIN', []);
    try {
      for (const cid of containerIds) {
        // 移動前のグループ情報を取得（container_group_members更新前）
        const previousMembership = dbQuery<any>(
          'SELECT cgm.group_id, cg.name as group_name FROM container_group_members cgm LEFT JOIN container_groups cg ON cgm.group_id = cg.id WHERE cgm.container_id = ? LIMIT 1',
          [String(cid)]
        )[0];
        const previousGroupName = previousMembership?.group_name || '(グループ未所属)';
        
        dbRun('INSERT INTO container_group_members(container_id, group_id, created_at, updated_at) VALUES(?,?,?,?) ON CONFLICT(container_id) DO UPDATE SET group_id=excluded.group_id, updated_at=excluded.updated_at', [String(cid), (groupId==null)?null:String(groupId), now, now]);
        // x_accountsテーブルに移動情報を記録
        updateXAccountGroupMoveInfo(String(cid), (groupId==null)?null:String(groupId), now, previousGroupName);
      }
      dbRun('COMMIT', []);
      try { logger.event('api.container.bulk_assign.ok', { groupId, assigned: containerIds.length }, 'info'); } catch {}
      res.json({ ok:true, assigned: containerIds.length, invalid: [], groupId: groupId || null });
    } catch (e) {
      dbRun('ROLLBACK', []);
      try { logger.event('api.container.bulk_assign.err', { err: String(e), groupId }, 'error'); } catch {}
      throw e;
    }
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

// Repair: remove or report member rows whose container_id is not present in container-db
app.post('/api/container-groups/repair-members', (req, res) => {
  try {
    ensureContainerGroupsTables();
    const dbPath = defaultContainerDb();
    const available = probeContainersFromDb(dbPath).map(x => String(x.id));
    const validSet = new Set(available);
    const rows = dbQuery<any>('SELECT id, container_id FROM container_group_members', []);
    const toRemove: any[] = [];
    for (const r of rows || []) {
      const cid = String(r.container_id || '');
      if (!validSet.has(cid)) {
        toRemove.push({ id: r.id, containerId: cid });
      }
    }
    for (const t of toRemove) {
      try { dbRun('DELETE FROM container_group_members WHERE id = ?', [t.id]); } catch (e) { /* ignore */ }
    }
    res.json({ ok:true, removed: toRemove, remainingCount: dbQuery<any>('SELECT COUNT(*) AS c FROM container_group_members', [])[0]?.c || 0 });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

// GET alias for repair (convenience)
app.get('/api/container-groups/repair-members', (req, res) => {
  try {
    ensureContainerGroupsTables();
    const dbPath = defaultContainerDb();
    const available = probeContainersFromDb(dbPath).map(x => String(x.id));
    const validSet = new Set(available);
    const rows = dbQuery<any>('SELECT id, container_id FROM container_group_members', []);
    const toRemove: any[] = [];
    for (const r of rows || []) {
      const cid = String(r.container_id || '');
      if (!validSet.has(cid)) {
        toRemove.push({ id: r.id, containerId: cid });
      }
    }
    for (const t of toRemove) {
      try { dbRun('DELETE FROM container_group_members WHERE id = ?', [t.id]); } catch (e) { /* ignore */ }
    }
    res.json({ ok:true, removed: toRemove, remainingCount: dbQuery<any>('SELECT COUNT(*) AS c FROM container_group_members', [])[0]?.c || 0 });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

// Debug: dump groups and members (for troubleshooting)
app.get('/api/_debug/container-groups-full', (req, res) => {
  try {
    ensureContainerGroupsTables();
    const groups = dbQuery<any>('SELECT id, name, description, color, created_at AS createdAt, updated_at AS updatedAt FROM container_groups ORDER BY name', []);
    const members = dbQuery<any>('SELECT id, container_id AS containerId, group_id AS groupId, created_at AS createdAt, updated_at AS updatedAt FROM container_group_members ORDER BY id DESC LIMIT 100', []);
    res.json({ ok: true, groups, members });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

// Debug: return last received assign payloads (single and bulk)
app.get('/api/_debug/last-assigns', (req, res) => {
  try {
    const single = memGet('lastSingleAssign') || null;
    const bulk = memGet('lastBulkAssign') || null;
    res.json({ ok:true, single, bulk });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

// 静的配信
app.use('/shots', express.static(path.resolve('shots'), { fallthrough: true, index: false }));
app.use('/logs', express.static(path.resolve('logs'), { fallthrough: true, index: false }));
app.use('/', express.static(path.resolve('public')));

// SSE: posts の増分通知
const clients: Array<import('express').Response> = [];
app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  clients.push(res);
  req.on('close', () => { const i = clients.indexOf(res); if (i >= 0) clients.splice(i, 1); });
});

// selectors 一覧（site 指定が必須）
app.get('/api/selectors', (req, res) => {
  const site = String(req.query.site || '');
  if (!site) return res.status(400).json({ error: 'site is required' });
  const rows = dbQuery<any>('SELECT id, site_hash, key, success_rate, updated_at, locator_json FROM selectors WHERE site_hash = ? ORDER BY success_rate DESC, updated_at DESC LIMIT 100', [site]);
  res.json(rows.map(r => ({ ...r, candidates: (()=>{ try { return JSON.parse(r.locator_json||'[]'); } catch { return []; }})() })));
});


// act: execute a planned capability
app.post('/api/act', async (req, res) => {
  try {
    const cap = String(req.body?.capability || '');
    const args = req.body?.arguments || {};
    const sid = String(req.body?.sessionId || 'default');
    logger.event('act.req', { sessionId: sid, capability: cap, args }, 'info');
    const out = await dispatch({ capability: cap, args });
    logger.event('act.res', { sessionId: sid, capability: cap, out }, 'info');
    res.json(out);
  } catch (e:any) { logger.event('act.err', { err: String(e) }, 'error'); res.status(500).json({ error: String(e) }); }
});

// Debug: get DB parameters for container
app.post('/api/debug/get-db-params', async (req, res) => {
  try {
    const containerId = String(req.body?.containerId || '');
    const containerName = String(req.body?.container_name || req.body?.containerName || '');
    
    // containerIdまたはcontainer_nameのいずれかが必要
    if (!containerId && !containerName) {
      return res.status(400).json({ ok: false, error: 'containerId or container_name is required' });
    }
    
    const dbParams: Record<string, any> = {};
    
    // containerIdまたはcontainer_nameからx_accountsテーブルを参照して各種パラメータを取得
    // x_accountsテーブルのcontainer_idはコンテナ名（XID）で保持されていることを前提とする
    // containerIdがUUID形式の場合は、コンテナブラウザのDBからコンテナ名を取得してから検索
    // container_nameが指定されている場合は、それを優先して使用（ステップ0対応）
    let xAccountContainerId = containerName.trim() || String(containerId || '');
    
    // containerIdまたはcontainer_nameが指定されている場合、処理を続行
    if (containerId || containerName) {
      try {
        // container_nameが指定されている場合は、それを優先（ステップ0対応）
        if (containerName && containerName.trim() !== '') {
          xAccountContainerId = containerName.trim();
          logger.event('debug.get-db-params.container.name_from_params', { containerName: xAccountContainerId }, 'debug');
        } else if (containerId) {
          // containerIdがUUID形式の場合、コンテナブラウザのDBからコンテナ名を取得
          const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(containerId));
          if (isUuid) {
            // UUID形式の場合、コンテナDBからコンテナ名（XID）を取得（後方互換性）
            try {
              const dbPath = defaultContainerDb();
              if (fs.existsSync(dbPath)) {
                const containerDb = new Database(dbPath, { readonly: true });
                const containerRow = containerDb.prepare('SELECT name FROM containers WHERE id = ? LIMIT 1').get(String(containerId));
                if (containerRow && containerRow.name) {
                  xAccountContainerId = String(containerRow.name);
                  logger.event('debug.get-db-params.container.name_resolved_from_uuid', { containerId, containerName: xAccountContainerId }, 'debug');
                }
                containerDb.close();
              }
            } catch (e: any) {
              logger.event('debug.get-db-params.container.name_resolve_err', { containerId, err: String(e?.message || e) }, 'warn');
            }
          } else {
            // UUID形式でない場合、コンテナ名（XID）として扱う
            xAccountContainerId = String(containerId);
          }
        }
        
        // コンテナ名でx_accountsテーブルを検索
        // xAccountContainerIdが空の場合は検索をスキップ
        let xAccount: any = null;
        if (xAccountContainerId && xAccountContainerId.trim() !== '') {
          xAccount = dbQuery<any>('SELECT x_password, email, email_password, auth_token, ct0, totp_secret, twofa_code, proxy_id, profile_name, profile_bio, profile_location, profile_website, profile_avatar_image_path, profile_banner_image_path FROM x_accounts WHERE container_id = ? LIMIT 1', [xAccountContainerId])[0];
        }
        
        // コンテナ名で見つからない場合、UUID形式のcontainerIdでも検索を試みる（後方互換性）
        if (!xAccount && containerId) {
          const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(containerId));
          if (isUuid && String(containerId) !== xAccountContainerId) {
            logger.event('debug.get-db-params.x_account.query.try_uuid', { containerId, xAccountContainerId }, 'debug');
            xAccount = dbQuery<any>('SELECT x_password, email, email_password, auth_token, ct0, totp_secret, twofa_code, proxy_id, profile_name, profile_bio, profile_location, profile_website, profile_avatar_image_path, profile_banner_image_path FROM x_accounts WHERE container_id = ? LIMIT 1', [String(containerId)])[0];
            if (xAccount) {
              logger.event('debug.get-db-params.x_account.found_by_uuid', { containerId }, 'info');
            }
          }
        }
        if (xAccount) {
          // db_x_password: x_accounts.x_passwordから取得
          if (xAccount.x_password) {
            dbParams.db_x_password = String(xAccount.x_password);
            logger.event('debug.get-db-params.db_x_password.loaded', { containerId, hasPassword: !!dbParams.db_x_password }, 'debug');
          } else {
            logger.event('debug.get-db-params.db_x_password.not_found', { containerId }, 'warn');
          }
          
          // db_email: x_accounts.emailから取得
          if (xAccount.email) {
            dbParams.db_email = String(xAccount.email);
            logger.event('debug.get-db-params.db_email.loaded', { containerId, hasEmail: !!dbParams.db_email }, 'debug');
          } else {
            logger.event('debug.get-db-params.db_email.not_found', { containerId }, 'warn');
          }
          
          // db_email_credential: x_accounts.email_passwordが既にemail:password形式の場合はそのまま使用
          // そうでない場合は、emailとemail_passwordを組み合わせる
          if (xAccount.email_password) {
            const emailPasswordStr = String(xAccount.email_password);
            // email:password形式かどうかを確認（:が含まれているか）
            if (emailPasswordStr.includes(':')) {
              // 既にemail:password形式なのでそのまま使用
              dbParams.db_email_credential = emailPasswordStr;
              logger.event('debug.get-db-params.db_email_credential.loaded', { containerId, source: 'email_password_field', hasCredential: !!dbParams.db_email_credential }, 'debug');
            } else if (xAccount.email) {
              // email:password形式ではない場合、emailとemail_passwordを組み合わせる
              dbParams.db_email_credential = `${String(xAccount.email)}:${emailPasswordStr}`;
              logger.event('debug.get-db-params.db_email_credential.loaded', { containerId, source: 'combined', hasCredential: !!dbParams.db_email_credential }, 'debug');
            } else {
              logger.event('debug.get-db-params.db_email_credential.not_found', { containerId, hasEmail: false, hasEmailPassword: true }, 'warn');
            }
          } else {
            logger.event('debug.get-db-params.db_email_credential.not_found', { containerId, hasEmail: !!xAccount.email, hasEmailPassword: false }, 'warn');
          }
          
          // db_new_email: x_accounts.emailから取得（新しいメールアドレスとして使用）
          if (xAccount.email) {
            dbParams.db_new_email = String(xAccount.email);
            logger.event('debug.get-db-params.db_new_email.loaded', { containerId, containerName: xAccountContainerId, email: dbParams.db_new_email }, 'debug');
          } else {
            logger.event('debug.get-db-params.db_new_email.not_found', { containerId, containerName: xAccountContainerId, xAccountExists: true }, 'warn');
          }
          
          // プロフィールデータを取得（プリセット18用）
          // db_profile_name: x_accounts.profile_nameから取得
          if (xAccount.profile_name !== null && xAccount.profile_name !== undefined) {
            dbParams.db_profile_name = String(xAccount.profile_name);
            logger.event('debug.get-db-params.db_profile_name.loaded', { containerId, containerName: xAccountContainerId, hasValue: !!dbParams.db_profile_name }, 'debug');
          }
          
          // db_profile_bio: x_accounts.profile_bioから取得
          if (xAccount.profile_bio !== null && xAccount.profile_bio !== undefined) {
            dbParams.db_profile_bio = String(xAccount.profile_bio);
            logger.event('debug.get-db-params.db_profile_bio.loaded', { containerId, containerName: xAccountContainerId, hasValue: !!dbParams.db_profile_bio }, 'debug');
          }
          
          // db_profile_location: x_accounts.profile_locationから取得（空文字列も有効）
          if (xAccount.profile_location !== null && xAccount.profile_location !== undefined) {
            dbParams.db_profile_location = String(xAccount.profile_location);
            logger.event('debug.get-db-params.db_profile_location.loaded', { containerId, containerName: xAccountContainerId, hasValue: true }, 'debug');
          }
          
          // db_profile_website: x_accounts.profile_websiteから取得（空文字列も有効）
          if (xAccount.profile_website !== null && xAccount.profile_website !== undefined) {
            dbParams.db_profile_website = String(xAccount.profile_website);
            logger.event('debug.get-db-params.db_profile_website.loaded', { containerId, containerName: xAccountContainerId, hasValue: true }, 'debug');
          }
          
          // db_profile_avatar_image_path: x_accounts.profile_avatar_image_pathから取得
          if (xAccount.profile_avatar_image_path !== null && xAccount.profile_avatar_image_path !== undefined) {
            dbParams.db_profile_avatar_image_path = String(xAccount.profile_avatar_image_path);
            logger.event('debug.get-db-params.db_profile_avatar_image_path.loaded', { containerId, containerName: xAccountContainerId, hasValue: !!dbParams.db_profile_avatar_image_path }, 'debug');
          }
          
          // db_profile_banner_image_path: x_accounts.profile_banner_image_pathから取得
          if (xAccount.profile_banner_image_path !== null && xAccount.profile_banner_image_path !== undefined) {
            dbParams.db_profile_banner_image_path = String(xAccount.profile_banner_image_path);
            logger.event('debug.get-db-params.db_profile_banner_image_path.loaded', { containerId, containerName: xAccountContainerId, hasValue: !!dbParams.db_profile_banner_image_path }, 'debug');
          }
          
          // db_auth_token: x_accounts.auth_tokenから取得
          if (xAccount.auth_token) {
            dbParams.db_auth_token = String(xAccount.auth_token);
            logger.event('debug.get-db-params.db_auth_token.loaded', { containerId, containerName: xAccountContainerId, hasValue: !!dbParams.db_auth_token }, 'debug');
          } else {
            logger.event('debug.get-db-params.db_auth_token.not_found', { containerId, containerName: xAccountContainerId, xAccountExists: true }, 'warn');
          }
          
          // db_ct0: x_accounts.ct0から取得
          if (xAccount.ct0) {
            dbParams.db_ct0 = String(xAccount.ct0);
            logger.event('debug.get-db-params.db_ct0.loaded', { containerId, containerName: xAccountContainerId, hasValue: !!dbParams.db_ct0 }, 'debug');
          } else {
            logger.event('debug.get-db-params.db_ct0.not_found', { containerId, containerName: xAccountContainerId, xAccountExists: true }, 'warn');
          }
          
          // db_totp_secret: x_accounts.totp_secretから取得
          if (xAccount.totp_secret) {
            dbParams.db_totp_secret = String(xAccount.totp_secret);
            logger.event('debug.get-db-params.db_totp_secret.loaded', { containerId, containerName: xAccountContainerId, hasValue: !!dbParams.db_totp_secret }, 'debug');
          } else {
            logger.event('debug.get-db-params.db_totp_secret.not_found', { containerId, containerName: xAccountContainerId, xAccountExists: true }, 'warn');
          }
          
          // db_twofa_code: x_accounts.twofa_codeから取得（TOTPシークレットキー）
          if (xAccount.twofa_code && String(xAccount.twofa_code).trim() !== '') {
            dbParams.db_twofa_code = String(xAccount.twofa_code).trim();
            logger.event('debug.get-db-params.db_twofa_code.loaded', { containerId, containerName: xAccountContainerId, hasValue: !!dbParams.db_twofa_code }, 'debug');
          } else {
            logger.event('debug.get-db-params.db_twofa_code.not_found', { containerId, containerName: xAccountContainerId, xAccountExists: true }, 'warn');
          }
          
          // db_proxy: x_accounts.proxy_idから取得（proxiesテーブルを参照）
          if (xAccount.proxy_id) {
            try {
              const proxyInfo = dbQuery<any>(
                'SELECT proxy_info FROM proxies WHERE id = ? LIMIT 1',
                [xAccount.proxy_id]
              )[0];
              
              if (proxyInfo && proxyInfo.proxy_info) {
                dbParams.db_proxy = String(proxyInfo.proxy_info);
                logger.event('debug.get-db-params.db_proxy.loaded', { containerId, containerName: xAccountContainerId, proxyId: xAccount.proxy_id, hasProxy: !!dbParams.db_proxy }, 'debug');
              } else {
                logger.event('debug.get-db-params.db_proxy.not_found', { containerId, containerName: xAccountContainerId, proxyId: xAccount.proxy_id }, 'warn');
              }
            } catch (e: any) {
              logger.event('debug.get-db-params.db_proxy.load_err', { containerId, containerName: xAccountContainerId, proxyId: xAccount.proxy_id, err: String(e?.message || e) }, 'warn');
            }
          } else {
            logger.event('debug.get-db-params.db_proxy.no_proxy_id', { containerId, containerName: xAccountContainerId, xAccountExists: true }, 'debug');
          }
        } else {
          logger.event('debug.get-db-params.x_account.not_found', { containerId }, 'warn');
        }
      } catch (e: any) {
        logger.event('debug.get-db-params.db_params.load_err', { containerId, err: String(e?.message || e) }, 'warn');
      }
    }
    
    logger.event('debug.get-db-params.success', { containerId, paramsCount: Object.keys(dbParams).length, params: Object.keys(dbParams) }, 'info');
    return res.json({ ok: true, params: dbParams });
  } catch (e: any) {
    logger.event('debug.get-db-params.err', { err: String(e?.message || e) }, 'error');
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Debug: get HTML from container
app.post('/api/debug/get-html', async (req, res) => {
  try {
    const containerId = String(req.body?.containerId || '');
    if (!containerId) {
      return res.status(400).json({ ok: false, error: 'containerId is required' });
    }
    logger.event('debug.get-html.req', { containerId }, 'info');
    const result = await getPageHtml(containerId, true);
    if (!result.ok) {
      logger.event('debug.get-html.err', { 
        containerId, 
        error: result.error,
        hasHtml: !!result.html 
      }, 'error');
      return res.status(500).json({ ok: false, error: result.error || 'HTML取得に失敗しました' });
    }
    if (!result.html) {
      logger.event('debug.get-html.noHtml', { containerId }, 'error');
      return res.status(500).json({ ok: false, error: 'HTMLが取得できませんでした' });
    }
    logger.event('debug.get-html.ok', { containerId, htmlLength: result.html.length }, 'info');
    res.json({ ok: true, html: result.html });
  } catch (e:any) {
    logger.event('debug.get-html.exception', { 
      err: String(e),
      stack: e?.stack?.substring(0, 200)
    }, 'error');
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Register completed task from debug mode
app.post('/api/debug/register-completed-task', async (req, res) => {
  try {
    const { presetId, containerId, overrides, startTime, endTime, stepResults, status, debugLogs } = req.body || {};
    
    // バリデーション
    if (!presetId || !Number.isFinite(Number(presetId))) {
      return res.status(400).json({ ok: false, error: 'presetId is required' });
    }
    if (!containerId || String(containerId).trim() === '') {
      return res.status(400).json({ ok: false, error: 'containerId is required' });
    }
    if (!startTime || !Number.isFinite(Number(startTime))) {
      return res.status(400).json({ ok: false, error: 'startTime is required' });
    }
    if (!endTime || !Number.isFinite(Number(endTime))) {
      return res.status(400).json({ ok: false, error: 'endTime is required' });
    }
    
    const presetIdNum = Number(presetId);
    const containerIdStr = String(containerId).trim();
    const startTimeNum = Number(startTime);
    const endTimeNum = Number(endTime);
    // ステータスを正規化: 'completed'は'ok'に変換（UIで成功として認識されるように）
    let finalStatus = String(status || 'completed');
    if (finalStatus === 'completed' || finalStatus === 'success') {
      finalStatus = 'ok';
    }
    
    // runIdを生成
    const runId = `debug-${presetIdNum}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const now = Date.now();
    
    // コンテナのグループIDを取得（オプション）
    let groupId: string | null = null;
    try {
      const groupRow = dbQuery<any>(
        'SELECT group_id FROM container_group_members WHERE container_id = ? LIMIT 1',
        [containerIdStr]
      )[0];
      if (groupRow && groupRow.group_id) {
        groupId = String(groupRow.group_id);
      }
    } catch (e) {
      // グループIDの取得に失敗しても続行
      logger.event('debug.register-task.group_id.err', { containerId: containerIdStr, err: String(e) }, 'debug');
    }
    
    // overrides_jsonを構築
    const overridesJson = overrides && typeof overrides === 'object' ? JSON.stringify(overrides) : '{}';
    
    // tasksテーブルにレコードを作成
    let taskId: number | null = null;
    try {
      dbRun(
        'INSERT INTO tasks(runId, preset_id, container_id, overrides_json, scheduled_at, status, created_at, updated_at, group_id, wait_minutes, queue_name) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        [
          runId,
          presetIdNum,
          containerIdStr,
          overridesJson,
          startTimeNum,
          'done',
          now,
          now,
          groupId,
          0,
          'default'
        ]
      );
      
      // 作成されたタスクのIDを取得
      const taskRow = dbQuery<any>('SELECT id FROM tasks WHERE runId = ? LIMIT 1', [runId])[0];
      if (taskRow && taskRow.id) {
        taskId = Number(taskRow.id);
      }
      
      logger.event('debug.register-task.task_created', {
        runId,
        taskId,
        presetId: presetIdNum,
        containerId: containerIdStr,
        groupId,
      }, 'info');
    } catch (e: any) {
      logger.event('debug.register-task.task_create.err', {
        runId,
        presetId: presetIdNum,
        containerId: containerIdStr,
        err: String(e?.message || e),
      }, 'error');
      return res.status(500).json({ ok: false, error: 'タスクの作成に失敗しました: ' + String(e?.message || e) });
    }
    
    // runLog形式のresult_jsonを構築
    const runLog: any = {
      start: new Date(startTimeNum).toISOString(),
      end: new Date(endTimeNum).toISOString(),
      ok: finalStatus === 'ok' || finalStatus === 'completed',
      steps: (stepResults || []).map((sr: any) => ({
        index: sr.index,
        step: sr.step,
        result: sr.result || { ok: sr.ok !== false },
      })),
    };
    
    // デバッグログがある場合は追加情報として含める
    if (debugLogs && Array.isArray(debugLogs)) {
      runLog.debugLogs = debugLogs;
    }
    
    // task_runsテーブルにレコードを作成
    try {
      dbRun(
        'INSERT INTO task_runs(runId, task_id, started_at, ended_at, status, result_json) VALUES(?,?,?,?,?,?)',
        [
          runId,
          taskId,
          startTimeNum,
          endTimeNum,
          finalStatus,
          JSON.stringify(runLog),
        ]
      );
      
      logger.event('debug.register-task.task_run_created', {
        runId,
        taskId,
        status: finalStatus,
        startTime: startTimeNum,
        endTime: endTimeNum,
      }, 'info');
    } catch (e: any) {
      logger.event('debug.register-task.task_run_create.err', {
        runId,
        taskId,
        err: String(e?.message || e),
      }, 'error');
      // task_runsの作成に失敗した場合でも、tasksテーブルのレコードは作成済みなので続行
      // ただし、エラーを返す
      return res.status(500).json({ ok: false, error: '実行ログの作成に失敗しました: ' + String(e?.message || e) });
    }
    
    res.json({
      ok: true,
      runId,
      taskId,
      message: '実行済タスクとして登録しました',
    });
  } catch (e: any) {
    logger.event('debug.register-task.exception', {
      err: String(e),
      stack: e?.stack?.substring(0, 200),
    }, 'error');
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Email: fetch verification code from email
app.post('/api/email/fetch-code', async (req, res) => {
  try {
    const { email, email_password, subject_pattern, code_pattern, timeout_seconds, from_pattern } = req.body || {};
    
    // バリデーション
    if (!email || String(email).trim() === '') {
      return res.status(400).json({ ok: false, error: 'email is required' });
    }
    if (!email_password || String(email_password).trim() === '') {
      return res.status(400).json({ ok: false, error: 'email_password is required' });
    }
    
    logger.event('api.email.fetch-code.req', { 
      email: String(email).substring(0, 20) + '...',
      hasPassword: !!email_password,
      subject_pattern,
      code_pattern,
      timeout_seconds
    }, 'info');
    
    const startTime = Date.now();
    
    // fetchVerificationCode関数をインポート
    const { fetchVerificationCode } = await import('../services/emailFetcher.js');
    
    // メールから確認コードを取得
    const result = await fetchVerificationCode({
      email: String(email).trim(),
      email_password: String(email_password).trim(),
      subject_pattern: subject_pattern || 'verification|確認コード|code|confirm|メールアドレスを確認',
      code_pattern: code_pattern || '\\d{6}',
      timeout_seconds: timeout_seconds || 60,
      from_pattern: from_pattern || undefined
    });
    
    const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);
    
    if (result.ok && result.code) {
      logger.event('api.email.fetch-code.success', { 
        email: String(email).substring(0, 20) + '...',
        codeLength: result.code.length,
        elapsed_seconds: elapsedSeconds
      }, 'info');
      res.json({ 
        ok: true, 
        code: result.code,
        message: result.message || '確認コードを取得しました',
        elapsed_seconds: elapsedSeconds,
        received_at: result.received_at
      });
    } else {
      logger.event('api.email.fetch-code.failure', { 
        email: String(email).substring(0, 20) + '...',
        error: result.error,
        elapsed_seconds: elapsedSeconds
      }, 'warn');
      res.status(400).json({ 
        ok: false, 
        error: result.error || 'UNKNOWN_ERROR',
        message: result.message || 'メールから確認コードを取得できませんでした',
        elapsed_seconds: elapsedSeconds
      });
    }
  } catch (e: any) {
    const elapsedSeconds = Math.round((Date.now() - (req as any).__startTime || Date.now()) / 1000);
    logger.event('api.email.fetch-code.exception', { 
      err: String(e?.message || e),
      stack: e?.stack?.substring(0, 200),
      elapsed_seconds: elapsedSeconds
    }, 'error');
    res.status(500).json({ 
      ok: false, 
      error: 'EXCEPTION',
      message: `メール取得処理中にエラーが発生しました: ${String(e?.message || e)}`,
      elapsed_seconds: elapsedSeconds
    });
  }
});

// Email: get unused email account from DB and mark as used
app.post('/api/email/get-unused-and-mark-used', async (req, res) => {
  try {
    logger.event('api.email.get-unused-and-mark-used.req', {}, 'info');
    
    // 未使用のメールアカウントを取得（最も古いものから）
    const availableEmails = dbQuery<{
      id: number;
      email_password: string;
      added_at: number;
      used_at: number | null;
    }>(
      'SELECT * FROM email_accounts WHERE used_at IS NULL ORDER BY added_at ASC LIMIT 1',
      []
    );

    if (!availableEmails || availableEmails.length === 0) {
      logger.event('api.email.get-unused-and-mark-used.not_found', {}, 'warn');
      return res.status(404).json({ 
        ok: false, 
        error: 'NOT_FOUND',
        message: '未使用のメールアドレスが見つかりませんでした'
      });
    }

    const emailAccount = availableEmails[0];
    
    // email:password形式を分割
    const parts = String(emailAccount.email_password).split(':');
    if (parts.length < 2) {
      logger.event('api.email.get-unused-and-mark-used.invalid_format', { 
        id: emailAccount.id,
        email_password_preview: String(emailAccount.email_password).substring(0, 50)
      }, 'error');
      return res.status(500).json({ 
        ok: false, 
        error: 'INVALID_FORMAT',
        message: `メールアドレスの形式が不正です: ${String(emailAccount.email_password).substring(0, 50)}...`
      });
    }

    const email = parts[0].trim();
    const password = parts.slice(1).join(':'); // パスワードにコロンが含まれる場合に対応

    // email_accountsテーブルのused_atを更新（使用済みにマーク）
    const now = Date.now();
    dbRun(
      'UPDATE email_accounts SET used_at = ? WHERE id = ?',
      [now, emailAccount.id]
    );

    logger.event('api.email.get-unused-and-mark-used.success', { 
      id: emailAccount.id,
      email: email.substring(0, 20) + '...',
      added_at: emailAccount.added_at,
      used_at: now
    }, 'info');

    res.json({ 
      ok: true, 
      id: emailAccount.id,
      email: email,
      password: password,
      email_password: emailAccount.email_password, // 元の形式も返す
      added_at: emailAccount.added_at,
      used_at: now,
      message: 'メールアドレスを取得して使用済みにマークしました'
    });
  } catch (e: any) {
    logger.event('api.email.get-unused-and-mark-used.exception', { 
      err: String(e?.message || e),
      stack: e?.stack?.substring(0, 200)
    }, 'error');
    res.status(500).json({ 
      ok: false, 
      error: 'EXCEPTION',
      message: `メールアドレス取得処理中にエラーが発生しました: ${String(e?.message || e)}`
    });
  }
});

// Profiles scanning/import endpoints
app.get('/api/profiles/scan', async (req, res) => {
  const dir = String(req.query.dir || '');
  if (!dir) return res.status(400).json({ error: 'dir is required' });
  const items = await scanContainers(dir);
  res.json({ ok:true, items });
});

app.get('/api/profiles/companion-dbs', async (req, res) => {
  const root = String(req.query.root || '');
  if (!root) return res.status(400).json({ error: 'root is required' });
  const items = await findCompanionDbs(root);
  res.json({ ok:true, items });
});

app.get('/api/profiles/inspect-db', async (req, res) => {
  const dbp = String(req.query.db || '');
  if (!dbp) return res.status(400).json({ error: 'db is required' });
  const out = await inspectDbSchema(dbp);
  res.json({ ok:true, out });
});

app.post('/api/profiles/import', (req, res) => {
  const items = req.body?.items || [];
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'items required' });
  const { added, skipped } = importAccounts(items.map((i:any)=>({ name: i.name, dir: i.dir })));
  res.json({ ok:true, added, skipped });
});

// Proxy endpoints for export API
app.post('/api/export/restore', async (req, res) => {
  try {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ ok:false, error: 'id required' });
    logger.event('export.restore.start', { id }, 'info');
    try {
      logger.event('export.restore.check', { hasExportFunc: typeof exportRestored !== 'undefined' }, 'info');
    } catch (e) { logger.event('export.restore.check.err', { err: String(e) }, 'error'); }
    if (typeof exportRestored !== 'function') {
      logger.event('export.restore.err', { err: 'exportRestored not available' }, 'error');
      return res.status(500).json({ ok:false, error: 'exportRestored not available' });
    }
    logger.event('export.restore.call', { id }, 'info');
    try {
      // dynamic import to avoid any static resolution issues
      const mod = await import('../services/exportedProfiles');
      logger.event('export.restore.modloaded', { id, hasExport: typeof mod.exportRestored === 'function' }, 'info');
      if (typeof mod.exportRestored !== 'function') throw new Error('exportRestored not exported');
      const out = await mod.exportRestored(id, false);
    logger.event('export.restore.ok', { id, path: out.path, lastSessionId: out.lastSessionId || null, hasToken: !!out.token }, 'info');
    res.json({ ok:true, path: out.path, lastSessionId: out.lastSessionId || null, token: out.token || null });
    } catch (ie:any) {
      logger.event('export.restore.err', { err: String(ie), id }, 'error');
      return res.status(500).json({ ok:false, error: String(ie?.message||ie) });
    }
  } catch (e:any) { logger.event('export.restore.err', { err: String(e) }, 'error'); res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

app.post('/api/export/delete', async (req, res) => {
  try {
    const { path: p } = req.body || {};
    if (!p) return res.status(400).json({ ok:false, error: 'path required' });
    const out = await deleteExported(p);
    res.json(out);
  } catch (e:any) { logger.event('export.delete.err', { err: String(e) }, 'error'); res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

// Launch exported profile with local Electron executable
app.post('/api/export/launch-electron', async (req, res) => {
  try {
    const { path: profilePath, exePath } = req.body || {};
    if (!profilePath) return res.status(400).json({ ok:false, error: 'path required' });
    const exe = exePath || process.env.CONTAINER_BROWSER_EXE;
    if (!exe || !fs.existsSync(exe)) return res.status(400).json({ ok:false, error: 'electron exe not found; provide exePath or set CONTAINER_BROWSER_EXE' });
    // spawn electron with userDataDir
    const args = [`--user-data-dir=${profilePath}`];
    const child = child_process.spawn(exe, args, { detached: false, stdio: 'ignore' });
    // store handle
    spawnedMap.set(child.pid, child);
    // do not wait
    child.unref?.();
    logger.event('export.launch.electron', { pid: child.pid, exe, profilePath }, 'info');
    res.json({ ok:true, pid: child.pid });
  } catch (e:any) { logger.event('export.launch.err', { err: String(e) }, 'error'); res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

app.post('/api/export/kill-process', async (req, res) => {
  try {
    const { pid } = req.body || {};
    if (!pid) return res.status(400).json({ ok:false, error: 'pid required' });
    try {
      const cp = spawnedMap.get(Number(pid));
      if (cp && !cp.killed) cp.kill();
      try { process.kill(Number(pid)); } catch {}
      spawnedMap.delete(Number(pid));
      logger.event('export.kill', { pid }, 'info');
      res.json({ ok:true });
    } catch (e:any) { throw e; }
  } catch (e:any) { logger.event('export.kill.err', { err: String(e) }, 'error'); res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

// Proxy to execute commands on container-browser (click/type/navigate/eval)
app.post('/api/container/exec', async (req, res) => {
  try {
    const body = req.body || {};
    const { contextId, command } = body;
    if (!contextId || !command) return res.status(400).json({ ok:false, error: 'contextId and command are required' });
    // Reduce noisy logs: only emit request log at debug level; errors remain logged as 'error'
    logger.event('container.exec.req', { contextId, command }, 'debug');
    const { host, port } = getContainerBrowserConfig();
    const url = `http://${host}:${port}/internal/exec`;
    const timeoutMs = Number(process.env.CONTAINER_EXEC_TIMEOUT_MS || 60000);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      clearTimeout(timeoutId);
      const j = await resp.json().catch(()=>({ ok:false, error: 'invalid-json' }));
      if (!resp.ok) {
        logger.event('container.exec.err', { contextId, command, status: resp.status, err: j?.error || 'remote error' }, 'error');
        return res.status(resp.status).json(j);
      }
      // Reduce noisy response logs: mark as debug to avoid flooding info-level logs.
      logger.event('container.exec.res', { contextId, command, ok: !!j.ok }, 'debug');
      // mask any sensitive fields in result if present
      if (j && j.cookies) {
        j.cookies = j.cookies.map((c:any)=> ({ name: c.name, domain: c.domain, path: c.path }));
      }
      res.json(j);
    } catch (e:any) {
      clearTimeout(timeoutId);
      if (e.name === 'AbortError') {
        logger.event('container.exec.err', { contextId, command, err: 'Request timeout' }, 'error');
        return res.status(504).json({ ok:false, error: 'Request timeout' });
      }
      logger.event('container.exec.err', { err: String(e) }, 'error');
      res.status(500).json({ ok:false, error: String(e?.message||e) });
    }
  } catch (e:any) {
    logger.event('container.exec.err', { err: String(e) }, 'error');
    res.status(500).json({ ok:false, error: String(e?.message||e) });
  }
});

// Preset CRUD
app.get('/api/presets', (req, res) => {
  try {
    // debug: log which DB path the server thinks it's using (for troubleshooting)
    try { logger.event('api.presets.req', { dbPath: path.resolve('storage', 'app.db') }, 'info'); } catch {}
    const orderBy = (req.query && typeof (req.query as any).orderBy === 'string') ? String((req.query as any).orderBy) : undefined;
    const dir = (req.query && typeof (req.query as any).dir === 'string') ? String((req.query as any).dir) : undefined;
    const items = PresetService.listPresets({
      orderBy: (orderBy === 'id' || orderBy === 'name' || orderBy === 'created_at' || orderBy === 'updated_at') ? orderBy : undefined,
      dir: (dir === 'asc' || dir === 'desc') ? dir : undefined
    });
    try {
      logger.event('api.presets.res', { count: Array.isArray(items) ? items.length : 0, sample: (Array.isArray(items) ? items.slice(0,3).map((p:any)=>({ id: p.id, name: p.name })) : []) }, 'info');
    } catch (e) { /* ignore logging error */ }
    res.json({ ok: true, count: items.length, items });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

app.get('/api/presets/:id/has-container-step', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok:false, error: 'preset id required' });
    const hasContainerStep = PresetService.presetHasContainerStep(id);
    res.json({ ok: true, presetId: id, hasContainerStep });
  } catch (e:any) {
    logger.event('api.presets.has_container_step.err', { err: String(e?.message||e) }, 'error');
    res.status(500).json({ ok:false, error: String(e?.message||e) });
  }
});

// Helper: Validate preset steps
function validatePresetSteps(steps: any): { ok: boolean; error?: string } {
  if (!Array.isArray(steps)) {
    return { ok: false, error: 'steps must be an array' };
  }
  if (steps.length === 0) {
    return { ok: false, error: 'steps array cannot be empty' };
  }
  // Check each step has a type field
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step || typeof step !== 'object') {
      return { ok: false, error: `step ${i} must be an object` };
    }
    if (!step.type || typeof step.type !== 'string') {
      return { ok: false, error: `step ${i} must have a type field (string)` };
    }
    
    // Recursively validate inner steps for 'for' loops
    if (step.type === 'for' && Array.isArray(step.steps)) {
      const innerValidation = validatePresetSteps(step.steps);
      if (!innerValidation.ok) {
        return { 
          ok: false, 
          error: `step ${i} (for loop inner step): ${innerValidation.error}` 
        };
      }
    }
  }
  return { ok: true };
}

app.post('/api/presets', (req, res) => {
  try {
    const { name, description, steps } = req.body || {};
    if (!name || typeof name !== 'string') return res.status(400).json({ ok:false, error: 'name (string) is required' });
    if (!steps) return res.status(400).json({ ok:false, error: 'steps is required' });
    
    // Validate steps structure
    const stepsValidation = validatePresetSteps(steps);
    if (!stepsValidation.ok) {
      return res.status(400).json({ ok:false, error: stepsValidation.error });
    }
    
    const sjson = JSON.stringify(steps);
    const out = PresetService.createPreset(name, description||'', sjson);
    res.json({ ok: true, id: out.id });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

app.put('/api/presets/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, description, steps, use_post_library } = req.body || {};
    if (!id) return res.status(400).json({ ok:false, error: 'id (number) required' });
    if (!name || typeof name !== 'string') return res.status(400).json({ ok:false, error: 'name (string) is required' });
    if (!steps) return res.status(400).json({ ok:false, error: 'steps is required' });
    
    // Validate steps structure
    const stepsValidation = validatePresetSteps(steps);
    if (!stepsValidation.ok) {
      return res.status(400).json({ ok:false, error: stepsValidation.error });
    }
    
    const usePostLib = use_post_library ? 1 : 0;
    PresetService.updatePreset(id, name, description||'', JSON.stringify(steps), usePostLib);
    res.json({ ok: true });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

app.delete('/api/presets/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok:false, error: 'id required' });
    PresetService.deletePreset(id);
    res.json({ ok: true });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

// Run preset (sequential execution)
app.post('/api/presets/:id/run', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { accountName } = req.body || {};
    if (!id) return res.status(400).json({ ok:false, error: 'id required' });
    const preset = PresetService.getPreset(id) as any;
    if (!preset) return res.status(404).json({ ok:false, error: 'preset not found' });
    const { steps, defaultTimeoutSeconds } = parsePresetStepsJson(preset.steps_json || '[]');
    // sequentially execute via container-browser internal exec
    const { host, port } = getContainerBrowserConfig();
    for (let i=0;i<steps.length;i++) {
      const st = steps[i];
      const cmdPayload: any = { contextId: accountName || st.contextId || preset.id, command: st.type };
      if (st.type === 'navigate') cmdPayload.url = st.url;
      if (st.type === 'click' || st.type === 'type') cmdPayload.selector = st.selector;
      if (st.type === 'type') cmdPayload.text = st.text;
      const options = Object.assign({}, (st.options && typeof st.options === 'object') ? st.options : {});
      options.timeoutMs = resolveStepTimeoutMs(st, defaultTimeoutSeconds);
      cmdPayload.options = options;
      const url = `http://${host}:${port}/internal/exec`;
      const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cmdPayload) });
      const j = await resp.json().catch(()=>({ ok:false, error:'invalid-json' }));
      const stepResult = (j && j.result && typeof j.result === 'object') ? j.result : null;
      const didAction = stepResult && typeof stepResult.didAction === 'boolean' ? stepResult.didAction : undefined;
      const actionStopped = typeof didAction === 'boolean' && didAction === false;
      const ok = !!j.ok;
      const okFlag = ok && !actionStopped;
      const runError = actionStopped ? (stepResult?.reason || 'didAction:false') : (j.error || 'error');
      PresetService.recordJobRun(null, id, i, JSON.stringify(st), okFlag, j, okFlag ? null : runError, j && j.elapsedMs ? j.elapsedMs : 0);
      if (st.expected) {
        const exp = st.expected;
        // Normalize actual URL locations: prefer stepResult.url, then top-level j.url,
        // then nested commandResult/result.url if present. This avoids false negatives
        // when different exec implementations place the URL in different fields.
        let actualUrl = '';
        try {
          if (stepResult && typeof stepResult === 'object' && stepResult.url) {
            actualUrl = String(stepResult.url);
          } else if (j && j.url) {
            actualUrl = String(j.url);
          } else if (j && j.commandResult && j.commandResult.result && j.commandResult.result.url) {
            actualUrl = String(j.commandResult.result.url);
          } else if (j && j.result && j.result.url) {
            actualUrl = String(j.result.url);
          }
        } catch (e) {
          actualUrl = String(j && j.url ? j.url : '');
        }

        // navigateコマンドでURLが空文字列またはabout:blankの場合、postWaitSecondsの待機後にevalでURLを取得
        if (st.type === 'navigate' && (!actualUrl || actualUrl.trim() === '' || actualUrl === 'about:blank') && st.postWaitSeconds && typeof st.postWaitSeconds === 'number' && st.postWaitSeconds > 0) {
          try {
            // postWaitSecondsの待機
            await new Promise(r => setTimeout(r, Math.round(st.postWaitSeconds * 1000)));
            
            // evalコマンドでwindow.location.hrefを取得
            const evalResp = await fetch(`http://${host}:${port}/internal/exec`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contextId: accountName || st.contextId || preset.id,
                command: 'eval',
                eval: 'window.location.href'
              }),
            });
            const evalData = await evalResp.json().catch(() => null);
            
            // evalの結果からURLを取得
            if (evalData && evalData.ok) {
              const evalResult = evalData.result || evalData.body?.result || evalData.body;
              if (typeof evalResult === 'string' && evalResult.trim() !== '') {
                actualUrl = String(evalResult);
                try { logger.event('expected.url.retrieved_after_wait', { expected: String(exp.urlContains || ''), actual: actualUrl, postWaitSeconds: st.postWaitSeconds }, 'debug'); } catch (e) {}
              }
            }
          } catch (e: any) {
            try { logger.event('expected.url.retrieve_after_wait.err', { err: String(e?.message || e) }, 'warn'); } catch (e2) {}
          }
        }

        if (exp.urlContains) {
          try {
            logger.event('expected.url.check', { expected: String(exp.urlContains), actual: actualUrl }, 'debug');
          } catch (e) { /* ignore logging errors */ }
          if (!String(actualUrl).includes(String(exp.urlContains))) {
            return res.status(500).json({ ok:false, error: 'expected url not matched', got: actualUrl || (j && j.url) || null, expected: String(exp.urlContains) });
          }
        }
        if (exp.htmlContains && !(j.html||'').includes(exp.htmlContains)) {
          return res.status(500).json({ ok:false, error: 'expected html not matched' });
        }
      }
      if (!okFlag) {
        if (actionStopped) {
          return res.status(409).json({
            ok: false,
            error: 'step action stopped',
            status: 'stopped',
            reason: runError,
            stepIndex: i,
            result: j,
          });
        }
        return res.status(500).json({ ok:false, error: j.error || 'step failed', stepIndex: i, result: j });
      }
    }
    res.json({ ok:true });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

app.post('/api/presets/:id/debug-step', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok:false, error: 'id required' });
    const { containerId, stepIndex, overrides, params } = req.body || {};
    // containerIdが空の場合、params.container_nameが設定されている場合は許可（ステップ0対応）
    if (!containerId && !(params?.container_name || params?.containerName)) {
      return res.status(400).json({ ok:false, error: 'containerId or container_name is required' });
    }
    const preset = PresetService.getPreset(id) as any;
    if (!preset) return res.status(404).json({ ok:false, error: 'preset not found' });
    const parsedPreset = parsePresetStepsJson(preset.steps_json || '[]');
    // 根本解決: 常にデータベースから読み込んだプリセットのステップを使用（result_varを含む完全なステップ定義を保証）
    const effectiveSteps = parsedPreset.steps;
    const { defaultTimeoutSeconds } = parsedPreset;
    const idx = Number(stepIndex);
    const innerStepIdx = typeof req.body.innerStepIndex === 'number' ? Number(req.body.innerStepIndex) : (typeof req.body.innerStepIndex === 'string' ? Number(req.body.innerStepIndex) : null);
    
    let st: any;
    let isInnerStep = false;
    
    // 内部ステップの実行の場合
    if (innerStepIdx !== null && innerStepIdx !== undefined) {
      if (!Number.isFinite(idx) || idx < 0 || idx >= effectiveSteps.length) {
        return res.status(400).json({ ok:false, error: 'invalid stepIndex for for step' });
      }
      const forStep = effectiveSteps[idx];
      if (!forStep || forStep.type !== 'for' || !Array.isArray(forStep.steps)) {
        return res.status(400).json({ ok:false, error: 'step is not a for step', stepIndex: idx });
      }
      if (!Number.isFinite(innerStepIdx) || innerStepIdx < 0 || innerStepIdx >= forStep.steps.length) {
        return res.status(400).json({ ok:false, error: 'invalid innerStepIndex', stepIndex: idx, innerStepIndex: innerStepIdx });
      }
      const innerStep = forStep.steps[innerStepIdx];
      if (!innerStep) {
        return res.status(400).json({ ok:false, error: 'inner step not found', stepIndex: idx, innerStepIndex: innerStepIdx });
      }
      
      // 内部ステップをstとして設定
      st = innerStep;
      isInnerStep = true;
    } else {
      // 通常のステップ処理
      if (!Number.isFinite(idx) || idx < 0 || idx >= effectiveSteps.length) {
        return res.status(400).json({ ok:false, error: 'invalid stepIndex' });
      }
      st = effectiveSteps[idx];
      if (!st) return res.status(400).json({ ok:false, error: 'step not found' });
    }
    const { host, port } = getContainerBrowserConfig();
    const templateVars: Record<string, any> = {};
    const mergeVars = (source: any) => {
      if (source && typeof source === 'object') {
        Object.keys(source).forEach((key) => {
          templateVars[key] = source[key];
        });
      }
    };
    // paramsからは非DBパラメータと空でない値のみマージ（proxy/two_factor_code等のDBから取得するパラメータは除外）
    if (params && typeof params === 'object') {
      Object.keys(params).forEach((key) => {
        // DBから取得するパラメータは除外（proxy、two_factor_codeなど）
        const dbRetrievedParams = ['proxy', 'two_factor_code'];
        if (!dbRetrievedParams.includes(key)) {
          templateVars[key] = params[key];
        }
      });
    }
    if (overrides && typeof overrides === 'object') {
      mergeVars(overrides.vars);
      mergeVars(overrides.params);
      mergeVars(overrides.payload);
      if (!Object.keys(templateVars).length) {
        mergeVars(overrides);
      }
    }
    // db_*パラメータは常にDBから取得（overrides/paramsの値は無視）
    // 前のコンテナのデータが残らないように、既存のdb_パラメータを削除
    // ただし、params（リクエスト側で明示的に渡された値）のpr_パラメータは保持する
    // （例：前のステップ（fetch_email）で取得した pr_verification_code を保持する必要がある）
    const prVarsFromParams: Record<string, any> = {};
    if (params && typeof params === 'object') {
      Object.keys(params).forEach((key) => {
        if (key.startsWith('pr_')) {
          prVarsFromParams[key] = params[key];
        }
      });
    }
    // overrides/paramsから渡された古いdb_*パラメータを削除（DB取得処理の前に実行）
    // これにより、DBから取得した値が正しく設定される
    Object.keys(templateVars).forEach((key) => {
      if (key.startsWith('db_')) {
        delete templateVars[key];
      }
    });
    // containerIdからx_accountsテーブルを参照して各種パラメータを取得
    // x_accountsテーブルのcontainer_idはコンテナ名（XID）で保持されていることを前提とする
    // containerIdがUUID形式の場合は、コンテナブラウザのDBからコンテナ名を取得してから検索
    // ステップ0（コンテナ作成）の場合は、params.container_nameから取得を試みる
    let xAccountContainerId = String(containerId || '');
    let containerUuidForApi: string | null = null;
    
    // params.container_nameを優先的に取得（コンテナ作成ステップ対応）
    const containerNameFromParams = params?.container_name || params?.containerName;
    const hasContainerNameFromParams = containerNameFromParams && String(containerNameFromParams).trim() !== '';
    
    // params.container_nameが設定されている場合は、それを優先（コンテナ作成ステップ対応）
    if (hasContainerNameFromParams) {
      xAccountContainerId = String(containerNameFromParams).trim();
      logger.event('debug.container.name_from_params_priority', { presetId: id, stepIndex: idx, containerName: xAccountContainerId, containerId }, 'debug');
    } else if (!xAccountContainerId || xAccountContainerId.trim() === '') {
      // params.container_nameが設定されていない場合のみ、containerIdから取得を試みる
      const containerNameFromParamsFallback = params?.container_name || params?.containerName;
      if (containerNameFromParamsFallback && String(containerNameFromParamsFallback).trim() !== '') {
        xAccountContainerId = String(containerNameFromParamsFallback).trim();
        logger.event('debug.container.name_from_params', { presetId: id, stepIndex: idx, containerName: xAccountContainerId }, 'debug');
      }
    }
    
    // containerIdまたはxAccountContainerIdが設定されている場合、またはparams.container_nameが設定されている場合は処理を続行
    if (containerId || xAccountContainerId || params?.container_name || params?.containerName) {
      try {
        // params.container_nameが設定されている場合は、UUID解決をスキップ（params.container_nameを優先）
        if (!hasContainerNameFromParams && containerId) {
          // containerIdがUUID形式の場合、コンテナブラウザのDBからコンテナ名を取得
          const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(containerId));
          if (isUuid) {
            // UUID形式の場合、コンテナDBからコンテナ名（XID）を取得（後方互換性）
            try {
              const dbPath = defaultContainerDb();
              if (fs.existsSync(dbPath)) {
                const containerDb = new Database(dbPath, { readonly: true });
                const containerRow = containerDb.prepare('SELECT name FROM containers WHERE id = ? LIMIT 1').get(String(containerId));
                if (containerRow && containerRow.name) {
                  xAccountContainerId = String(containerRow.name);
                  containerUuidForApi = String(containerId); // UUID形式の場合はそのまま使用
                  logger.event('debug.container.name_resolved_from_uuid', { presetId: id, stepIndex: idx, containerId, containerName: xAccountContainerId }, 'debug');
                }
                containerDb.close();
              }
            } catch (e: any) {
              logger.event('debug.container.name_resolve_err', { presetId: id, stepIndex: idx, containerId, err: String(e?.message || e) }, 'warn');
            }
          } else {
            // UUID形式でない場合、コンテナ名（XID）として扱う
            // containerIdが空でない場合のみ上書き（params.container_nameから取得した値を保護）
            if (containerId && String(containerId).trim() !== '') {
              xAccountContainerId = String(containerId);
            }
          }
        }
        
        // コンテナ名からコンテナID（UUID）を取得（params.container_nameが設定されている場合も実行）
        if (xAccountContainerId) {
          containerUuidForApi = getContainerIdFromName(xAccountContainerId);
          if (containerUuidForApi) {
            logger.event('debug.container.uuid_resolved_from_name', { presetId: id, stepIndex: idx, containerName: xAccountContainerId, containerUuid: containerUuidForApi }, 'debug');
          } else {
            logger.event('debug.container.uuid_not_found', { presetId: id, stepIndex: idx, containerName: xAccountContainerId }, 'warn');
            // UUIDが見つからない場合でも、コンテナ名のまま処理を続行（後方互換性）
          }
        }
        
        // db_container_nameを設定（コンテナ名を取得済みの場合）
        if (xAccountContainerId) {
          templateVars.db_container_name = xAccountContainerId;
          logger.event('debug.db_container_name.set', { presetId: id, stepIndex: idx, containerId, containerName: xAccountContainerId }, 'debug');
        }
        
        // xAccountContainerIdが空の場合、params.container_nameから再取得を試みる
        if (!xAccountContainerId || xAccountContainerId.trim() === '') {
          const containerNameFromParams = params?.container_name || params?.containerName;
          if (containerNameFromParams && String(containerNameFromParams).trim() !== '') {
            xAccountContainerId = String(containerNameFromParams).trim();
            logger.event('debug.container.name_from_params_retry', { presetId: id, stepIndex: idx, containerName: xAccountContainerId }, 'debug');
          }
        }
        
        // デバッグ用: 検索に使用するcontainer_idをログに出力
        const isUuidForLog = containerId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(containerId));
        logger.event('debug.x_account.query.before', { presetId: id, stepIndex: idx, containerId, xAccountContainerId, isUuid: isUuidForLog, willSearchWith: xAccountContainerId }, 'debug');
        
        // container_idで検索（コンテナ名で検索）
        // xAccountContainerIdが空の場合は検索をスキップ
        let xAccount: any = null;
        if (xAccountContainerId && xAccountContainerId.trim() !== '') {
          xAccount = dbQuery<any>('SELECT x_password, email, email_password, auth_token, ct0, totp_secret, twofa_code, proxy_id, profile_name, profile_bio, profile_location, profile_website, profile_avatar_image_path, profile_banner_image_path FROM x_accounts WHERE container_id = ? LIMIT 1', [xAccountContainerId])[0];
        }
        
        // コンテナ名で見つからなかった場合、UUID形式のcontainerIdでも検索を試みる（後方互換性）
        // params.container_nameが設定されている場合は、UUID検索をスキップ（params.container_nameを優先）
        if (!xAccount && !hasContainerNameFromParams && containerId && isUuidForLog && String(containerId) !== xAccountContainerId) {
          logger.event('debug.x_account.query.try_uuid', { presetId: id, stepIndex: idx, containerId, xAccountContainerId }, 'debug');
          xAccount = dbQuery<any>('SELECT x_password, email, email_password, auth_token, ct0, totp_secret, twofa_code, proxy_id, profile_name, profile_bio, profile_location, profile_website, profile_avatar_image_path, profile_banner_image_path FROM x_accounts WHERE container_id = ? LIMIT 1', [String(containerId)])[0];
          if (xAccount) {
            logger.event('debug.x_account.found_by_uuid', { presetId: id, stepIndex: idx, containerId }, 'info');
          }
        }
        
        // デバッグ用: 検索結果をログに出力
        logger.event('debug.x_account.query.after', { presetId: id, stepIndex: idx, containerId, xAccountContainerId, found: !!xAccount, hasXPassword: !!(xAccount?.x_password), hasEmail: !!(xAccount?.email), hasEmailPassword: !!(xAccount?.email_password) }, xAccount ? 'debug' : 'warn');
        if (xAccount) {
          // db_x_password: x_accounts.x_passwordから取得
          if (xAccount.x_password) {
            templateVars.db_x_password = String(xAccount.x_password);
            logger.event('debug.db_x_password.loaded', { presetId: id, stepIndex: idx, containerId, containerName: xAccountContainerId, hasPassword: !!templateVars.db_x_password }, 'debug');
          } else {
            logger.event('debug.db_x_password.not_found', { presetId: id, stepIndex: idx, containerId, containerName: xAccountContainerId, xAccountExists: true }, 'warn');
          }
          
          // db_email: x_accounts.emailから取得
          if (xAccount.email) {
            templateVars.db_email = String(xAccount.email);
            logger.event('debug.db_email.loaded', { presetId: id, stepIndex: idx, containerId, containerName: xAccountContainerId, hasEmail: !!templateVars.db_email }, 'debug');
          } else {
            logger.event('debug.db_email.not_found', { presetId: id, stepIndex: idx, containerId, containerName: xAccountContainerId, xAccountExists: true }, 'warn');
          }
          
          // db_email_credential: x_accounts.email_passwordが既にemail:password形式の場合はそのまま使用
          // そうでない場合は、emailとemail_passwordを組み合わせる
          if (xAccount.email_password) {
            const emailPasswordStr = String(xAccount.email_password);
            // email:password形式かどうかを確認（:が含まれているか）
            if (emailPasswordStr.includes(':')) {
              // 既にemail:password形式なのでそのまま使用
              templateVars.db_email_credential = emailPasswordStr;
              logger.event('debug.db_email_credential.loaded', { presetId: id, stepIndex: idx, containerId, containerName: xAccountContainerId, source: 'email_password_field', hasCredential: !!templateVars.db_email_credential }, 'debug');
            } else if (xAccount.email) {
              // email:password形式ではない場合、emailとemail_passwordを組み合わせる
              templateVars.db_email_credential = `${String(xAccount.email)}:${emailPasswordStr}`;
              logger.event('debug.db_email_credential.loaded', { presetId: id, stepIndex: idx, containerId, containerName: xAccountContainerId, source: 'combined', hasCredential: !!templateVars.db_email_credential }, 'debug');
            } else {
              logger.event('debug.db_email_credential.not_found', { presetId: id, stepIndex: idx, containerId, containerName: xAccountContainerId, hasEmail: false, hasEmailPassword: true, xAccountExists: true }, 'warn');
            }
          } else {
            logger.event('debug.db_email_credential.not_found', { presetId: id, stepIndex: idx, containerId, containerName: xAccountContainerId, hasEmail: !!xAccount.email, hasEmailPassword: false, xAccountExists: true }, 'warn');
          }
          
          // db_new_email: x_accounts.emailから取得（新しいメールアドレスとして使用）
          if (xAccount.email) {
            templateVars.db_new_email = String(xAccount.email);
            logger.event('debug.db_new_email.loaded', { presetId: id, stepIndex: idx, containerId, containerName: xAccountContainerId, email: templateVars.db_new_email }, 'debug');
          } else {
            logger.event('debug.db_new_email.not_found', { presetId: id, stepIndex: idx, containerId, containerName: xAccountContainerId, xAccountExists: true }, 'warn');
          }
          
          // プロフィールデータを取得（プリセット18用）
          // db_profile_name: x_accounts.profile_nameから取得
          if (xAccount.profile_name !== null && xAccount.profile_name !== undefined) {
            templateVars.db_profile_name = String(xAccount.profile_name);
            logger.event('debug.db_profile_name.loaded', { presetId: id, stepIndex: idx, containerId, containerName: xAccountContainerId, hasValue: !!templateVars.db_profile_name }, 'debug');
          }
          
          // db_profile_bio: x_accounts.profile_bioから取得
          if (xAccount.profile_bio !== null && xAccount.profile_bio !== undefined) {
            templateVars.db_profile_bio = String(xAccount.profile_bio);
            logger.event('debug.db_profile_bio.loaded', { presetId: id, stepIndex: idx, containerId, containerName: xAccountContainerId, hasValue: !!templateVars.db_profile_bio }, 'debug');
          }
          
          // db_profile_location: x_accounts.profile_locationから取得（空文字列も有効）
          if (xAccount.profile_location !== null && xAccount.profile_location !== undefined) {
            templateVars.db_profile_location = String(xAccount.profile_location);
            logger.event('debug.db_profile_location.loaded', { presetId: id, stepIndex: idx, containerId, containerName: xAccountContainerId, hasValue: true }, 'debug');
          }
          
          // db_profile_website: x_accounts.profile_websiteから取得（空文字列も有効）
          if (xAccount.profile_website !== null && xAccount.profile_website !== undefined) {
            templateVars.db_profile_website = String(xAccount.profile_website);
            logger.event('debug.db_profile_website.loaded', { presetId: id, stepIndex: idx, containerId, containerName: xAccountContainerId, hasValue: true }, 'debug');
          }
          
          // db_profile_avatar_image_path: x_accounts.profile_avatar_image_pathから取得
          if (xAccount.profile_avatar_image_path !== null && xAccount.profile_avatar_image_path !== undefined) {
            templateVars.db_profile_avatar_image_path = String(xAccount.profile_avatar_image_path);
            logger.event('debug.db_profile_avatar_image_path.loaded', { presetId: id, stepIndex: idx, containerId, containerName: xAccountContainerId, hasValue: !!templateVars.db_profile_avatar_image_path }, 'debug');
          }
          
          // db_profile_banner_image_path: x_accounts.profile_banner_image_pathから取得
          if (xAccount.profile_banner_image_path !== null && xAccount.profile_banner_image_path !== undefined) {
            templateVars.db_profile_banner_image_path = String(xAccount.profile_banner_image_path);
            logger.event('debug.db_profile_banner_image_path.loaded', { presetId: id, stepIndex: idx, containerId, containerName: xAccountContainerId, hasValue: !!templateVars.db_profile_banner_image_path }, 'debug');
          }
          
          // db_auth_token: x_accounts.auth_tokenから取得
          if (xAccount.auth_token) {
            templateVars.db_auth_token = String(xAccount.auth_token);
            logger.event('debug.db_auth_token.loaded', { presetId: id, stepIndex: idx, containerId, containerName: xAccountContainerId, hasValue: !!templateVars.db_auth_token }, 'debug');
          } else {
            logger.event('debug.db_auth_token.not_found', { presetId: id, stepIndex: idx, containerId, containerName: xAccountContainerId, xAccountExists: true }, 'warn');
          }
          
          // db_ct0: x_accounts.ct0から取得
          if (xAccount.ct0) {
            templateVars.db_ct0 = String(xAccount.ct0);
            logger.event('debug.db_ct0.loaded', { presetId: id, stepIndex: idx, containerId, containerName: xAccountContainerId, hasValue: !!templateVars.db_ct0 }, 'debug');
          } else {
            logger.event('debug.db_ct0.not_found', { presetId: id, stepIndex: idx, containerId, containerName: xAccountContainerId, xAccountExists: true }, 'warn');
          }
          
          // db_totp_secret: x_accounts.totp_secretから取得
          if (xAccount.totp_secret) {
            templateVars.db_totp_secret = String(xAccount.totp_secret);
            logger.event('debug.db_totp_secret.loaded', { presetId: id, stepIndex: idx, containerId, containerName: xAccountContainerId, hasValue: !!templateVars.db_totp_secret }, 'debug');
          } else {
            logger.event('debug.db_totp_secret.not_found', { presetId: id, stepIndex: idx, containerId, containerName: xAccountContainerId, xAccountExists: true }, 'warn');
          }
          
          // db_twofa_code: x_accounts.twofa_codeから取得（TOTPシークレットキー）
          if (xAccount.twofa_code && String(xAccount.twofa_code).trim() !== '') {
            templateVars.db_twofa_code = String(xAccount.twofa_code).trim();
            logger.event('debug.db_twofa_code.loaded', { presetId: id, stepIndex: idx, containerId, containerName: xAccountContainerId, hasValue: !!templateVars.db_twofa_code }, 'debug');
          } else {
            logger.event('debug.db_twofa_code.not_found', { presetId: id, stepIndex: idx, containerId, containerName: xAccountContainerId, xAccountExists: true }, 'warn');
          }
          
          // db_proxy: x_accounts.proxy_idから取得（proxiesテーブルを参照）
          if (xAccount.proxy_id) {
            try {
              const proxyInfo = dbQuery<any>(
                'SELECT proxy_info FROM proxies WHERE id = ? LIMIT 1',
                [xAccount.proxy_id]
              )[0];
              
              if (proxyInfo && proxyInfo.proxy_info) {
                templateVars.db_proxy = String(proxyInfo.proxy_info);
                logger.event('debug.db_proxy.loaded', { presetId: id, stepIndex: idx, containerId, containerName: xAccountContainerId, proxyId: xAccount.proxy_id, hasProxy: !!templateVars.db_proxy }, 'debug');
              } else {
                logger.event('debug.db_proxy.not_found', { presetId: id, stepIndex: idx, containerId, containerName: xAccountContainerId, proxyId: xAccount.proxy_id }, 'warn');
              }
            } catch (e: any) {
              logger.event('debug.db_proxy.load_err', { presetId: id, stepIndex: idx, containerId, containerName: xAccountContainerId, proxyId: xAccount.proxy_id, err: String(e?.message || e) }, 'warn');
            }
          } else {
            logger.event('debug.db_proxy.no_proxy_id', { presetId: id, stepIndex: idx, containerId, containerName: xAccountContainerId, xAccountExists: true }, 'debug');
          }
        } else {
          logger.event('debug.x_account.not_found', { presetId: id, stepIndex: idx, containerId, containerName: xAccountContainerId, searchKey: xAccountContainerId }, 'warn');
        }
      } catch (e: any) {
        logger.event('debug.db_params.load_err', { presetId: id, stepIndex: idx, containerId, err: String(e?.message || e) }, 'warn');
      }
    }
    
    // db_post_content, db_post_media_paths: post_library_idが指定されている場合、post_libraryテーブルから取得
    // params, overrides, templateVarsの順で取得を試みる
    // パラメータ名の正規化: post_library_id（スネークケース）と postLibraryId（キャメルケース）の両方に対応
    const postLibraryIdRaw = params?.post_library_id || params?.postLibraryId || overrides?.post_library_id || overrides?.postLibraryId || templateVars?.pr_post_library_id || templateVars?.post_library_id || templateVars?.postLibraryId;
    // 空文字列を除外（空文字列はfalsyだが、明示的にチェック）
    const hasPostLibraryId = postLibraryIdRaw && String(postLibraryIdRaw).trim() !== '';
    if (hasPostLibraryId) {
      try {
        const postLibraryId = Number(postLibraryIdRaw);
        if (!isNaN(postLibraryId) && postLibraryId > 0) {
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
          
          if (postRecord) {
            // db_post_content: post_library.rewritten_contentから取得
            templateVars.db_post_content = postRecord.rewritten_content;
            templateVars.pr_post_library_id = postRecord.id;
            logger.event('debug.db_post_content.loaded', { presetId: id, stepIndex: idx, postLibraryId, hasContent: !!templateVars.db_post_content }, 'debug');
            
            // db_post_media_paths: post_library.media_pathsから取得（カンマ区切りを配列に変換）
            if (postRecord.media_paths && String(postRecord.media_paths).trim() !== '') {
              const mediaPaths = String(postRecord.media_paths).split(',').map((p: string) => p.trim()).filter((p: string) => p);
              templateVars.db_post_media_paths = mediaPaths;
              logger.event('debug.db_post_media_paths.loaded', { presetId: id, stepIndex: idx, postLibraryId, mediaCount: mediaPaths.length }, 'debug');
            } else {
              templateVars.db_post_media_paths = [];
              logger.event('debug.db_post_media_paths.empty', { presetId: id, stepIndex: idx, postLibraryId }, 'debug');
            }
          } else {
            logger.event('debug.db_post_content.not_found', { presetId: id, stepIndex: idx, postLibraryId, reason: 'record not found or invalid' }, 'warn');
          }
        } else {
          logger.event('debug.db_post_content.invalid_id', { presetId: id, stepIndex: idx, postLibraryIdRaw }, 'warn');
        }
      } catch (e: any) {
        logger.event('debug.db_post_content.load_err', { presetId: id, stepIndex: idx, err: String(e?.message || e) }, 'warn');
      }
    } else {
      // post_library_idが未指定の場合、プリセットのuse_post_libraryフラグを確認して未使用の投稿を自動取得
      // または、ステップのコードに{{db_post_content}}が含まれている場合も自動取得
      const usePostLibrary = preset.use_post_library === 1 || preset.use_post_library === true;
      const stepCode = st.code || st.eval || '';
      const needsDbPostContent = typeof stepCode === 'string' && stepCode.includes('{{db_post_content}}');
      const shouldAutoLoad = usePostLibrary || needsDbPostContent;
      
      logger.event('debug.db_post_content.auto_check', { 
        presetId: id, 
        stepIndex: idx, 
        usePostLibrary, 
        use_post_library: preset.use_post_library, 
        hasPostLibraryId: false,
        needsDbPostContent,
        shouldAutoLoad
      }, 'debug');
      
      if (shouldAutoLoad) {
        try {
          const postRecord = dbQuery<any>(
            `SELECT id, rewritten_content, media_paths, used, download_status 
             FROM post_library 
             WHERE rewritten_content IS NOT NULL 
               AND rewritten_content != '' 
               AND (media_paths IS NULL OR media_paths = '' OR download_status = 'completed')
               AND used = 0 
             ORDER BY created_at ASC 
             LIMIT 1`
          )[0];
          
          if (postRecord) {
            // db_post_content: post_library.rewritten_contentから取得
            templateVars.db_post_content = postRecord.rewritten_content;
            templateVars.pr_post_library_id = postRecord.id;
            logger.event('debug.db_post_content.loaded_auto', { presetId: id, stepIndex: idx, postLibraryId: postRecord.id, hasContent: !!templateVars.db_post_content, reason: usePostLibrary ? 'use_post_library flag' : 'db_post_content used in step' }, 'debug');
            
            // db_post_media_paths: post_library.media_pathsから取得（カンマ区切りを配列に変換）
            if (postRecord.media_paths && String(postRecord.media_paths).trim() !== '') {
              const mediaPaths = String(postRecord.media_paths).split(',').map((p: string) => p.trim()).filter((p: string) => p);
              templateVars.db_post_media_paths = mediaPaths;
              logger.event('debug.db_post_media_paths.loaded_auto', { presetId: id, stepIndex: idx, postLibraryId: postRecord.id, mediaCount: mediaPaths.length }, 'debug');
            } else {
              templateVars.db_post_media_paths = [];
              logger.event('debug.db_post_media_paths.empty_auto', { presetId: id, stepIndex: idx, postLibraryId: postRecord.id }, 'debug');
            }
          } else {
            logger.event('debug.db_post_content.not_found_auto', { presetId: id, stepIndex: idx, reason: 'no unused post found' }, 'warn');
          }
        } catch (e: any) {
          logger.event('debug.db_post_content.load_auto_err', { presetId: id, stepIndex: idx, err: String(e?.message || e) }, 'warn');
        }
      } else {
        logger.event('debug.db_post_content.auto_skip', { presetId: id, stepIndex: idx, reason: 'use_post_library is false and db_post_content not used in step' }, 'debug');
      }
    }
    
    // params から取得した pr_* 変数を復元（DB取得処理の後）
    // DB取得処理で設定されたdb_*パラメータは保持される
    Object.keys(prVarsFromParams).forEach((key) => {
      templateVars[key] = prVarsFromParams[key];
    });
    
    let templateVarsFinal = Object.keys(templateVars).length ? templateVars : {};
    
    // リクエストボディからgatheredVarsを取得してtemplateVarsFinalに反映
    const gatheredVarsFromRequest = req.body?.gatheredVars || req.body?.templateVars || null;
    if (gatheredVarsFromRequest && typeof gatheredVarsFromRequest === 'object') {
      templateVarsFinal = { ...templateVarsFinal, ...gatheredVarsFromRequest };
    }
    
    // paramsからもtemplateVarsFinalに反映（デバッグモードでフロントエンドが保持している場合）
    // ただし、db_で始まるパラメータは上書きしない（DBから取得した値が優先）
    // pr_* 変数は1510-1526行で保存済みなので、ここで復元する
    // undefined 値は除外（テンプレート変数として使用しない）
    if (params && typeof params === 'object') {
      const paramsFiltered: Record<string, any> = {};
      Object.keys(params).forEach((key) => {
        if (!key.startsWith('db_') && !key.startsWith('pr_')) {
          let value = params[key];
          // undefined や null は除外、空文字列は許可（クリア用）
          if (value !== undefined && value !== null) {
            // "undefined" という文字列が入っている場合は空文字列に変換
            if (String(value) === 'undefined') {
              value = '';
            }
            paramsFiltered[key] = value;
          }
        }
      });
      templateVarsFinal = { ...templateVarsFinal, ...paramsFiltered };
      
      // 1510-1526行で保存した pr_* 変数をtemplateVarsFinalに復元（重要）
      if (prVarsFromParams && Object.keys(prVarsFromParams).length) {
        Object.keys(prVarsFromParams).forEach((key) => {
          templateVarsFinal[key] = prVarsFromParams[key];
        });
      }
      
      // paramsにpost_library_idが含まれている場合、再度データ取得を試みる（params反映後に実行）
      // パラメータ名の正規化: post_library_id（スネークケース）と postLibraryId（キャメルケース）の両方に対応
      const paramsPostLibraryId = params.post_library_id || params.postLibraryId || params.pr_post_library_id;
      const hasParamsPostLibraryId = paramsPostLibraryId && String(paramsPostLibraryId).trim() !== '';
      if (hasParamsPostLibraryId && !templateVarsFinal.db_post_content) {
        try {
          const postLibraryId = Number(paramsPostLibraryId);
          if (!isNaN(postLibraryId) && postLibraryId > 0) {
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
            
            if (postRecord) {
              templateVarsFinal.db_post_content = postRecord.rewritten_content;
              templateVarsFinal.pr_post_library_id = postRecord.id;
              if (postRecord.media_paths && String(postRecord.media_paths).trim() !== '') {
                const mediaPaths = String(postRecord.media_paths).split(',').map((p: string) => p.trim()).filter((p: string) => p);
                templateVarsFinal.db_post_media_paths = mediaPaths;
              } else {
                templateVarsFinal.db_post_media_paths = [];
              }
              logger.event('debug.db_post_content.loaded_from_params', { presetId: id, stepIndex: idx, postLibraryId, hasContent: !!templateVarsFinal.db_post_content }, 'debug');
            }
          }
        } catch (e: any) {
          logger.event('debug.db_post_content.load_from_params_err', { presetId: id, stepIndex: idx, err: String(e?.message || e) }, 'warn');
        }
      } else if (!hasParamsPostLibraryId && !templateVarsFinal.db_post_content) {
        // paramsにpost_library_idが未指定で、templateVarsFinal.db_post_contentも未設定の場合、自動取得を試みる
        const usePostLibrary = preset.use_post_library === 1 || preset.use_post_library === true;
        const stepCode = st.code || st.eval || '';
        const needsDbPostContent = typeof stepCode === 'string' && stepCode.includes('{{db_post_content}}');
        const shouldAutoLoad = usePostLibrary || needsDbPostContent;
        
        if (shouldAutoLoad) {
          try {
            const postRecord = dbQuery<any>(
              `SELECT id, rewritten_content, media_paths, used, download_status 
               FROM post_library 
               WHERE rewritten_content IS NOT NULL 
                 AND rewritten_content != '' 
                 AND (media_paths IS NULL OR media_paths = '' OR download_status = 'completed')
                 AND used = 0 
               ORDER BY created_at ASC 
               LIMIT 1`
            )[0];
            
            if (postRecord) {
              templateVarsFinal.db_post_content = postRecord.rewritten_content;
              templateVarsFinal.pr_post_library_id = postRecord.id;
              if (postRecord.media_paths && String(postRecord.media_paths).trim() !== '') {
                const mediaPaths = String(postRecord.media_paths).split(',').map((p: string) => p.trim()).filter((p: string) => p);
                templateVarsFinal.db_post_media_paths = mediaPaths;
              } else {
                templateVarsFinal.db_post_media_paths = [];
              }
              logger.event('debug.db_post_content.loaded_auto_from_params', { presetId: id, stepIndex: idx, postLibraryId: postRecord.id, hasContent: !!templateVarsFinal.db_post_content, reason: usePostLibrary ? 'use_post_library flag' : 'db_post_content used in step' }, 'debug');
            }
          } catch (e: any) {
            logger.event('debug.db_post_content.load_auto_from_params_err', { presetId: id, stepIndex: idx, err: String(e?.message || e) }, 'warn');
          }
        }
      }
    }
    
    // 投稿ライブラリ未使用でも for/items 等で db_post_media_paths を参照する場合に「template variables missing」を防ぐ
    if (templateVarsFinal.db_post_media_paths === undefined) templateVarsFinal.db_post_media_paths = [];
    if (templateVarsFinal.db_post_content === undefined) templateVarsFinal.db_post_content = '';

    // 内部ステップの場合はループ変数を追加
    if (innerStepIdx !== null && innerStepIdx !== undefined) {
      templateVarsFinal.loop_index = 0;
      templateVarsFinal.loop_count = 1;
    }
    
    // 2FAコード入力ステップの直前でTOTPコードを生成（デバッグモード）
    // ステップのdescriptionまたはevalコードに「2FA」や「pr_authentication_code」「pr_totp_code」が含まれている場合
    const currentStepType = (st && (st.type || st.command || st.action)) ? (st.type || st.command || st.action) : null;
    const isEvalStep = currentStepType === 'eval';
    const descHas2FA = st.description && (
      String(st.description).includes('2FA') || 
      String(st.description).includes('two factor') ||
      String(st.description).includes('two-factor')
    );
    const codeHasTotpVar = (st.code || st.eval || '').toString().includes('pr_totp_code');
    const codeHasAuthVar = (st.code || st.eval || '').toString().includes('pr_authentication_code');
    const isTwoFactorStep = isEvalStep && (descHas2FA || codeHasTotpVar || codeHasAuthVar);
    
    // テンプレートVarsから db_twofa_code を取得
    const tofaSecret = templateVarsFinal.db_twofa_code || templateVars.db_twofa_code;
    if (isTwoFactorStep && tofaSecret && typeof tofaSecret === 'string' && tofaSecret.trim() !== '') {
      try {
        const { generateTOTPCode } = await import('../services/totpGenerator');
        const totpCode = generateTOTPCode(tofaSecret);
        templateVarsFinal.pr_authentication_code = totpCode;
        templateVarsFinal.pr_totp_code = totpCode;
        logger.event('debug.totp_code.generated_before_2fa_step', {
          presetId: id,
          stepIndex: idx,
          innerStepIndex: innerStepIdx,
          codeLength: totpCode.length
        }, 'info');
      } catch (e: any) {
        logger.event('debug.totp_code.generation_failed', {
          presetId: id,
          stepIndex: idx,
          innerStepIndex: innerStepIdx,
          err: String(e?.message || e)
        }, 'warn');
      }
    }
    
    logger.event('debug.template_vars', { presetId: id, stepIndex: idx, innerStepIndex: innerStepIdx, templateVars: templateVarsFinal, hasParams: !!params, hasOverrides: !!overrides }, 'debug');
    
    // コンテナ名取得ステップ（パラメータ検出用）を検出
    const isContainerNameStep = (st.description && st.description.includes('コンテナ名を取得')) ||
                                 (st.code && String(st.code).includes('コンテナ名') && String(st.code).includes('パラメータ検出'));
    
    // コンテナ指定ステップかどうかを先に確認
    const stepType = (st && (st.type || st.command || st.action)) ? (st.type || st.command || st.action) : null;
    const isContainerStep = stepType === 'container' || stepType === 'open_container';
    
    // コンテナ名が指定されている場合の処理
    // ただし、コンテナ名取得ステップやコンテナ指定ステップの場合はスキップ
    // また、コンテナ指定ステップの後続ステップでは、コンテナ名ではなくcontainerIdを優先使用
    let actualContainerId = containerId;
    const containerName = templateVarsFinal?.container_name || overrides?.container_name || params?.container_name;
    if (containerName && String(containerName).trim() !== '' && !isContainerNameStep && !isContainerStep) {
      // コンテナ名が指定されているが、コンテナ指定ステップの後続ステップの場合は、
      // コンテナ名で開こうとせず、既に開いているコンテナ（containerId）を使用
      // ただし、containerIdが指定されていない場合は、コンテナ名で開く
      if (containerId && String(containerId).trim() !== '') {
        // containerIdが指定されている場合は、それを優先使用
        actualContainerId = containerId;
        logger.event('debug.container.use_existing', { containerId: actualContainerId, containerName }, 'info');
      } else {
        // containerIdが指定されていない場合は、コンテナ名で開く
        actualContainerId = String(containerName);
        logger.event('debug.container.open', { containerName: actualContainerId, originalContainerId: containerId }, 'info');
        
        // プロキシ設定を取得（DBから取得したdb_proxyのみを使用）
        const proxyRaw = templateVarsFinal?.db_proxy;
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
        
        // コンテナは最初のnavigateステップで自動的に開かれるため、ここではIDを設定するだけ
        logger.event('debug.container.id_set', { containerId: actualContainerId }, 'info');
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
        // undefined 値または "undefined" 文字列は空文字列に変換
        if (value === undefined || valueStr === 'undefined') {
          return '';
        }
        // 空文字列も有効な値として保存（locationやwebsiteのクリアなど）
        // 空文字列をそのまま返す（このままDB に保存される）
        if (valueStr === '') {
          return '';
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
      // 空文字列の場合はエラーを投げない（|| 演算子でデフォルト値が使用される）
      // ただし、完全に未定義（varsに存在しない）場合はエラーを投げる
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
      
      // post-process: 結果文字列内の 'undefined' を '' に置換（スキップロジック対応）
      let result = out;
      if (allowEmpty) {
        // allowEmpty=true の場合は 'undefined' リテラルを空文字列に置換
        result = result.replace(/'undefined'/g, "''");
      }
      return result;
    }
    // normalize possible legacy shapes: prefer explicit type, fallback to command/action keys
    const cmdType = (st && (st.type || st.command || st.action)) ? (st.type || st.command || st.action) : null;
    if (!cmdType) {
      return res.status(400).json({ ok: false, error: 'step command missing or unknown', stepIndex: idx, step: st });
    }
    
    logger.event('debug.step.type_check', { presetId: id, stepIndex: idx, cmdType, stepType: st?.type, innerStepIndex: innerStepIdx, isInnerStep }, 'info');
    
    // special-case: handle 'fetch_email' on server side FIRST (before creating cmdPayload, export-server does not support it)
    if (cmdType === 'fetch_email') {
      try {
        const { fetchVerificationCode } = await import('../services/emailFetcher.js');
        const { resolveStepTimeoutMs } = await import('../services/taskQueue.js');
        
        // メール認証情報の取得（email_credentialパラメータのみを使用）
        // このステップはemail_credentialパラメータが必須です
        const emailCredentialRaw = st.email_credential || st.emailCredential || '';
        
        if (!emailCredentialRaw || String(emailCredentialRaw).trim() === '') {
          return res.status(400).json({ ok: false, error: 'email_credential is required for fetch_email step', stepIndex: idx });
        }
        
        let credential = '';
        
        // テンプレート変数から取得を試みる（優先順位: params.email_credential > params.db_email_credential > templateVarsFinal.email_credential > templateVarsFinal.db_email_credential > テンプレート置換）
        // paramsから直接取得を最優先（デバッグモードでparamsが渡される場合）
        if (params && typeof params === 'object' && params.email_credential) {
          credential = String(params.email_credential);
          logger.event('debug.fetch_email.credential_source', { source: 'params.email_credential', hasValue: !!credential }, 'debug');
        } else if (params && typeof params === 'object' && params.db_email_credential) {
          // params.db_email_credentialもチェック（メールアドレス変更タスクなどで使用）
          credential = String(params.db_email_credential);
          logger.event('debug.fetch_email.credential_source', { source: 'params.db_email_credential', hasValue: !!credential }, 'debug');
        } else if (templateVarsFinal?.email_credential) {
          credential = String(templateVarsFinal.email_credential);
          logger.event('debug.fetch_email.credential_source', { source: 'templateVarsFinal.email_credential', hasValue: !!credential }, 'debug');
        } else if (templateVarsFinal?.db_email_credential) {
          // db_email_credentialをフォールバックとして使用（メールアドレス変更タスクなどで使用）
          credential = String(templateVarsFinal.db_email_credential);
          logger.event('debug.fetch_email.credential_source', { source: 'templateVarsFinal.db_email_credential', hasValue: !!credential }, 'debug');
        } else {
          // テンプレート置換を試みる（{{db_email_credential}}形式の場合）
          try {
            logger.event('debug.fetch_email.before_template', { 
              raw: emailCredentialRaw, 
              templateVarsKeys: templateVarsFinal ? Object.keys(templateVarsFinal) : [],
              hasDbEmailCredential: !!(templateVarsFinal?.db_email_credential),
              paramsHasDbEmailCredential: !!(params && typeof params === 'object' && params.db_email_credential)
            }, 'debug');
            credential = applyTemplate(emailCredentialRaw, templateVarsFinal || undefined);
            logger.event('debug.fetch_email.credential_source', { 
              source: 'template', 
              hasValue: !!credential, 
              raw: emailCredentialRaw,
              credentialPreview: credential ? (credential.split(':')[0] + ':***') : '',
              credentialLength: credential ? credential.length : 0
            }, 'debug');
          } catch (e) {
            // テンプレート変数が不足している場合はエラー
            logger.event('debug.fetch_email.credential_source', { source: 'error', error: String(e), paramsKeys: params ? Object.keys(params) : [], templateVarsKeys: templateVarsFinal ? Object.keys(templateVarsFinal) : [], hasDbEmailCredential: !!(templateVarsFinal?.db_email_credential), paramsHasDbEmailCredential: !!(params && typeof params === 'object' && params.db_email_credential) }, 'error');
            return res.status(400).json({ ok: false, error: 'email_credential parameter is required. Please provide email_credential in params.', stepIndex: idx });
          }
        }
        
        // テンプレート置換後の値が空でないことを確認
        if (!credential || String(credential).trim() === '' || String(credential) === '{{email_credential}}') {
          logger.event('debug.fetch_email.credential_empty', { credential, emailCredentialRaw, hasParams: !!params, hasTemplateVars: !!templateVarsFinal }, 'error');
          return res.status(400).json({ ok: false, error: 'email_credential parameter is required. Please provide email_credential in params.', stepIndex: idx });
        }
        
        // email:password形式で分割
        const parts = String(credential).split(':');
        if (parts.length < 2) {
          return res.status(400).json({ ok: false, error: 'email_credential must be in format "email:password"', stepIndex: idx });
        }
        
        const email = parts[0].trim();
        const emailPassword = parts.slice(1).join(':').trim(); // パスワードに:が含まれる場合に対応
        
        if (!email || !emailPassword) {
          return res.status(400).json({ ok: false, error: 'email_credential must be in format "email:password" (both email and password are required)', stepIndex: idx });
        }
        
        const subjectPattern = st.subject_pattern || st.subjectPattern || 'verification|確認コード|code|confirm|メールアドレスを確認';
        const codePattern = st.code_pattern || st.codePattern || '\\d{6}';
        // タイムアウトはステップのタイムアウト（resolveStepTimeoutMs）を使用
        const stepTimeoutMs = resolveStepTimeoutMs(st, defaultTimeoutSeconds);
        const timeoutSeconds = Math.round(stepTimeoutMs / 1000);
        const resultVar = st.result_var || st.resultVar || 'pr_verification_code';
        const fromPattern = st.from_pattern || st.fromPattern;

        // credentialSourceを正確に判定（db_email_credentialは使用しない）
        let credentialSource = 'unknown';
        if (params && typeof params === 'object' && params.email_credential) {
          credentialSource = 'params.email_credential';
        } else if (templateVarsFinal?.email_credential) {
          credentialSource = 'templateVarsFinal.email_credential';
        } else {
          credentialSource = 'template_substitution';
        }
        
        logger.event('debug.fetch_email.template_substitution', {
          presetId: id,
          stepIndex: idx,
          emailCredentialRaw,
          credentialAfter: credential ? (credential.split(':')[0] + ':***') : '',
          emailAfter: email,
          emailPasswordAfter: emailPassword ? '***' : '',
          hasTemplateVars: !!templateVarsFinal,
          hasParams: !!params,
          credentialSource: credentialSource,
          templateVarsKeys: templateVarsFinal ? Object.keys(templateVarsFinal) : [],
          hasEmailCredential: !!templateVarsFinal?.email_credential,
          note: 'db_email_credential is not used (always use new email credential)'
        }, 'debug');

        logger.event('debug.fetch_email.start', { presetId: id, stepIndex: idx, email, timeoutSeconds }, 'info');

        const fetchResult = await fetchVerificationCode({
          email: String(email),
          email_password: String(emailPassword),
          subject_pattern: String(subjectPattern),
          code_pattern: String(codePattern),
          timeout_seconds: timeoutSeconds,
          from_pattern: fromPattern ? String(fromPattern) : undefined
        });

        if (fetchResult.ok && fetchResult.code) {
          logger.event('debug.fetch_email.success', { presetId: id, stepIndex: idx, email, codeLength: fetchResult.code.length, resultVar }, 'info');
          
          // 取得したコードをテンプレート変数として設定
          const updatedTemplateVars = { ...(templateVarsFinal || {}), [resultVar]: fetchResult.code };
          
          return res.json({
            ok: true,
            result: {
              ok: true,
              code: fetchResult.code,
              message: fetchResult.message || '確認コードを取得しました',
              resultVar: resultVar,
              didAction: true,
              reason: `確認コードを取得しました: ${fetchResult.code}`
            },
            sentPayload: { stepType: 'fetch_email', email, resultVar },
            execUrl: 'skipped (fetch_email step, server-side processing)',
            skipped: false,
            gatheredVars: updatedTemplateVars,
            templateVars: updatedTemplateVars
          });
        } else {
          logger.event('debug.fetch_email.failure', { presetId: id, stepIndex: idx, email, error: fetchResult.error }, 'warn');
          return res.status(400).json({
            ok: false,
            error: fetchResult.error || 'UNKNOWN_ERROR',
            message: fetchResult.message || 'メールから確認コードを取得できませんでした',
            stepIndex: idx
          });
        }
      } catch (feErr: any) {
        logger.event('debug.fetch_email.exception', { presetId: id, stepIndex: idx, error: String(feErr?.message || feErr) }, 'error');
        return res.status(500).json({
          ok: false,
          error: 'FETCH_EMAIL_EXCEPTION',
          message: `メール取得処理中にエラーが発生しました: ${String(feErr?.message || feErr)}`,
          stepIndex: idx
        });
      }
    }
    
    // 「コンテナ指定」ステップの処理
    if (cmdType === 'container' || cmdType === 'open_container') {
      logger.event('debug.container.step.detected', { presetId: id, stepIndex: idx, cmdType }, 'info');
      const containerNameRaw = st.container_name || st.containerName || (st.params && (st.params.container_name || st.params.containerName));
      if (!containerNameRaw) {
        return res.status(400).json({ ok: false, error: 'container_name is required for container step', stepIndex: idx });
      }
      const containerName = applyTemplate(containerNameRaw, templateVarsFinal);
      if (!containerName || String(containerName).trim() === '') {
        return res.status(400).json({ ok: false, error: 'container_name is empty after template substitution', stepIndex: idx });
      }
      
      // プロキシ設定を取得（DBから取得したdb_proxyのみを使用）
      const proxyRaw = templateVarsFinal?.db_proxy;
      
      // デバッグログ: プロキシ取得状況を記録
      logger.event('debug.container.proxy_resolution', {
        presetId: id,
        stepIndex: idx,
        containerName,
        dbProxy: templateVarsFinal?.db_proxy || null,
        hasDbProxy: !!templateVarsFinal?.db_proxy
      }, 'debug');
      
      let proxy: { server: string; username?: string; password?: string } | undefined = undefined;
      
      // プロキシ設定を構築
      if (proxyRaw && String(proxyRaw).trim() !== '') {
        const proxyStr = applyTemplate(String(proxyRaw), templateVarsFinal || {});
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
      
      // コンテナ指定ステップの場合は、必ず新規作成を実行（createContainerはコンテナを作成して開く）
      logger.event('debug.container.create_step', {
        presetId: id,
        containerName,
        stepIndex: idx,
        hasProxy: !!proxy,
        proxyServer: proxy?.server || null,
        proxyUsername: proxy?.username || null,
        proxyRaw: proxyRaw || null
      }, 'info');
      const createResult = await createContainer({
        name: String(containerName),
        proxy: proxy,
        timeoutMs: 60000
      });
      
      if (!createResult.ok) {
        const detailedError = `コンテナ "${containerName}" の作成に失敗しました: ${createResult.message}`;
        logger.event('debug.container.create_step.failed', { presetId: id, containerName, stepIndex: idx, error: createResult.message }, 'error');
        return res.status(500).json({ 
          ok: false, 
          error: detailedError,
          containerName, 
          stepIndex: idx 
        });
      }
      
      // コンテナIDを更新（createContainerはコンテナを作成して開くので、openContainerは不要）
      actualContainerId = createResult.containerId;
      logger.event('debug.container.opened_step', { containerId: actualContainerId, stepIndex: idx }, 'info');
      
      return res.json({ 
        ok: true, 
        result: { 
          ok: true, 
          containerId: actualContainerId, 
          message: 'Container created and opened successfully',
          didAction: true,
          reason: `コンテナを作成して開きました: ${actualContainerId}`
        }, 
        containerId: actualContainerId, // 後続ステップで使用するためにcontainerIdを返す
        sentPayload: { stepType: 'container', containerName }, 
        execUrl: 'skipped (container step)', 
        skipped: false,
        templateVars: templateVarsFinal  // DBから取得したパラメータをクライアントに返す
      });
    }
    
    const cmdPayload: any = { contextId: actualContainerId, command: cmdType };

    // resolve parameters with fallbacks (support legacy shapes)
    if (cmdType === 'navigate') {
      // URLが固定値で指定されている場合（テンプレート変数を含まない）、post_library_idからのURL取得処理をスキップ
      const urlRaw = st.url || (st.params && st.params.url) || overrides?.url;
      const urlStr = urlRaw ? String(urlRaw) : '';
      const hasFixedUrl = urlStr && !urlStr.includes('{{') && urlStr.trim() !== '';
      
      // post_library_id が指定されている場合、DBからURLを取得（固定URLが指定されていない場合のみ）
      // パラメータ名の正規化: post_library_id（スネークケース）と postLibraryId（キャメルケース）の両方に対応
      const postLibraryIdRaw = (params && typeof params === 'object' && (params.post_library_id || params.postLibraryId || params.pr_post_library_id)) ? (params.post_library_id || params.postLibraryId || params.pr_post_library_id) : (templateVarsFinal?.pr_post_library_id || templateVarsFinal?.post_library_id || templateVarsFinal?.postLibraryId);
      logger.event('debug.navigate.post_library_id_check', {
        presetId: id,
        containerId: actualContainerId,
        stepIndex: idx,
        postLibraryIdRaw: postLibraryIdRaw,
        hasParams: !!(params && typeof params === 'object'),
        paramsPostLibraryId: (params && typeof params === 'object') ? params.post_library_id : undefined,
        templateVarsFinalPostLibraryId: templateVarsFinal?.post_library_id,
        hasPrPostInfo: !!templateVarsFinal?.pr_post_info,
        prPostInfoPostUrl: templateVarsFinal?.pr_post_info?.post_url,
        hasFixedUrl: hasFixedUrl,
        urlRaw: urlStr,
        willLoadFromDb: !!(postLibraryIdRaw && !templateVarsFinal?.pr_post_info?.post_url && !hasFixedUrl)
      }, 'info');
      if (postLibraryIdRaw && !templateVarsFinal?.pr_post_info?.post_url && !hasFixedUrl) {
        try {
          const postLibraryId = typeof postLibraryIdRaw === 'string' ? parseInt(postLibraryIdRaw, 10) : Number(postLibraryIdRaw);
          logger.event('debug.navigate.post_library_id_parsed', {
            presetId: id,
            containerId: actualContainerId,
            stepIndex: idx,
            postLibraryIdRaw: postLibraryIdRaw,
            postLibraryId: postLibraryId,
            isValid: !isNaN(postLibraryId) && postLibraryId > 0
          }, 'info');
          if (!isNaN(postLibraryId) && postLibraryId > 0) {
            logger.event('debug.navigate.db_query_start', {
              presetId: id,
              containerId: actualContainerId,
              stepIndex: idx,
              post_library_id: postLibraryId,
              sql: 'SELECT id, source_url, content, account_id, post_id_threads FROM post_library WHERE id = ?',
              dbPath: path.resolve('storage', 'app.db')
            }, 'info');
            const record = dbQuery<any>('SELECT id, source_url, content, account_id, post_id_threads FROM post_library WHERE id = ?', [postLibraryId]);
            logger.event('debug.navigate.db_post_library_check', {
              presetId: id,
              containerId: actualContainerId,
              stepIndex: idx,
              post_library_id: postLibraryId,
              recordCount: record ? record.length : 0,
              record: record && record.length > 0 ? record[0] : null
            }, 'info');
            logger.event('debug.navigate.db_query_result', {
              presetId: id,
              containerId: actualContainerId,
              stepIndex: idx,
              post_library_id: postLibraryId,
              recordCount: record ? record.length : 0,
              recordType: typeof record,
              isArray: Array.isArray(record),
              record: record && record.length > 0 ? {
                id: record[0].id,
                url: record[0].source_url,
                source_url: record[0].source_url,
                content: record[0].content,
                has_source_url: !!record[0].source_url,
                has_content: !!record[0].content,
                account_id: record[0].account_id,
                post_id_threads: record[0].post_id_threads
              } : null
            }, 'info');
            if (record && record.length > 0) {
              const rec = record[0];
              const url = rec.source_url || rec.content || '';
              logger.event('debug.navigate.url_extracted', {
                presetId: id,
                containerId: actualContainerId,
                stepIndex: idx,
                post_library_id: postLibraryId,
                url: url,
                urlLength: url ? url.length : 0,
                source_url: rec.source_url,
                content: rec.content,
                account_id: rec.account_id,
                post_id_threads: rec.post_id_threads
              }, 'info');
              if (url) {
                templateVarsFinal = templateVarsFinal || {};
                // URLから account_id と post_id を抽出（Threads URL形式の場合）
                const match = url.match(/@([^\/]+)\/post\/([A-Za-z0-9_-]+)/);
                logger.event('debug.navigate.url_regex_match', {
                  presetId: id,
                  containerId: actualContainerId,
                  stepIndex: idx,
                  url: url,
                  matchFound: !!match,
                  matchLength: match ? match.length : 0,
                  matchGroups: match ? match.slice(1) : null
                }, 'info');
                if (match && match.length >= 3) {
                  templateVarsFinal.post_url = url;
                  templateVarsFinal.pr_post_info = {
                    post_library_id: rec.id,
                    post_url: url.split('?')[0],
                    account_id: rec.account_id || (match && match.length >= 3 ? match[1] : null),
                    post_id: rec.post_id_threads || (match && match.length >= 3 ? match[2] : null),
                    use_existing_record: true
                  };
                  logger.event('debug.navigate.loaded_from_post_library', {
                    presetId: id,
                    containerId: actualContainerId,
                    stepIndex: idx,
                    post_library_id: postLibraryId,
                    post_url: templateVarsFinal.pr_post_info.post_url,
                    account_id: templateVarsFinal.pr_post_info.account_id,
                    post_id: templateVarsFinal.pr_post_info.post_id,
                    extractedViaRegex: true
                  }, 'info');
                } else {
                  // URL形式がThreads形式でない場合でも、URLが存在すれば使用する
                  templateVarsFinal.post_url = url;
                  templateVarsFinal.pr_post_info = {
                    post_library_id: rec.id,
                    post_url: url.split('?')[0],
                    account_id: rec.account_id || null,
                    post_id: rec.post_id_threads || null,
                    use_existing_record: true
                  };
                  logger.event('debug.navigate.loaded_from_post_library', {
                    presetId: id,
                    containerId: actualContainerId,
                    stepIndex: idx,
                    post_library_id: postLibraryId,
                    post_url: templateVarsFinal.pr_post_info.post_url,
                    account_id: templateVarsFinal.pr_post_info.account_id,
                    post_id: templateVarsFinal.pr_post_info.post_id,
                    extractedViaRegex: false
                  }, 'info');
                }
              } else {
                logger.event('debug.navigate.no_url_in_db', {
                  presetId: id,
                  containerId: actualContainerId,
                  stepIndex: idx,
                  post_library_id: postLibraryId,
                  record: rec
                }, 'warn');
                return res.status(400).json({ ok: false, error: `Post library record (id=${postLibraryId}) has no URL (source_url or content is empty)`, stepIndex: idx });
              }
            } else {
              logger.event('debug.navigate.record_not_found', {
                presetId: id,
                containerId: actualContainerId,
                stepIndex: idx,
                post_library_id: postLibraryId,
                queryResult: record
              }, 'error');
                return res.status(400).json({ ok: false, error: `Post library record not found: id=${postLibraryId}`, stepIndex: idx });
            }
          }
        } catch (loadErr: any) {
          logger.event('debug.navigate.db_load_error', {
            presetId: id,
            containerId: actualContainerId,
            stepIndex: idx,
            error: String(loadErr?.message || loadErr)
          }, 'error');
          return res.status(500).json({ ok: false, error: `Failed to load post library record: ${String(loadErr?.message || loadErr)}`, stepIndex: idx });
        }
      }
      
      const raw = (overrides && typeof overrides === 'object' && overrides.url) ? overrides.url : (st.url || (st.params && st.params.url));
      if (!raw) return res.status(400).json({ ok: false, error: 'navigate step missing url', stepIndex: idx });
      cmdPayload.url = applyTemplate(raw, templateVarsFinal);
      
      // navigateステップでのプロキシ設定（DBから取得したdb_proxyのみを使用）
      const proxyRaw = templateVarsFinal?.db_proxy;
      if (proxyRaw && String(proxyRaw).trim() !== '') {
        const proxyStr = applyTemplate(String(proxyRaw), templateVarsFinal || {});
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
    if (cmdType === 'eval') {
      // ステップ5（stepIndex 4）の前処理：メールアドレス自動取得
      // プリセット22（メールアドレス変更）で、db_new_emailが未設定の場合のみ実行
      if (id === 22 && idx === 4) {
        const needsEmail = !templateVarsFinal?.db_new_email || 
                           String(templateVarsFinal.db_new_email).trim() === '';
        
        if (needsEmail) {
          try {
            // x_accountsのemailも確認（既に設定されている場合はスキップ）
            const xAccountCheck = dbQuery<{ email: string | null }>(
              'SELECT email FROM x_accounts WHERE container_id = ?',
              [actualContainerId || containerId]
            );
            
            if (!xAccountCheck?.[0]?.email) {
              logger.event('debug.auto_acquire_email.start', {
                presetId: id,
                stepIndex: idx,
                containerId: actualContainerId || containerId,
                containerName: xAccountContainerId || (actualContainerId || containerId)
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
                      logger.event('debug.auto_acquire_email.invalid_format', {
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
                      logger.event('debug.auto_acquire_email.already_acquired', {
                        emailAccountId: emailAccount.id,
                        email: email.substring(0, 20) + '...',
                        retry
                      }, 'warn');
                      return null;
                    }
                    
                    // 4. x_accountsに登録
                    const containerIdForUpdate = actualContainerId || containerId;
                    dbRun(
                      'UPDATE x_accounts SET email = ?, email_password = ?, updated_at = ? WHERE container_id = ?',
                      [email, password, now, containerIdForUpdate]
                    );
                    
                    logger.event('debug.auto_acquire_email.success', {
                      presetId: id,
                      stepIndex: idx,
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
                    logger.event('debug.auto_acquire_email.retry', {
                      presetId: id,
                      stepIndex: idx,
                      retry: retry + 1,
                      maxRetries,
                      delayMs
                    }, 'debug');
                  }
                } catch (retryErr: any) {
                  logger.event('debug.auto_acquire_email.retry_error', {
                    presetId: id,
                    stepIndex: idx,
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
                // テンプレート変数に反映
                templateVarsFinal.db_new_email = emailData.email;
                templateVarsFinal.db_email_credential = `${emailData.email}:${emailData.password}`;
                
                logger.event('debug.auto_acquire_email.template_vars_set', {
                  presetId: id,
                  stepIndex: idx,
                  hasDbNewEmail: !!templateVarsFinal.db_new_email,
                  hasDbEmailCredential: !!templateVarsFinal.db_email_credential
                }, 'debug');
              } else {
                logger.event('debug.auto_acquire_email.failed', {
                  presetId: id,
                  stepIndex: idx,
                  containerId: actualContainerId || containerId,
                  reason: 'no_available_email_or_already_acquired'
                }, 'warn');
                
                return res.status(400).json({
                  ok: false,
                  error: 'メールアドレスの自動取得に失敗しました（未使用のメールアドレスが見つかりません）',
                  stepIndex: idx
                });
              }
            } else {
              // x_accountsに既にemailが設定されている場合は、それをdb_new_emailに設定
              templateVarsFinal.db_new_email = xAccountCheck[0].email;
              logger.event('debug.auto_acquire_email.skipped_already_set', {
                presetId: id,
                stepIndex: idx,
                containerId: actualContainerId || containerId,
                email: xAccountCheck[0].email?.substring(0, 20) + '...'
              }, 'debug');
            }
          } catch (acquireErr: any) {
            logger.event('debug.auto_acquire_email.exception', {
              presetId: id,
              stepIndex: idx,
              containerId: actualContainerId || containerId,
              error: String(acquireErr?.message || acquireErr)
            }, 'error');
            
            return res.status(500).json({
              ok: false,
              error: `メールアドレスの自動取得中にエラーが発生しました: ${String(acquireErr?.message || acquireErr)}`,
              stepIndex: idx
            });
          }
        }
      }
      
      const rawEval = (overrides && typeof overrides === 'object' && overrides.eval) ? overrides.eval : (st.code || st.eval || (st.params && (st.params.eval || st.params.code)));
      if (!rawEval) return res.status(400).json({ ok: false, error: 'eval missing', stepIndex: idx });
      
      // evalコード内でスキップロジックが含まれている場合は、欠落パラメータを許容する
      const hasSkipLogic = String(rawEval).includes('skipped') 
        || String(rawEval).includes('not provided') 
        || String(rawEval).includes('未指定') 
        || String(rawEval).includes("trim() === ''")
        || String(rawEval).includes("=== 'undefined'");  // db_new_email未設定時の判定パターン
      // evalステップのコード内の文字列リテラル内のテンプレート変数をエスケープ（改行・特殊文字対応）
      cmdPayload.eval = applyTemplate(rawEval, templateVarsFinal, hasSkipLogic, true);
      
      // コンテナ名取得ステップ（パラメータ検出用）を検出して、実際のコンテナ操作をスキップ
      const isContainerNameStep = (st.description && st.description.includes('コンテナ名を取得')) ||
                                   (String(rawEval).includes('コンテナ名') && String(rawEval).includes('パラメータ検出'));
      if (isContainerNameStep) {
        // パラメータ検出用のステップなので、実際のコンテナ操作を行わず、即座に成功を返す
        const mockResult = {
          ok: true,
          result: {
            didAction: true,
            reason: 'コンテナ名を取得しました（パラメータ検出用、ブラウザ操作なし）',
            skipBrowserOperation: true
          }
        };
        return res.json({ ok: true, result: mockResult, sentPayload: cmdPayload, execUrl: 'skipped (container name step)', skipped: true });
      }
    }
    if (cmdType === 'click' || cmdType === 'type' || cmdType === 'clickAndType') {
      const rawSel = (overrides && typeof overrides === 'object' && overrides.selector) ? overrides.selector : (st.selector || (st.params && st.params.selector));
      if (!rawSel) return res.status(400).json({ ok: false, error: 'click/type/clickAndType step missing selector', stepIndex: idx });
      cmdPayload.selector = applyTemplate(rawSel, templateVarsFinal);
    }
    if (cmdType === 'type') {
      const rawText = (overrides && typeof overrides === 'object' && typeof overrides.text === 'string') ? overrides.text : (st.text || (st.params && st.params.text) || '');
      // テンプレート変数を置換
      try {
        cmdPayload.text = applyTemplate(rawText, templateVarsFinal);
        // undefined（値またはリテラル文字列）を空文字列に変換
        if (cmdPayload.text === undefined || cmdPayload.text === 'undefined') {
          cmdPayload.text = '';
        }
        // location / website パラメータは常に空文字を入力
        const paramName = st.params?.name || st.name || '';
        if (String(paramName).toLowerCase() === 'location' || String(paramName).toLowerCase() === 'website') {
          cmdPayload.text = '';
        }
        // Container Browser が "value" を期待する実装の場合の互換: text と同値を value でも送る
        cmdPayload.value = cmdPayload.text;
      } catch (e) {
        // テンプレート変数が不足している場合はエラー
        return res.status(400).json({ ok: false, error: `Template variable missing in type step text: ${String(e?.message || e)}`, stepIndex: idx });
      }
    }
    if (cmdType === 'setFileInput') {
      const rawSel = (overrides && typeof overrides === 'object' && overrides.selector) ? overrides.selector : (st.selector || (st.params && st.params.selector));
      if (!rawSel || String(rawSel).trim() === '') {
        return res.status(400).json({ ok: false, error: 'setFileInput step requires selector', stepIndex: idx });
      }
      cmdPayload.selector = applyTemplate(rawSel, templateVarsFinal);
      if (!cmdPayload.selector || String(cmdPayload.selector).trim() === '') {
        return res.status(400).json({ ok: false, error: 'setFileInput selector is empty after template substitution', stepIndex: idx });
      }
      const rawFileUrl = (overrides && typeof overrides === 'object' && overrides.fileUrl) ? overrides.fileUrl : (st.fileUrl || st.file_url || (st.params && (st.params.fileUrl || st.params.file_url)));
      // fileUrlがテンプレート変数の場合、未指定の場合はスキップ
      const templateVarMatch = String(rawFileUrl || '').match(/\{\{([A-Za-z0-9_-]+)\}\}/);
      if (templateVarMatch) {
        const varName = templateVarMatch[1];
        // テンプレート変数が未指定または空文字列の場合はスキップ
        if (!templateVarsFinal || typeof templateVarsFinal[varName] === 'undefined' || templateVarsFinal[varName] === null || String(templateVarsFinal[varName]).trim() === '') {
          return res.json({ 
            ok: true, 
            result: { ok: true, skipped: true, reason: `${varName} not provided, skipping` }, 
            sentPayload: cmdPayload, 
            execUrl: 'skipped (fileUrl not provided)', 
            skipped: true 
          });
        }
      }
      cmdPayload.fileUrl = applyTemplate(rawFileUrl, templateVarsFinal);
      if (st.fileName || st.file_name || (st.params && (st.params.fileName || st.params.file_name))) {
        cmdPayload.fileName = applyTemplate(st.fileName || st.file_name || (st.params && (st.params.fileName || st.params.file_name)), templateVarsFinal);
      }
      if (st.fileType || st.file_type || (st.params && (st.params.fileType || st.params.file_type))) {
        cmdPayload.fileType = applyTemplate(st.fileType || st.file_type || (st.params && (st.params.fileType || st.params.file_type)), templateVarsFinal);
      }
    }
    const stepOptions = (st.options && typeof st.options === 'object') ? Object.assign({}, st.options) : {};
    const options = Object.assign({}, stepOptions);
    // forステップはサーバー側で処理されるため、タイムアウトを無効化（各内部ステップにタイムアウトがあるため）
    if (cmdType !== 'for') {
      options.timeoutMs = resolveStepTimeoutMs(st, defaultTimeoutSeconds);
      const reqOptions = (req.body && typeof req.body.options === 'object') ? req.body.options : {};
      if (reqOptions && typeof reqOptions === 'object') {
        if (typeof reqOptions.timeoutMs === 'number' && Number.isFinite(reqOptions.timeoutMs) && reqOptions.timeoutMs > 0) {
          options.timeoutMs = reqOptions.timeoutMs;
        }
        Object.assign(options, reqOptions);
      }
    }
    // type/click は要素が出現してから実行する必要があるため、options.waitForSelector が未指定なら selector で埋める（概要・API仕様に沿った呼び出し）
    if ((cmdType === 'type' || cmdType === 'click') && cmdPayload.selector && (!options.waitForSelector || String(options.waitForSelector).trim() === '')) {
      options.waitForSelector = cmdPayload.selector;
    }
    // type ステップは Container Browser の type が contenteditable で効かないため、eval に差し替えて送る（X 投稿欄などで確実に入力する）
    if (cmdType === 'type' && cmdPayload.selector != null && typeof cmdPayload.text === 'string') {
      cmdPayload.command = 'eval';
      cmdPayload.eval = buildTypeAsEvalCode(cmdPayload.selector, cmdPayload.text);
      delete cmdPayload.selector;
      delete cmdPayload.text;
      delete cmdPayload.value;
    }
    
    // save_media ステップの処理（個別ステップ実行時）
    // デバッグ: cmdType と st の内容を確認
    logger.event('debug.save_media.check', {
      presetId: id,
      containerId: actualContainerId,
      stepIndex: idx,
      innerStepIndex: innerStepIdx,
      cmdType,
      stType: st?.type,
      stCommand: st?.command,
      stAction: st?.action,
      isSaveMedia: cmdType === 'save_media',
      stKeys: st ? Object.keys(st) : null,
      hasDestinationFolder: !!(st?.destination_folder),
      hasFolderName: !!(st?.folder_name),
      hasSelectors: !!(st?.selectors)
    }, 'info');
    
    if (cmdType === 'save_media') {
      // 仕様: options の中に destination_folder, folder_name, selectors を含める
      const rawDestinationFolder = st.destination_folder || './storage/media/threads';
      const rawFolderName = st.folder_name || '';
      let resolvedDestinationFolder = applyTemplate(rawDestinationFolder, templateVarsFinal);
      const resolvedFolderName = applyTemplate(rawFolderName, templateVarsFinal);
      
      // 相対パスの場合は絶対パスに変換
      if (resolvedDestinationFolder && !path.isAbsolute(resolvedDestinationFolder)) {
        resolvedDestinationFolder = path.resolve(resolvedDestinationFolder);
      }
      
      options.destination_folder = resolvedDestinationFolder;
      options.folder_name = resolvedFolderName;
      options.selectors = st.selectors || [];
      
      // デバッグログ
      logger.event('debug.save_media.template', {
        presetId: id,
        containerId: actualContainerId,
        stepIndex: idx,
        innerStepIndex: innerStepIdx,
        rawDestinationFolder,
        rawFolderName,
        resolvedDestinationFolder: options.destination_folder,
        resolvedFolderName: options.folder_name,
        hasPrPostInfo: !!(templateVarsFinal?.pr_post_info),
        prPostInfo: templateVarsFinal?.pr_post_info
      }, 'info');
    }
    
    cmdPayload.options = options;
    logger.event('debug.exec', { presetId: id, containerId: actualContainerId, originalContainerId: containerId, stepIndex: idx, command: cmdType, payload: cmdPayload }, 'debug');
    try { logger.event('debug.exec_payload', { presetId: id, containerId: actualContainerId, stepIndex: idx, payload: cmdPayload }, 'debug'); } catch (e) {}

    const url = `http://${host}:${port}/internal/exec`;

    // special-case: handle 'save_follower_count' on server side for debug-step (export-server does not support it)
    if (cmdType === 'save_follower_count') {
      try {
        // 前のステップの結果からフォロワー数とフォロー数を取得
        // pr_follower_data から取得するか、直接 pr_follower_count/pr_following_count から取得
        let followerCount: number | null = null;
        let followingCount: number | null = null;
        
        // リクエストボディから前のステップの結果を取得（デバッグモードでフロントエンドが保持している場合）
        const gatheredVars = req.body?.gatheredVars || req.body?.templateVars || null;
        const previousStepResult = req.body?.previousStepResult || null;
        
        // パターン1: リクエストボディのgatheredVarsから取得
        if (gatheredVars && typeof gatheredVars === 'object') {
          if (typeof gatheredVars.pr_follower_count === 'number') {
            followerCount = gatheredVars.pr_follower_count;
          }
          if (typeof gatheredVars.pr_following_count === 'number') {
            followingCount = gatheredVars.pr_following_count;
          }
          if (!followerCount && !followingCount) {
            const prFollowerData = gatheredVars.pr_follower_data;
            if (prFollowerData && typeof prFollowerData === 'object') {
              if (typeof prFollowerData.followerCount === 'number') {
                followerCount = prFollowerData.followerCount;
              }
              if (typeof prFollowerData.followingCount === 'number') {
                followingCount = prFollowerData.followingCount;
              }
            }
          }
        }
        
        // パターン2: 前のステップの結果から取得
        if (previousStepResult && typeof previousStepResult === 'object') {
          if (followerCount === null && typeof previousStepResult.followerCount === 'number') {
            followerCount = previousStepResult.followerCount;
          }
          if (followingCount === null && typeof previousStepResult.followingCount === 'number') {
            followingCount = previousStepResult.followingCount;
          }
        }
        
        // パターン3: templateVarsFinalから取得（evalステップのresult_varで設定された場合）
        const prFollowerData = templateVarsFinal?.pr_follower_data;
        if (prFollowerData && typeof prFollowerData === 'object') {
          if (followerCount === null && typeof prFollowerData.followerCount === 'number') {
            followerCount = prFollowerData.followerCount;
          }
          if (followingCount === null && typeof prFollowerData.followingCount === 'number') {
            followingCount = prFollowerData.followingCount;
          }
        }
        
        // パターン4: 直接 pr_follower_count/pr_following_count から取得
        if (followerCount === null && typeof templateVarsFinal?.pr_follower_count === 'number') {
          followerCount = templateVarsFinal.pr_follower_count;
        }
        if (followingCount === null && typeof templateVarsFinal?.pr_following_count === 'number') {
          followingCount = templateVarsFinal.pr_following_count;
        }
        
        if ((followerCount === null && followingCount === null)) {
          return res.status(400).json({
            ok: false,
            error: 'pr_follower_count/pr_following_countが数値ではありません',
            hasContainerId: !!actualContainerId,
            pr_follower_count: followerCount,
            pr_following_count: followingCount,
            templateVarsKeys: templateVarsFinal ? Object.keys(templateVarsFinal) : [],
          });
        }
        
        // x_accountsテーブルのcontainer_idにはXID（Xアカウントのユーザー名、例：astrosynth87208）が保存されている
        // したがって、templateVarsFinal/gatheredVars の db_container_name（XID）を使用する
        const containerIdForUpdateRaw =
          (gatheredVars && typeof gatheredVars === 'object' ? gatheredVars.db_container_name : null) ?? templateVarsFinal?.db_container_name ?? null;
        const containerIdForUpdate = containerIdForUpdateRaw ? String(containerIdForUpdateRaw).trim() : '';

        if (!containerIdForUpdate) {
          return res.status(400).json({
            ok: false,
            error: 'db_container_name（XID）が取得できません',
            hasDbContainerName: false,
            db_container_name: null,
            containerId: actualContainerId || null,
          });
        }
        
        // x_accountsテーブルに保存
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
          
          logger.event('debug.save_follower_count.before_update', {
            presetId: id,
            stepIndex: idx,
            containerIdForUpdate,
            hasExisting: !!existing,
            followerCount,
            followingCount,
            updateFieldsCount: updateFields.length,
            updateFields: updateFields,
          }, 'debug');
          
          if (!existing) {
            // 重要: デバッグ実行でも x_accounts の新規作成はしない（必ずUPDATEのみ）
            return res.status(404).json({
              ok: false,
              error: `x_accountsテーブルにレコードが存在しません: ${containerIdForUpdate}`,
              message: 'フォロワー数とフォロー数を保存するには、先にアカウントを登録してください',
              containerIdForUpdate,
              followerCount: typeof followerCount === 'number' ? followerCount : null,
              followingCount: typeof followingCount === 'number' ? followingCount : null,
            });
          }

          // レコードが存在する場合はUPDATE
          const updateValues: any[] = [];
          if (typeof followerCount === 'number') {
            updateValues.push(followerCount);
          }
          if (typeof followingCount === 'number') {
            updateValues.push(followingCount);
          }
          updateValues.push(now); // updated_at
          updateValues.push(containerIdForUpdate); // WHERE条件（XID）
          
          const updateSql = `UPDATE x_accounts SET ${updateFields.join(', ')}, updated_at = ? WHERE container_id = ?`;
          logger.event('debug.save_follower_count.update_sql', {
            presetId: id,
            stepIndex: idx,
            sql: updateSql,
            values: updateValues,
          }, 'debug');
          const updateResult = dbRun(updateSql, updateValues);
          logger.event('debug.save_follower_count.update_result', {
            presetId: id,
            stepIndex: idx,
            changes: updateResult.changes,
            lastInsertRowid: updateResult.lastInsertRowid,
          }, 'info');
          
          if (updateResult.changes === 0) {
            logger.event('debug.save_follower_count.update_no_changes', {
              presetId: id,
              stepIndex: idx,
              containerIdForUpdate,
              sql: updateSql,
              values: updateValues,
            }, 'warn');
          }
          
          logger.event('debug.save_follower_count.success', {
            presetId: id,
            stepIndex: idx,
            containerId: actualContainerId,
            containerIdForUpdate: containerIdForUpdate,
            followerCount: followerCount,
            followingCount: followingCount,
          }, 'info');
          
          return res.json({
            ok: true,
            result: {
              ok: true,
              saved: savedData,
              containerId: containerIdForUpdate,
              message: `フォロワー数とフォロー数を保存しました: ${JSON.stringify(savedData)}`,
              didAction: true,
              reason: `フォロワー数: ${followerCount !== null ? followerCount : 'N/A'}, フォロー数: ${followingCount !== null ? followingCount : 'N/A'}`
            },
            sentPayload: { stepType: 'save_follower_count', containerId: containerIdForUpdate },
            execUrl: 'skipped (save_follower_count step, server-side processing)',
            skipped: false
          });
        } else {
          return res.status(400).json({
            ok: false,
            error: 'pr_follower_countまたはpr_following_countが数値として設定されていません',
            pr_follower_count: followerCount,
            pr_following_count: followingCount,
          });
        }
      } catch (e: any) {
        logger.event('debug.save_follower_count.err', {
          presetId: id,
          stepIndex: idx,
          err: String(e?.message || e),
        }, 'error');
        return res.status(500).json({
          ok: false,
          error: 'save_follower_countステップでエラーが発生しました: ' + String(e?.message || e),
          stepIndex: idx
        });
      }
    }

    // special-case: handle 'for' on server side for debug-step (export-server does not support it)
    if (cmdType === 'for') {
      try {
        const countRaw = st.count || st.repeat || 1;
        const count = Math.max(1, Math.floor(Number(applyTemplate(String(countRaw), templateVarsFinal))));
        const maxPostsRaw = st.max_posts || st.maxPosts;
        const maxPosts = maxPostsRaw ? Math.max(1, Math.floor(Number(applyTemplate(String(maxPostsRaw), templateVarsFinal)))) : null;
        
        // 根本解決: 常にデータベースから読み込んだプリセットのステップを使用（result_varを含む完全なステップ定義を保証）
        let innerSteps: any[] = [];
        if (parsedPreset.steps && Array.isArray(parsedPreset.steps) && idx < parsedPreset.steps.length) {
          const dbForStep = parsedPreset.steps[idx];
          if (dbForStep && dbForStep.type === 'for' && Array.isArray(dbForStep.steps)) {
            innerSteps = dbForStep.steps;
            logger.event('debug.for.using_db_steps', {
              presetId: id,
              containerId: actualContainerId,
              stepIndex: idx,
              reason: 'always use database preset steps (root cause fix)',
              innerStepsCount: innerSteps.length,
              innerStepsWithResultVar: innerSteps.filter((s: any) => s.result_var).length,
              innerStepsDetails: innerSteps.map((s: any, i: number) => ({
                index: i,
                type: s.type,
                hasResultVar: !!s.result_var,
                resultVar: s.result_var || null
              }))
            }, 'info');
          } else {
            // フォールバック: リクエストボディのステップを使用（データベースにforステップがない場合）
            innerSteps = Array.isArray(st.steps) ? st.steps : [];
            logger.event('debug.for.using_request_steps', {
              presetId: id,
              containerId: actualContainerId,
              stepIndex: idx,
              reason: 'database preset does not have for step, using request body steps',
              innerStepsCount: innerSteps.length
            }, 'warn');
          }
        } else {
          // フォールバック: リクエストボディのステップを使用（データベースから読み込めない場合）
          innerSteps = Array.isArray(st.steps) ? st.steps : [];
          logger.event('debug.for.using_request_steps', {
            presetId: id,
            containerId: actualContainerId,
            stepIndex: idx,
            reason: 'cannot load database preset steps, using request body steps',
            innerStepsCount: innerSteps.length
          }, 'warn');
        }
        
        // デバッグ: innerStepsの内容を確認（根本解決後の状態）
        logger.event('debug.for.inner_steps.debug', {
          presetId: id,
          containerId: actualContainerId,
          stepIndex: idx,
          innerStepsCount: innerSteps.length,
          innerStepsWithResultVar: innerSteps.filter((s: any) => s.result_var).length,
          innerStepsDetails: innerSteps.map((s: any, i: number) => ({
            index: i,
            type: s.type,
            hasResultVar: !!s.result_var,
            resultVar: s.result_var || null,
            keys: s ? Object.keys(s) : []
          })),
          source: 'database_preset' // データベースから読み込んだプリセットを使用
        }, 'info');
        
        logger.event('debug.for.start', {
          presetId: id,
          containerId: actualContainerId,
          stepIndex: idx,
          repeat_count: count,
          max_posts: maxPosts,
          innerStepsCount: innerSteps.length
        }, 'info');
        
        const forResults: any[] = [];
        let totalSaved = 0;
        
        // 内部ステップを実行するためのヘルパー関数
        const executeInnerStep = async (innerStep: any, innerIdx: number, loopIndex: number, currentTemplateVars: any): Promise<any> => {
          // デバッグ: executeInnerStep が呼び出されたことを確認
          logger.event('debug.for.inner_step.called', {
            presetId: id,
            containerId: actualContainerId,
            stepIndex: idx,
            loopIndex,
            innerStepIndex: innerIdx,
            innerStepType: innerStep?.type,
            innerStepExists: !!innerStep
          }, 'info');
          
          // デバッグ: innerStepの内容を確認
          logger.event('debug.for.inner_step.debug', {
            presetId: id,
            containerId: actualContainerId,
            stepIndex: idx,
            loopIndex,
            innerStepIndex: innerIdx,
            innerStepType: innerStep?.type,
            innerStepKeys: innerStep ? Object.keys(innerStep) : null,
            hasResultVar: !!(innerStep?.result_var),
            resultVar: innerStep?.result_var || null,
            innerStepJson: innerStep ? JSON.stringify(innerStep).substring(0, 500) : null
          }, 'info');
          
          // 内部ステップのテンプレート変数を適用（現在のテンプレート変数を使用）
          const innerTemplateVars = Object.assign({}, currentTemplateVars, {
            loop_index: loopIndex,
            loop_count: loopIndex + 1
          });
          
          // 内部ステップのコマンドタイプを決定
          const innerCmdType = innerStep.type || innerStep.command || 'eval';
          
          // デバッグ: innerCmdType の値を確認
          logger.event('debug.for.inner_step.cmd_type', {
            presetId: id,
            containerId: actualContainerId,
            stepIndex: idx,
            loopIndex,
            innerStepIndex: innerIdx,
            innerStepType: innerStep?.type,
            innerStepCommand: innerStep?.command,
            innerCmdType,
            isSaveMedia: innerCmdType === 'save_media'
          }, 'info');
          
          // 内部ステップのペイロードを構築
          const innerCmdPayload: any = { contextId: actualContainerId, command: innerCmdType };
          
          // テンプレート変数を適用
          if (innerStep.type === 'navigate') {
            innerCmdPayload.url = applyTemplate(innerStep.url || '', innerTemplateVars);
          }
          if (innerStep.type === 'click' || innerStep.type === 'type') {
            innerCmdPayload.selector = applyTemplate(innerStep.selector || '', innerTemplateVars);
          }
          if (innerStep.type === 'type') {
            innerCmdPayload.text = applyTemplate(innerStep.text || '', innerTemplateVars);
          }
          if (innerStep.type === 'eval') {
            const rawEval = innerStep.code || innerStep.eval || '';
            // evalステップのコード内の文字列リテラル内のテンプレート変数をエスケープ（改行・特殊文字対応）
            innerCmdPayload.eval = applyTemplate(rawEval, innerTemplateVars, false, true);
          }
          if (innerStep.type === 'extract') {
            innerCmdPayload.selector = applyTemplate(innerStep.selector || '', innerTemplateVars);
          }
          
          const innerOptions = Object.assign({}, (innerStep.options && typeof innerStep.options === 'object') ? innerStep.options : {});
          innerOptions.timeoutMs = resolveStepTimeoutMs(innerStep, defaultTimeoutSeconds);
          
          // デバッグ: innerStep.type を確認
          logger.event('debug.for.inner_step.type_check', {
            presetId: id,
            containerId: actualContainerId,
            stepIndex: idx,
            loopIndex,
            innerStepIndex: innerIdx,
            innerStepType: innerStep?.type,
            innerStepTypeString: String(innerStep?.type),
            isSaveMedia: innerStep?.type === 'save_media',
            innerStepKeys: innerStep ? Object.keys(innerStep) : null,
            innerStepJson: innerStep ? JSON.stringify(innerStep).substring(0, 1000) : null
          }, 'info');
          
          if (innerStep.type === 'save_media') {
            // デバッグ: save_media ステップの処理開始を確認
            logger.event('debug.for.save_media.entered', {
              presetId: id,
              containerId: actualContainerId,
              stepIndex: idx,
              loopIndex,
              innerStepIndex: innerIdx,
              hasDestinationFolder: !!(innerStep.destination_folder),
              hasFolderName: !!(innerStep.folder_name),
              hasSelectors: !!(innerStep.selectors),
              destinationFolder: innerStep.destination_folder,
              folderName: innerStep.folder_name,
              selectorsCount: innerStep.selectors ? innerStep.selectors.length : 0
            }, 'info');
            // save_media ステップの処理
            // 仕様: options の中に destination_folder, folder_name, selectors を含める
            const rawDestinationFolder = innerStep.destination_folder || './storage/media/threads';
            const rawFolderName = innerStep.folder_name || '';
            let resolvedDestinationFolder = applyTemplate(rawDestinationFolder, innerTemplateVars);
            const resolvedFolderName = applyTemplate(rawFolderName, innerTemplateVars);
            
            // 相対パスの場合は絶対パスに変換
            if (resolvedDestinationFolder && !path.isAbsolute(resolvedDestinationFolder)) {
              resolvedDestinationFolder = path.resolve(resolvedDestinationFolder);
            }
            
            innerOptions.destination_folder = resolvedDestinationFolder;
            innerOptions.folder_name = resolvedFolderName;
            innerOptions.selectors = innerStep.selectors || [];
            
            // デバッグログ
            logger.event('debug.for.save_media.template', {
              presetId: id,
              containerId: actualContainerId,
              stepIndex: idx,
              loopIndex,
              innerStepIndex: innerIdx,
              rawDestinationFolder,
              rawFolderName,
              resolvedDestinationFolder: innerOptions.destination_folder,
              resolvedFolderName: innerOptions.folder_name,
              hasPrPostInfo: !!(innerTemplateVars.pr_post_info),
              prPostInfo: innerTemplateVars.pr_post_info
            }, 'info');
          }
          
          innerCmdPayload.options = innerOptions;
          
          // デバッグ: innerCmdPayload の内容を確認（save_media ステップの場合）
          if (innerStep.type === 'save_media') {
            logger.event('debug.for.save_media.payload', {
              presetId: id,
              containerId: actualContainerId,
              stepIndex: idx,
              loopIndex,
              innerStepIndex: innerIdx,
              innerCmdPayloadCommand: innerCmdPayload.command,
              hasOptions: !!(innerCmdPayload.options),
              optionsDestinationFolder: innerCmdPayload.options?.destination_folder,
              optionsFolderName: innerCmdPayload.options?.folder_name,
              optionsSelectorsCount: innerCmdPayload.options?.selectors ? innerCmdPayload.options.selectors.length : 0,
              innerCmdPayloadJson: JSON.stringify(innerCmdPayload).substring(0, 2000)
            }, 'info');
          }
          
          // waitステップの場合はサーバー側で処理
          if (innerCmdType === 'wait') {
            const msVal = (innerStep && typeof innerStep.ms === 'number' && innerStep.ms > 0) ? Number(innerStep.ms) : null;
            if (msVal) {
              await new Promise(r => setTimeout(r, msVal));
              return {
                ok: true,
                result: { waitedMs: msVal },
                error: null
              };
            }
            // selector待機の場合はコンテナブラウザに送信
          }
          
          // 内部ステップを直接コンテナブラウザに送信
          const innerExecUrl = `http://${host}:${port}/internal/exec`;
          const innerResp = await fetch(innerExecUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(innerCmdPayload)
          });
          
          const innerData = await innerResp.json().catch(() => ({ ok: false, error: 'invalid-json' }));
          
          // 内部ステップの結果を正規化
          const normalizedInnerData = {
            ok: !!innerData.ok,
            result: innerData.result || innerData.body || innerData,
            error: innerData.error || null
          };
          
          // result_varでinnerTemplateVarsに保存
          logger.event('debug.for.inner_step.result_var.check', {
            presetId: id,
            containerId: actualContainerId,
            stepIndex: idx,
            loopIndex,
            innerStepIndex: innerIdx,
            hasResultVar: !!innerStep.result_var,
            resultVar: innerStep.result_var || null,
            hasNormalizedData: !!(normalizedInnerData && normalizedInnerData.ok && normalizedInnerData.result),
            normalizedDataOk: !!(normalizedInnerData && normalizedInnerData.ok),
            hasResult: !!(normalizedInnerData && normalizedInnerData.result)
          }, 'info');
          
          if (innerStep.result_var && normalizedInnerData && normalizedInnerData.ok && normalizedInnerData.result) {
            const resultVar = applyTemplate(innerStep.result_var, innerTemplateVars);
            if (resultVar && typeof resultVar === 'string' && resultVar.trim() !== '') {
              // evalステップの場合、normalizedInnerData.result を保存
              // save_media ステップの場合、normalizedInnerData をそのまま保存
              // その他のステップでは normalizedInnerData.result を保存
              let valueToSave: any;
              if (innerStep.type === 'eval' && normalizedInnerData.result && typeof normalizedInnerData.result === 'object') {
                valueToSave = normalizedInnerData.result;
              } else if (innerStep.type === 'save_media' && normalizedInnerData && typeof normalizedInnerData === 'object') {
                valueToSave = normalizedInnerData;
              } else {
                valueToSave = normalizedInnerData.result;
              }
              
              // pr_post_info が既に存在する場合（navigateステップで設定された場合）、マージする
              if (resultVar === 'pr_post_info') {
                logger.event('debug.for.inner_step.result_var.merge_check', {
                  presetId: id,
                  containerId: actualContainerId,
                  stepIndex: idx,
                  loopIndex,
                  innerStepIndex: innerIdx,
                  resultVar,
                  hasExistingPrPostInfo: !!(currentTemplateVars.pr_post_info),
                  existingPrPostInfoType: typeof currentTemplateVars.pr_post_info,
                  existingPrPostInfoKeys: currentTemplateVars.pr_post_info && typeof currentTemplateVars.pr_post_info === 'object' ? Object.keys(currentTemplateVars.pr_post_info) : null,
                  hasValueToSave: !!valueToSave,
                  valueToSaveType: typeof valueToSave,
                  valueToSaveKeys: valueToSave && typeof valueToSave === 'object' ? Object.keys(valueToSave) : null,
                  willMerge: !!(currentTemplateVars.pr_post_info && typeof currentTemplateVars.pr_post_info === 'object' && valueToSave && typeof valueToSave === 'object')
                }, 'info');
                
                if (currentTemplateVars.pr_post_info && typeof currentTemplateVars.pr_post_info === 'object' && valueToSave && typeof valueToSave === 'object') {
                  currentTemplateVars[resultVar] = { ...currentTemplateVars.pr_post_info, ...valueToSave };
                  logger.event('debug.for.inner_step.result_var.merged', {
                    presetId: id,
                    containerId: actualContainerId,
                    stepIndex: idx,
                    loopIndex,
                    innerStepIndex: innerIdx,
                    resultVar,
                    mergedKeys: Object.keys(currentTemplateVars[resultVar]),
                    mergedPrPostInfo: currentTemplateVars[resultVar]
                  }, 'info');
                } else {
                  currentTemplateVars[resultVar] = valueToSave;
                  logger.event('debug.for.inner_step.result_var.not_merged', {
                    presetId: id,
                    containerId: actualContainerId,
                    stepIndex: idx,
                    loopIndex,
                    innerStepIndex: innerIdx,
                    resultVar,
                    reason: !currentTemplateVars.pr_post_info ? 'no_existing' : (typeof currentTemplateVars.pr_post_info !== 'object' ? 'not_object' : (!valueToSave ? 'no_value' : 'not_object_value'))
                  }, 'info');
                }
              } else {
                currentTemplateVars[resultVar] = valueToSave;
              }
              
              logger.event('debug.for.inner_step.result_var.saved', {
                presetId: id,
                containerId: actualContainerId,
                stepIndex: idx,
                loopIndex,
                innerStepIndex: innerIdx,
                resultVar,
                hasValue: !!valueToSave,
                valueType: typeof valueToSave,
                isPrSearchResults: resultVar === 'pr_search_results',
                isPrSaveResult: resultVar === 'pr_save_result' || resultVar.includes('save_result'),
                valuePostsCount: (valueToSave && typeof valueToSave === 'object' && 'posts' in valueToSave && Array.isArray(valueToSave.posts)) ? valueToSave.posts.length : null
              }, 'info');
              
              // pr_save_resultが設定された場合、pr_search_resultsをDBに保存
              if (resultVar === 'pr_save_result' || resultVar.includes('save_result')) {
                logger.event('debug.for.save_posts.triggered', {
                  presetId: id,
                  containerId: actualContainerId,
                  stepIndex: idx,
                  loopIndex,
                  innerStepIndex: innerIdx,
                  resultVar,
                  hasPrSearchResults: !!(innerTemplateVars.pr_search_results),
                  prSearchResultsType: typeof innerTemplateVars.pr_search_results,
                  prSearchResultsPostsCount: (innerTemplateVars.pr_search_results && innerTemplateVars.pr_search_results.posts && Array.isArray(innerTemplateVars.pr_search_results.posts)) ? innerTemplateVars.pr_search_results.posts.length : null
                }, 'info');
                try {
                  const searchResults = innerTemplateVars.pr_search_results;
                  logger.event('debug.for.save_posts.start', {
                    presetId: id,
                    containerId: actualContainerId,
                    stepIndex: idx,
                    loopIndex,
                    innerStepIndex: innerIdx,
                    hasSearchResults: !!searchResults,
                    hasPosts: !!(searchResults && searchResults.posts),
                    postsCount: (searchResults && searchResults.posts && Array.isArray(searchResults.posts)) ? searchResults.posts.length : 0,
                    maxPosts,
                    totalSaved
                  }, 'info');
                  
                  if (searchResults && searchResults.posts && Array.isArray(searchResults.posts)) {
                    let saved = 0;
                    let skipped = 0;
                    
                    for (const post of searchResults.posts) {
                      try {
                        if (!post.post_url || !post.content) {
                          skipped++;
                          continue;
                        }
                        
                        // max_postsに達している場合はスキップ
                        if (maxPosts !== null && totalSaved >= maxPosts) {
                          skipped++;
                          continue;
                        }
                        
                        // 重複チェック（source_urlをユニークキーとして使用）
                        const existing = dbQuery<any>(
                          'SELECT id FROM post_library WHERE source_url = ? LIMIT 1',
                          [post.post_url]
                        )[0];
                        
                        if (existing) {
                          skipped++;
                          continue;
                        }
                        
                        // post_libraryテーブルに保存
                        const now = Date.now();
                        // URLからaccount_idとpost_id_threadsを抽出
                        let accountId: string | null = null;
                        let postIdThreads: string | null = null;
                        const urlMatch = post.post_url.match(/@([^\/]+)\/post\/([A-Za-z0-9]+)/);
                        if (urlMatch && urlMatch.length >= 3) {
                          accountId = urlMatch[1];
                          postIdThreads = urlMatch[2];
                        }
                        dbRun(
                          'INSERT INTO post_library (content, used, source_url, account_id, post_id_threads, like_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                          [
                            post.content,
                            0,
                            post.post_url,
                            accountId,
                            postIdThreads,
                            typeof post.like_count === 'number' ? post.like_count : null,
                            now,
                            now
                          ]
                        );
                        saved++;
                        totalSaved++;
                        
                        // max_postsに達した場合はループを終了
                        if (maxPosts !== null && totalSaved >= maxPosts) {
                          break;
                        }
                      } catch (postErr: any) {
                        if (String(postErr?.message || '').includes('UNIQUE constraint') || String(postErr?.message || '').includes('unique constraint')) {
                          skipped++;
                          continue;
                        }
                        skipped++;
                      }
                    }
                    
                    innerTemplateVars.pr_save_result = {
                      saved,
                      skipped,
                      total: searchResults.posts.length,
                      totalSaved
                    };
                    
                    logger.event('debug.for.save_posts.completed', {
                      presetId: id,
                      containerId: actualContainerId,
                      stepIndex: idx,
                      loopIndex,
                      innerStepIndex: innerIdx,
                      saved,
                      skipped,
                      total: searchResults.posts.length,
                      totalSaved
                    }, 'info');
                  } else {
                    logger.event('debug.for.save_posts.no_posts', {
                      presetId: id,
                      containerId: actualContainerId,
                      stepIndex: idx,
                      loopIndex,
                      innerStepIndex: innerIdx,
                      hasSearchResults: !!searchResults,
                      searchResultsType: typeof searchResults,
                      hasPosts: !!(searchResults && searchResults.posts),
                      postsIsArray: !!(searchResults && searchResults.posts && Array.isArray(searchResults.posts))
                    }, 'warn');
                  }
                } catch (saveErr: any) {
                  logger.event('debug.for.save_posts.error', {
                    presetId: id,
                    containerId: actualContainerId,
                    stepIndex: idx,
                    loopIndex,
                    innerStepIndex: innerIdx,
                    error: String(saveErr?.message || saveErr)
                  }, 'error');
                  
                  innerTemplateVars.pr_save_result = {
                    saved: 0,
                    skipped: 0,
                    total: 0,
                    error: String(saveErr?.message || saveErr)
                  };
                }
              }
            }
          }
          
          // templateVarsFinalを更新
          Object.assign(templateVarsFinal, innerTemplateVars);
          
          return normalizedInnerData;
        };
        
        for (let loopIndex = 0; loopIndex < count; loopIndex++) {
          logger.event('debug.for.iteration', {
            presetId: id,
            containerId: actualContainerId,
            stepIndex: idx,
            loopIndex,
            loopCount: loopIndex + 1,
            max_posts: maxPosts,
            totalSaved
          }, 'info');
          
          const iterationResults: any[] = [];
          let iterationError: string | null = null;
          
          // ループごとのテンプレート変数（内部ステップ間で共有）
          const loopTemplateVars = Object.assign({}, templateVarsFinal, {
            loop_index: loopIndex,
            loop_count: loopIndex + 1
          });
          
          // 内部ステップを実行
          for (let innerIdx = 0; innerIdx < innerSteps.length; innerIdx++) {
            const innerStep = innerSteps[innerIdx];
            try {
              const innerResp = await executeInnerStep(innerStep, innerIdx, loopIndex, loopTemplateVars);
              iterationResults.push({ stepIndex: innerIdx, step: innerStep, result: innerResp });
              
              if (!innerResp || !innerResp.ok) {
                iterationError = `Inner step ${innerIdx} failed: ${JSON.stringify(innerResp?.error || innerResp)}`;
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
          
          // エラーが発生した場合はループを中断
          if (iterationError) {
            break;
          }
          
          // max_postsに達した場合はループを終了
          if (maxPosts !== null && totalSaved >= maxPosts) {
            logger.event('debug.for.early_exit', {
              presetId: id,
              containerId: actualContainerId,
              stepIndex: idx,
              loopIndex,
              totalSaved,
              maxPosts
            }, 'info');
            break;
          }
        }
        
        const result = {
          count,
          maxPosts,
          iterations: forResults,
          completed: forResults.length,
          totalSaved
        };
        
        return res.json({
          ok: true,
          result: {
            ok: true,
            body: result,
            didAction: true,
            reason: `Completed ${forResults.length} iterations, saved ${totalSaved} posts`
          },
          sentPayload: cmdPayload,
          execUrl: 'server-side (for step)'
        });
      } catch (e: any) {
        logger.event('debug.for.err', {
          presetId: id,
          containerId: actualContainerId,
          stepIndex: idx,
          error: String(e?.message || e)
        }, 'error');
        return res.status(500).json({
          ok: false,
          error: 'for step failed: ' + String(e?.message || e),
          stepIndex: idx
        });
      }
    }

    // special-case: handle 'wait' on server side for debug-step (export-server may not support it)
    if (cmdType === 'wait') {
      // ms-based wait
      const msVal = (st && typeof st.ms === 'number' && st.ms > 0) ? Number(st.ms) : (req.body && req.body.options && typeof req.body.options.ms === 'number' ? Number(req.body.options.ms) : null);
      if (msVal) {
        await new Promise(r => setTimeout(r, msVal));
        const out = { ok: true, result: { waitedMs: msVal } };
        return res.json({ ok: true, result: out, sentPayload: cmdPayload, execUrl: url });
      }
      const selector = (st && (st.selector || (st.options && st.options.waitForSelector))) || (req.body && req.body.options && req.body.options.waitForSelector) || null;
      if (!selector) return res.status(400).json({ ok: false, error: 'wait requires ms or selector', stepIndex: idx });
      const timeoutMs = Number(cmdPayload.options && cmdPayload.options.timeoutMs ? cmdPayload.options.timeoutMs : 15000);
      const start = Date.now();
      let found = false;
      let lastResp = null;
      while (Date.now() - start < timeoutMs) {
        try {
          const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contextId: actualContainerId, command: 'eval', eval: `!!document.querySelector(${JSON.stringify(selector)})` }) });
          const parsed = await r.json().catch(() => null);
          lastResp = parsed;
          // normalize possible responses: true, "true", { body: true }, { result: { found: true } }, { ok:true, body:true }, etc.
          const isTrue = parsed === true || parsed === 'true' || (parsed && (parsed.body === true || parsed.result === true || parsed === true || parsed.ok === true && (parsed.body === true || parsed.result === true)));
          if (isTrue) { found = true; break; }
        } catch (e) {
          // ignore and retry
        }
        await new Promise(r => setTimeout(r, 500));
      }
      const out = { ok: found, result: { found, lastResp } };
      return res.json({ ok: found, result: out, sentPayload: cmdPayload, execUrl: url });
    }

    // forward other commands to exec server
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cmdPayload),
    });
    const rawText = await resp.text();
    let data: any;
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      data = { ok: false, error: 'invalid-json', rawResponsePreview: rawText ? String(rawText).slice(0, 500) : '(empty)' };
    }
    try { logger.event('debug.exec_response', { presetId: id, containerId, stepIndex: idx, httpStatus: resp.status, response: data }, 'debug'); } catch (e) {}
    const sanitizeResponse = (() => {
      if (!data || typeof data !== 'object') return data;
      try {
        const copy = JSON.parse(JSON.stringify(data));
        if (copy && typeof copy === 'object') {
          if (copy.html) delete copy.html;
          if (copy.result && typeof copy.result === 'object' && copy.result.html) delete copy.result.html;
        }
        return copy;
      } catch {
        return data;
      }
    })();
    try {
      logger.event(
        'debug.exec_response_summary',
        { presetId: id, containerId, stepIndex: idx, httpStatus: resp.status, ok: resp.ok, response: sanitizeResponse },
        resp.ok ? 'info' : 'warn'
      );
    } catch (e) {}
    const ok = !!data.ok;
    const commandResult = {
      command: data?.command || cmdType,
      result: data?.result ?? null,
      didAction: Boolean(data?.result?.didAction),
      selector: data?.result?.selector ?? data?.selector ?? null,
      reason: data?.result?.reason ?? null,
      elapsedMs: Number(data?.result?.elapsedMs ?? data?.elapsedMs ?? null),
    };
    if (!ok) return res.status(500).json({ ok:false, error: data.error || 'step failed', result: data, commandResult, sentPayload: cmdPayload, execUrl: url });

    // Debug-step: perform expected checks (urlContains / htmlContains) similar to normal execution.
    if (st && st.expected) {
      const exp = st.expected;
      // normalize actual url from possible locations
      // Container Browserのレスポンス構造: { ok: true, body: { result: { url: "..." } } }
      let actualUrl = '';
      try {
        // 優先順位1: data.body.result.url (Container Browserの標準的なレスポンス構造)
        if (data && data.body && data.body.result && typeof data.body.result.url === 'string') {
          actualUrl = String(data.body.result.url);
        }
        // 優先順位2: data.body.url (navigateコマンドの直接的なレスポンス)
        else if (data && data.body && typeof data.body.url === 'string') {
          actualUrl = String(data.body.url);
        }
        // 優先順位3: data.result.url (後方互換性)
        else if (data && data.result && typeof data.result.url === 'string') {
          actualUrl = String(data.result.url);
        }
        // 優先順位4: data.url (トップレベルのurl)
        else if (data && typeof data.url === 'string') {
          actualUrl = String(data.url);
        }
        // 優先順位5: data.commandResult.result.url (commandResult経由)
        else if (data && data.commandResult && data.commandResult.result && typeof data.commandResult.result.url === 'string') {
          actualUrl = String(data.commandResult.result.url);
        }
        // 優先順位6: data.resultが文字列の場合
        else if (data && data.result && typeof data.result === 'string') {
          actualUrl = String(data.result);
        }
      } catch (e) { 
        actualUrl = String((data && data.url) || (data && data.body && data.body.url) || ''); 
      }

      // navigateコマンドでURLが空文字列またはabout:blankの場合、postWaitSecondsの待機後にevalでURLを取得
      if (cmdType === 'navigate' && (!actualUrl || actualUrl.trim() === '' || actualUrl === 'about:blank') && st.postWaitSeconds && typeof st.postWaitSeconds === 'number' && st.postWaitSeconds > 0) {
        try {
          // postWaitSecondsの待機
          await new Promise(r => setTimeout(r, Math.round(st.postWaitSeconds * 1000)));
          
          // evalコマンドでwindow.location.hrefを取得
          const evalResp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contextId: actualContainerId,
              command: 'eval',
              eval: 'window.location.href'
            }),
          });
          const evalData = await evalResp.json().catch(() => null);
          
          // evalの結果からURLを取得
          if (evalData && evalData.ok) {
            const evalResult = evalData.result || evalData.body?.result || evalData.body;
            if (typeof evalResult === 'string' && evalResult.trim() !== '') {
              actualUrl = String(evalResult);
              try { logger.event('debug.url.retrieved_after_wait', { presetId: id, stepIndex: idx, url: actualUrl, postWaitSeconds: st.postWaitSeconds }, 'debug'); } catch (e) {}
            }
          }
        } catch (e: any) {
          try { logger.event('debug.url.retrieve_after_wait.err', { presetId: id, stepIndex: idx, err: String(e?.message || e) }, 'warn'); } catch (e2) {}
        }
      }

      try { logger.event('debug.expected.url.check', { presetId: id, stepIndex: idx, expected: exp.urlContains || null, actual: actualUrl }, 'debug'); } catch (e) {}

      let expectedToCheck = exp.urlContains;
      if (expectedToCheck && templateVarsFinal) {
        try {
          expectedToCheck = applyTemplate(expectedToCheck, templateVarsFinal);
        } catch (e:any) {
          // ignore template errors and use raw value
        }
      }
      if (expectedToCheck && !String(actualUrl).includes(String(expectedToCheck))) {
        return res.status(500).json({ ok:false, error: 'expected url not matched', got: actualUrl || null, expected: String(expectedToCheck), result: data, commandResult, sentPayload: cmdPayload, execUrl: url });
      }

      if (exp.htmlContains) {
        let actualHtml = '';
        try {
          if (data && typeof data.html === 'string') actualHtml = data.html;
          else if (data && data.result && typeof data.result.html === 'string') actualHtml = data.result.html;
        } catch (e) { actualHtml = ''; }
        if (!(actualHtml || '').includes(String(exp.htmlContains))) {
          return res.status(500).json({ ok:false, error: 'expected html not matched', result: data, commandResult, sentPayload: cmdPayload, execUrl: url });
        }
      }
    }

    // ステップの結果をtemplateVarsFinalに追加（result_varが指定されている場合）
    const resultVar = st.result_var || st.resultVar;
    if (resultVar && typeof resultVar === 'string' && resultVar.trim() !== '' && data && data.ok) {
      if (!templateVarsFinal) {
        templateVarsFinal = {};
      }
      
      // evalステップの場合、data.resultを保存
      // result_var が pr_auth_tokens かつ options.returnCookies のときは data.cookies から auth_token/ct0 を抽出
      // save_mediaステップの場合、data.resultを保存（save_mediaのレスポンスはdata.resultに含まれる）
      // その他のステップではdata.resultを保存
      let valueToSave: any;
      if (resultVar === 'pr_auth_tokens' && cmdType === 'eval' && Array.isArray((data as { cookies?: Array<{ name?: string; value?: string }> }).cookies) && st.options && (st.options as Record<string, unknown>).returnCookies) {
        const cookies = (data as { cookies: Array<{ name?: string; value?: string }> }).cookies;
        const authEntry = cookies.find((c) => c && c.name === 'auth_token');
        const ct0Entry = cookies.find((c) => c && c.name === 'ct0');
        if (authEntry && typeof authEntry.value === 'string' && ct0Entry && typeof ct0Entry.value === 'string') {
          valueToSave = { auth_token: authEntry.value, ct0: ct0Entry.value };
        } else {
          valueToSave = data.result;
        }
      } else if (cmdType === 'eval' && data.result && typeof data.result === 'object') {
        valueToSave = data.result;
      } else if (cmdType === 'save_media' && data.result && typeof data.result === 'object') {
        // save_mediaのレスポンスは { ok, folder_path, files, summary } 形式でdata.resultに含まれる
        valueToSave = data.result;
      } else {
        valueToSave = data.result;
      }
      
      templateVarsFinal[resultVar] = valueToSave;
      
      // pr_follower_dataからpr_follower_countとpr_following_countを抽出
      if (resultVar === 'pr_follower_data' && valueToSave && typeof valueToSave === 'object') {
        if (typeof valueToSave.followerCount === 'number') {
          templateVarsFinal.pr_follower_count = valueToSave.followerCount;
        }
        if (typeof valueToSave.followingCount === 'number') {
          templateVarsFinal.pr_following_count = valueToSave.followingCount;
        }
      }
      
      // pr_save_resultが設定された場合、pr_media_resultまたはpr_search_resultsをDBに保存
      if (resultVar === 'pr_save_result' || resultVar.includes('save_result')) {
          try {
            // ケース1: Threads メディア保存（pr_media_result がある場合）
            const mediaResult = templateVarsFinal.pr_media_result || 
                                (params && params.pr_media_result) ||
                                (req.body.gatheredVars && req.body.gatheredVars.pr_media_result);
            
            if (mediaResult) {
              const postInfo = templateVarsFinal.pr_post_info || 
                               (params && params.pr_post_info) ||
                               (req.body.gatheredVars && req.body.gatheredVars.pr_post_info);
              
              logger.event('debug.save_media.check', {
                presetId: id,
                stepIndex: idx,
                innerStepIndex: innerStepIdx,
                isInnerStep,
                resultVar,
                hasPrMediaResult: !!mediaResult,
                hasPrPostInfo: !!postInfo,
                postLibraryId: postInfo?.post_library_id,
                mediaCount: mediaResult.summary?.succeeded || 0
              }, 'info');
              
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
                logger.event('debug.save_media.db_updated', {
                  presetId: id,
                  stepIndex: idx,
                  innerStepIndex: innerStepIdx,
                  isInnerStep,
                  media_count: mediaResult.summary?.succeeded || 0,
                  post_library_id: postInfo.post_library_id,
                  account_id: postInfo.account_id,
                  post_id: postInfo.post_id
                }, 'info');
              }
            }
            
            // ケース2: Threads 投稿検索結果保存（pr_search_results がある場合、forステップ内のみ）
            if (isInnerStep) {
              const searchResults = templateVarsFinal.pr_search_results || 
                                    (params && params.pr_search_results) ||
                                    (req.body.gatheredVars && req.body.gatheredVars.pr_search_results);
              
              logger.event('debug.save_posts.check', {
                presetId: id,
                stepIndex: idx,
                innerStepIndex: innerStepIdx,
                isInnerStep,
                resultVar,
                hasPrSearchResults: !!templateVarsFinal.pr_search_results,
                hasParamsPrSearchResults: !!(params && params.pr_search_results),
                hasGatheredVarsPrSearchResults: !!(req.body.gatheredVars && req.body.gatheredVars.pr_search_results),
                hasSearchResults: !!searchResults,
                searchResultsPostsCount: searchResults && searchResults.posts ? searchResults.posts.length : 0
              }, 'debug');
              
              if (searchResults && searchResults.posts && Array.isArray(searchResults.posts)) {
              let saved = 0;
              let skipped = 0;
              
              for (const post of searchResults.posts) {
                try {
                  if (!post.post_url || !post.content) {
                    skipped++;
                    continue;
                  }
                  
                  // 重複チェック（source_urlをユニークキーとして使用）
                  const existing = dbQuery<any>(
                    'SELECT id FROM post_library WHERE source_url = ? LIMIT 1',
                    [post.post_url]
                  )[0];
                  
                  if (existing) {
                    skipped++;
                    continue;
                  }
                  
                  // post_libraryテーブルに保存
                  const now = Date.now();
                  // URLからaccount_idとpost_id_threadsを抽出
                  let accountId: string | null = null;
                  let postIdThreads: string | null = null;
                  const urlMatch = post.post_url.match(/@([^\/]+)\/post\/([A-Za-z0-9]+)/);
                  if (urlMatch && urlMatch.length >= 3) {
                    accountId = urlMatch[1];
                    postIdThreads = urlMatch[2];
                  }
                  dbRun(
                    'INSERT INTO post_library (content, used, source_url, account_id, post_id_threads, like_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                    [
                      post.content,
                      0,
                      post.post_url,
                      accountId,
                      postIdThreads,
                      typeof post.like_count === 'number' ? post.like_count : null,
                      now,
                      now
                    ]
                  );
                  saved++;
                } catch (postErr: any) {
                  if (String(postErr?.message || '').includes('UNIQUE constraint') || String(postErr?.message || '').includes('unique constraint')) {
                    skipped++;
                    continue;
                  }
                  skipped++;
                }
              }
              
              templateVarsFinal.pr_save_result = {
                saved,
                skipped,
                total: searchResults.posts.length
              };
              
              logger.event('debug.save_posts.success', {
                presetId: id,
                stepIndex: idx,
                innerStepIndex: innerStepIdx,
                saved,
                skipped,
                total: searchResults.posts.length
              }, 'info');
              }
            }
          } catch (saveErr: any) {
            templateVarsFinal.pr_save_result = {
              saved: 0,
              skipped: 0,
              total: 0,
              error: String(saveErr?.message || saveErr)
            };
            logger.event('debug.save_posts.error', {
              presetId: id,
              stepIndex: idx,
              innerStepIndex: innerStepIdx,
              error: String(saveErr?.message || saveErr)
            }, 'error');
          }
        }
      
      // pr_auth_tokensが設定された場合、x_accountsテーブルを更新
      if (resultVar === 'pr_auth_tokens') {
        logger.event('debug.auth_tokens.check', {
          presetId: id,
          stepIndex: idx,
          innerStepIndex: innerStepIdx,
          resultVar,
          hasValueToSave: !!valueToSave,
          valueToSaveType: typeof valueToSave,
          hasAuthToken: !!(valueToSave && typeof valueToSave === 'object' && valueToSave.auth_token),
          hasCt0: !!(valueToSave && typeof valueToSave === 'object' && valueToSave.ct0),
          valueToSaveKeys: valueToSave && typeof valueToSave === 'object' ? Object.keys(valueToSave) : null
        }, 'debug');
      }
      
      if (resultVar === 'pr_auth_tokens' && valueToSave && typeof valueToSave === 'object' && valueToSave.auth_token && valueToSave.ct0) {
        try {
          // containerIdからコンテナ名を取得（UUID形式の場合はコンテナ名に変換）
          let xAccountContainerId = String(actualContainerId || containerId || '');
          const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(xAccountContainerId);
          
          if (isUuid) {
            try {
              const dbPath = defaultContainerDb();
              if (fs.existsSync(dbPath)) {
                const containerDb = new Database(dbPath, { readonly: true });
                const containerRow = containerDb.prepare('SELECT name FROM containers WHERE id = ? LIMIT 1').get(xAccountContainerId);
                if (containerRow && containerRow.name) {
                  xAccountContainerId = String(containerRow.name);
                }
                containerDb.close();
              }
            } catch (e: any) {
              logger.event('debug.auth_tokens.container_name_resolve_err', { presetId: id, stepIndex: idx, containerId: xAccountContainerId, err: String(e?.message || e) }, 'warn');
            }
          }
          
          if (xAccountContainerId && xAccountContainerId.trim() !== '') {
            const now = Date.now();
            // レコードが存在するか確認
            const existing = dbQuery<any>('SELECT container_id FROM x_accounts WHERE container_id = ? LIMIT 1', [xAccountContainerId])[0];
            
            if (existing) {
              // レコードが存在する場合はUPDATE
              dbRun(
                'UPDATE x_accounts SET auth_token = ?, ct0 = ?, updated_at = ? WHERE container_id = ?',
                [String(valueToSave.auth_token), String(valueToSave.ct0), now, xAccountContainerId]
              );
            } else {
              // レコードが存在しない場合はINSERT
              dbRun(
                'INSERT INTO x_accounts(container_id, auth_token, ct0, created_at, updated_at) VALUES(?, ?, ?, ?, ?)',
                [xAccountContainerId, String(valueToSave.auth_token), String(valueToSave.ct0), now, now]
              );
            }
            
            logger.event('debug.auth_tokens.saved', {
              presetId: id,
              stepIndex: idx,
              innerStepIndex: innerStepIdx,
              containerId: xAccountContainerId,
              hasAuthToken: !!valueToSave.auth_token,
              hasCt0: !!valueToSave.ct0,
              action: existing ? 'updated' : 'inserted'
            }, 'info');
          } else {
            logger.event('debug.auth_tokens.save_skipped', {
              presetId: id,
              stepIndex: idx,
              innerStepIndex: innerStepIdx,
              containerId: actualContainerId || containerId,
              reason: 'container_id is empty'
            }, 'warn');
          }
        } catch (saveErr: any) {
          logger.event('debug.auth_tokens.save_error', {
            presetId: id,
            stepIndex: idx,
            innerStepIndex: innerStepIdx,
            containerId: actualContainerId || containerId,
            error: String(saveErr?.message || saveErr)
          }, 'error');
        }
      }
      
      // プリセット44（Xメールアドレス取得・更新）のステップ3（index 2）で取得したメールアドレスをx_accountsテーブルに保存
      if (id === 44 && idx === 2 && cmdType === 'eval' && data && data.ok) {
        try {
          // メールアドレスを取得
          const body = data as any;
          const resultData = (body.result && typeof body.result === 'object') ? body.result : body;
          const currentEmail = templateVarsFinal?.pr_current_email || resultData.email || (typeof resultData === 'string' && resultData.includes('@') ? resultData : null);
          
          if (currentEmail && typeof currentEmail === 'string' && currentEmail.trim() !== '' && currentEmail.includes('@') && currentEmail !== '{{pr_current_email}}') {
            const trimmedCurrentEmail = currentEmail.trim();

            // containerIdからコンテナ名を取得
            let containerNameForUpdate: string | null = templateVarsFinal?.db_container_name || templateVarsFinal?.container_name || null;

            if (!containerNameForUpdate && containerId) {
              const containerIdStr = String(containerId);
              const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(containerIdStr);

              if (isUuid) {
                try {
                  const containerDbPath = defaultContainerDb();
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
                    'debug.email.fetch.save.container_name_err',
                    { presetId: id, stepIndex: idx, containerId: containerIdStr, err: String(e?.message || e) },
                    'warn'
                  );
                }
              } else {
                containerNameForUpdate = containerIdStr;
              }
            }

            if (!containerNameForUpdate) {
              logger.event('debug.email.fetch.save.container_name_not_found', { presetId: id, stepIndex: idx, containerId: actualContainerId || containerId }, 'warn');
            } else {
              // email_accountsテーブルでメールアドレスを検索
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

                dbRun('UPDATE x_accounts SET email = ?, email_password = ?, updated_at = ? WHERE container_id = ?', [
                  email,
                  emailCredential,
                  now,
                  containerNameForUpdate
                ]);

                logger.event('debug.email.fetch.saved', {
                  presetId: id,
                  stepIndex: idx,
                  containerId: actualContainerId || containerId,
                  containerName: containerNameForUpdate,
                  email: email.substring(0, 20) + '...',
                  emailAccountId: emailAccount.id
                }, 'info');
              } else {
                logger.event('debug.email.fetch.not_found_in_email_accounts', {
                  presetId: id,
                  stepIndex: idx,
                  email: trimmedCurrentEmail.substring(0, 20) + '...'
                }, 'warn');
              }
            }
          }
        } catch (e: any) {
          logger.event('debug.email.fetch.save.err', {
            presetId: id,
            stepIndex: idx,
            err: String(e?.message || e)
          }, 'error');
        }
      }
      
      logger.event('debug.eval_result_var.set', {
        presetId: id,
        stepIndex: idx,
        innerStepIndex: innerStepIdx,
        resultVar,
        hasResult: !!data.result,
      }, 'debug');
    }

    res.json({ ok:true, result: data, commandResult, sentPayload: cmdPayload, execUrl: url, templateVars: templateVarsFinal });
  } catch (e:any) {
    res.status(500).json({ ok:false, error: String(e?.message||e) });
  }
});

// Run preset with overrides (containerId, url/accountUrl, schedule)
app.post('/api/presets/:id/run-with-overrides', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok:false, error: 'id required' });
    const preset = PresetService.getPreset(id) as any;
    if (!preset) return res.status(404).json({ ok:false, error: 'preset not found' });
    const { containerId, url, accountUrl, runAt } = req.body || {};
    if (!containerId) return res.status(400).json({ ok:false, error: 'containerId required' });
    const overrides: any = {};
    const overrideVars: Record<string, any> = {};
    if (url) {
      overrides.url = url;
      overrideVars.url = url;
    }
    if (accountUrl) {
      overrides.accountUrl = accountUrl;
      overrideVars.accountUrl = accountUrl;
    }
    if (Object.keys(overrideVars).length) {
      overrides.vars = Object.assign({}, overrides.vars || {}, overrideVars);
    }
    const scheduledAt = runAt ? Date.parse(String(runAt)) : undefined;
    const queueName = (req.body?.queueName as string) || 'default';
    const runId = enqueueTask({ presetId: id, containerId, overrides, scheduledAt }, queueName);
    // if scheduledAt in future, schedule enqueue later - enqueueTask currently starts worker immediately; for scheduling, caller may submit at appropriate time
    res.json({ ok:true, runId });
  } catch (e:any) { logger.event('preset.run.override.err', { err: String(e?.message||e) }, 'error'); res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

// Return template vars needed by a preset (scan {{var}} in steps)
app.get('/api/ai/needed-vars', (req, res) => {
  try {
    const pid = Number(req.query.presetId || 0);
    if (!pid) return res.status(400).json({ ok:false, error: 'presetId required' });
    const p = PresetService.getPreset(pid) as any;
    if (!p) return res.status(404).json({ ok:false, error: 'preset not found' });
    const steps = JSON.parse(p.steps_json || '[]');
    const re = /\{\{([A-Za-z0-9_-]+)\}\}/g;
    const vars = new Set<string>();
    for (const s of steps) {
      if (s.url) { let m; while ((m = re.exec(s.url)) !== null) vars.add(m[1]); }
      if (s.selector) { let m; while ((m = re.exec(s.selector)) !== null) vars.add(m[1]); }
      if (s.code || s.eval) { 
        const codeStr = String(s.code || s.eval || '');
        let m; while ((m = re.exec(codeStr)) !== null) vars.add(m[1]);
      }
      // containerステップのcontainer_nameフィールドから検出
      if (s.container_name || s.containerName) {
        const containerNameStr = String(s.container_name || s.containerName || '');
        let m; while ((m = re.exec(containerNameStr)) !== null) vars.add(m[1]);
      }
      // containerステップがある場合、自動的にproxyパラメータを検出
      if (s.type === 'container' || s.type === 'open_container') {
        vars.add('proxy');
      }
      // containerステップのproxyフィールドから検出（明示的に指定されている場合）
      if (s.proxy) {
        const proxyStr = String(s.proxy || '');
        let m; while ((m = re.exec(proxyStr)) !== null) vars.add(m[1]);
      }
      // navigateステップのproxyフィールドから検出
      if (s.type === 'navigate' && s.proxy) {
        const proxyStr = String(s.proxy || '');
        let m; while ((m = re.exec(proxyStr)) !== null) vars.add(m[1]);
      }
    }
    res.json({ ok:true, vars: Array.from(vars) });
  } catch (e:any) { logger.event('api.ai.neededvars.err', { err: String(e?.message||e) }, 'error'); res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

// AI-created task endpoint: accepts proposal and registers task
const parseWaitMinutes = (val: unknown) => {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed === '') return 10;
    const parsed = Number(trimmed);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 10;
};

function collectTemplateVarsFromSteps(steps: any[]) {
  if (!Array.isArray(steps) || !steps.length) return [];
  const re = /\{\{([A-Za-z0-9_-]+)\}\}/g;
  const vars = new Set<string>();
  
  // 各ステップを個別にチェック（より確実に検出するため）
  for (const s of steps) {
    // url, selector, code, eval フィールドをチェック
    if (s.url) { let m; while ((m = re.exec(String(s.url))) !== null) vars.add(m[1]); }
    if (s.selector) { let m; while ((m = re.exec(String(s.selector))) !== null) vars.add(m[1]); }
    if (s.code || s.eval) {
      const codeStr = String(s.code || s.eval || '');
      let m; while ((m = re.exec(codeStr)) !== null) vars.add(m[1]);
    }
    // containerステップのcontainer_nameフィールドから検出
    if (s.container_name || s.containerName) {
      const containerNameStr = String(s.container_name || s.containerName || '');
      let m; while ((m = re.exec(containerNameStr)) !== null) vars.add(m[1]);
    }
    // containerステップがある場合、自動的にproxyパラメータを検出
    if (s.type === 'container' || s.type === 'open_container') {
      vars.add('proxy');
    }
    // containerステップのproxyフィールドから検出（明示的に指定されている場合）
    if (s.proxy) {
      const proxyStr = String(s.proxy || '');
      let m; while ((m = re.exec(proxyStr)) !== null) vars.add(m[1]);
    }
    // navigateステップのproxyフィールドから検出
    if (s.type === 'navigate' && s.proxy) {
      const proxyStr = String(s.proxy || '');
      let m; while ((m = re.exec(proxyStr)) !== null) vars.add(m[1]);
    }
    // params内のフィールドもチェック
    if (s.params && typeof s.params === 'object') {
      const paramsStr = JSON.stringify(s.params);
      let m; while ((m = re.exec(paramsStr)) !== null) vars.add(m[1]);
    }
  }
  
  // フォールバック: JSON全体からも検出（既存の動作を維持）
  const json = JSON.stringify(steps);
  let match;
  while ((match = re.exec(json)) !== null) {
    if (match[1]) vars.add(match[1]);
  }
  
  return Array.from(vars);
}

function gatherOverrideVars(overrides: any) {
  const provided: Record<string, any> = {};
  if (!overrides || typeof overrides !== 'object') return provided;
  const merge = (source: any) => {
    if (!source || typeof source !== 'object') return;
    Object.keys(source).forEach((key) => {
      if (source[key] !== undefined) provided[key] = source[key];
    });
  };
  merge(overrides.vars);
  merge(overrides.params);
  merge(overrides.payload);
  merge(overrides.overrides);
  Object.keys(overrides).forEach((key) => {
    if (!['vars', 'params', 'payload', 'overrides'].includes(key)) {
      const value = overrides[key];
      if (value !== undefined) provided[key] = value;
    }
  });
  return provided;
}

app.post('/api/ai/create-task', async (req, res) => {
  try {
    const { sessionId, presetId, containerId, containerIds, groupId, overrides, params, runMode, runAt, scheduledAt: scheduledAtOverride, dryRun, queueName } = req.body || {};
    if (!presetId) return res.status(400).json({ ok:false, error: 'presetId required' });
    const pid = Number(presetId);
    const preset = PresetService.getPreset(pid) as any;
    if (!preset) return res.status(404).json({ ok:false, error: 'preset not found' });
    const normalizedQueueName = queueName || 'default';

    // helper to persist audit entry
    try {
      const p = path.resolve('logs', 'chat_confirm.jsonl');
      appendJsonl(p, { ts: Date.now(), sessionId: sessionId || null, action: 'ai.create_task', presetId: pid, containerId: containerId || null, containerIds: containerIds || null, groupId: groupId || null, overrides: overrides || null, runMode: runMode || 'immediate', dryRun: !!dryRun });
    } catch {}

    const tryParse = (val: unknown) => {
      if (typeof val === 'number') return Number.isFinite(val) ? val : undefined;
      if (typeof val === 'string') {
        const parsed = Date.parse(val);
        return Number.isNaN(parsed) ? undefined : parsed;
      }
      return undefined;
    };
    const scheduledAt = tryParse(runAt) ?? tryParse(scheduledAtOverride);
    const overridesPayload = (() => {
      if (overrides && typeof overrides === 'object' && Object.keys(overrides).length) return overrides;
      if (params && typeof params === 'object' && Object.keys(params).length) return params;
      return {};
    })();
    const waitMinutes = parseWaitMinutes(req.body?.waitMinutes);
    const hasContainerStep = PresetService.presetHasContainerStep(pid);
    
    const requiredTemplateVars = collectTemplateVarsFromSteps(parsePresetStepsJson(preset.steps_json || '[]').steps || []);
    if (requiredTemplateVars.length) {
      // overridesPayloadとparamsの両方から変数を収集
      // overridesPayloadは既にoverridesまたはparamsのいずれかが設定されている
      // さらに、paramsとoverridesが直接パラメータオブジェクトの場合にも対応
      const providedVarsFromOverrides = gatherOverrideVars(overridesPayload);
      // paramsが直接パラメータオブジェクトの場合、トップレベルのキーも取得
      // 空文字列も有効な値として扱う（クリア操作などで使用される）
      const providedVarsFromParamsDirect = params && typeof params === 'object' ? (() => {
        const direct: Record<string, any> = {};
        Object.keys(params).forEach((key) => {
          if (params[key] !== undefined && params[key] !== null) {
            direct[key] = params[key];
          }
        });
        return direct;
      })() : {};
      // overridesが直接パラメータオブジェクトの場合、トップレベルのキーも取得
      // 空文字列も有効な値として扱う（クリア操作などで使用される）
      const providedVarsFromOverridesDirect = overrides && typeof overrides === 'object' ? (() => {
        const direct: Record<string, any> = {};
        Object.keys(overrides).forEach((key) => {
          if (!['vars', 'params', 'payload', 'overrides'].includes(key) && overrides[key] !== undefined && overrides[key] !== null) {
            direct[key] = overrides[key];
          }
        });
        return direct;
      })() : {};
      const providedVarsFromParams = params && typeof params === 'object' ? gatherOverrideVars({ params }) : {};
      const providedVars = { ...providedVarsFromParamsDirect, ...providedVarsFromOverridesDirect, ...providedVarsFromParams, ...providedVarsFromOverrides };
      
      // デバッグログ（開発時のみ）
      try {
        logger.event('api.ai.create_task.template_vars_check', {
          presetId: pid,
          requiredTemplateVars,
          providedVarsKeys: Object.keys(providedVars),
          providedVars,
          overridesPayloadKeys: Object.keys(overridesPayload),
          paramsKeys: params && typeof params === 'object' ? Object.keys(params) : [],
        }, 'debug');
      } catch (e) {}
      // ステップからスキップロジックがある変数を検出（evalコード内に'not provided'や'not provided, skipping'などのパターンがある変数は必須としない）
      const steps = parsePresetStepsJson(preset.steps_json || '[]').steps || [];
      const optionalVars = new Set<string>();
      for (const step of steps) {
        if (step.type === 'eval' && step.code) {
          const codeStr = String(step.code);
          // テンプレート変数名を抽出
          const varMatches = codeStr.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g);
          for (const match of varMatches) {
            const varName = match[1];
            // evalコード内にスキップロジックがあるかチェック
            if (codeStr.includes('not provided') || 
                codeStr.includes('not provided, skipping') || 
                codeStr.includes('trim() === \'\'') ||
                codeStr.includes('未指定') ||
                codeStr.includes('skipped: true')) {
              optionalVars.add(varName);
            }
          }
        }
      }
      // forステップのitemVarを収集（ループ内で自動設定されるため必須チェックから除外）
      const forItemVars = new Set<string>();
      for (const step of steps) {
        if (step.type === 'for' && step.itemVar) {
          forItemVars.add(String(step.itemVar));
        }
      }
      
      const missingTemplateVars = requiredTemplateVars.filter((name) => {
        // db_*変数はタスク実行時にDBから自動取得されるため、必須としない
        if (name.startsWith('db_')) return false;
        // pr_*変数はステップ実行中に生成される内部変数のため、必須としない
        if (name.startsWith('pr_')) return false;
        // forステップのitemVarはループ内で自動設定されるため、必須としない
        if (forItemVars.has(name)) return false;
        // proxyはdb_proxyとしてDBから自動取得されるため、必須としない
        if (name === 'proxy') return false;
        // スキップロジックがある変数は必須としない（空文字列も許容）
        if (optionalVars.has(name)) return false;
        const value = providedVars[name];
        // 空文字列は提供されているものとして扱う（クリア操作などで使用される）
        return value === undefined || value === null;
      });
      if (missingTemplateVars.length) {
        // デバッグ情報をログに記録
        try {
          logger.event('api.ai.create_task.missing_template_vars', {
            presetId: pid,
            missingTemplateVars,
            requiredTemplateVars,
            providedVarsKeys: Object.keys(providedVars),
            providedVars,
            overridesPayloadKeys: Object.keys(overridesPayload),
            overridesPayload,
            paramsKeys: params && typeof params === 'object' ? Object.keys(params) : [],
            params: params && typeof params === 'object' ? params : null,
            overridesKeys: overrides && typeof overrides === 'object' ? Object.keys(overrides) : [],
            overrides: overrides && typeof overrides === 'object' ? overrides : null,
          }, 'warn');
        } catch (e) {}
        return res.status(400).json({ ok:false, error: 'missing_template_vars', missing: missingTemplateVars, debug: { required: requiredTemplateVars, provided: Object.keys(providedVars), overridesPayload: Object.keys(overridesPayload), params: params && typeof params === 'object' ? Object.keys(params) : [], overrides: overrides && typeof overrides === 'object' ? Object.keys(overrides) : [] } });
      }
    }
    const runIds: string[] = [];
    const targetContainerIds: string[] = [];
    
    const queueForContainer = (cid: string | number | null | undefined, gid?: string | null) => {
      const normalized = cid == null ? '' : String(cid).trim();
      // コンテナ作成ステップがある場合、containerIdがnullでもタスクを作成できる
      if (!normalized && !hasContainerStep) return;
      const runId = enqueueTask({ presetId: pid, containerId: normalized || null, overrides: overridesPayload, scheduledAt, groupId: gid || undefined, waitMinutes }, normalizedQueueName);
      runIds.push(runId);
      if (normalized) targetContainerIds.push(normalized);
    };

    // If explicit single containerId provided, enqueue single
    if (containerId) {
      queueForContainer(containerId);
      return res.json({ ok:true, runIds, targetContainerIds });
    }

    // If containerIds array provided, enqueue each
    if (Array.isArray(containerIds) && containerIds.length > 0) {
      for (const cid of containerIds) queueForContainer(cid, groupId);
      return res.json({ ok:true, runIds, targetContainerIds });
    }

    // If a groupId provided, expand to member containers
    if (groupId) {
      const rows = dbQuery<any>('SELECT container_id FROM container_group_members WHERE group_id = ?', [String(groupId)]);
      const members = (rows || []).map(r => r && r.container_id).filter(Boolean);
      if (!members.length) return res.status(404).json({ ok:false, error: 'no containers found for group' });
      for (const cid of members) queueForContainer(cid, groupId);
      try { logger.event('api.ai.create_task.group', { groupId: String(groupId), containers: members.length }, 'info'); } catch (e) {}
      return res.json({ ok:true, runIds, targetContainerIds, groupId: String(groupId) });
    }

    // コンテナ作成ステップがある場合、containerIdがnullでもタスクを作成できる
    if (hasContainerStep) {
      const runId = enqueueTask({ presetId: pid, containerId: null, overrides: overridesPayload, scheduledAt, groupId: undefined, waitMinutes }, normalizedQueueName);
      runIds.push(runId);
      return res.json({ ok:true, runIds, targetContainerIds: [], hasContainerStep: true });
    }

    return res.status(400).json({ ok:false, error: 'containerId, containerIds, or groupId required' });
  } catch (e:any) { logger.event('api.ai.create_task.err', { err: String(e?.message||e) }, 'error'); res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

// Create a preset via AI/chat action (simple helper)
app.post('/api/ai/create-preset', (req, res) => {
  try {
    const { name, description } = req.body || {};
    const nm = (name && String(name).trim()) || (`preset-${Date.now()}`);
    const desc = (description && String(description).trim()) || '';
    const out = PresetService.createPreset(nm, desc, JSON.stringify([]));
    logger.event('api.ai.create_preset', { id: out.id, name: nm }, 'info');
    res.json({ ok: true, id: out.id, name: nm });
  } catch (e:any) {
    logger.event('api.ai.create_preset.err', { err: String(e) }, 'error');
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Tasks API: list tasks, get runs, cancel
app.get('/api/tasks', (req, res) => {
  try {
    // Return recent tasks with latest run summary
    // Exclude tasks already completed ('done') so cancelled/completed tasks do not appear in the active task list.
    const queueName = (req.query.queue_name as string) || 'default';
    const limit = Number.isFinite(Number(req.query.limit)) ? Math.max(1, Math.min(1000, Math.floor(Number(req.query.limit)))) : 50;
    const offset = Number.isFinite(Number(req.query.offset)) ? Math.max(0, Math.floor(Number(req.query.offset))) : 0;
    const groupId = req.query.groupId ? String(req.query.groupId) : null;
    
    const now = Date.now();
    
    // ソート順: 実行中 > キュー待ち（古い予定時刻優先） > 予定時刻順
    // 優先度: running/waiting_* = 0, pending(予定時刻<=now) = 1, pending(予定時刻>now) = 2, その他 = 3
    // フロントエンド側と同様に、done/cancelled/実行済みで待機状態でないタスクを除外
    const whereConditions: string[] = [
      't.status != ?',
      't.status != ?',
      't.queue_name = ?',
      '(tr.runId IS NULL OR t.status LIKE ?)'
    ];
    const queryParams: any[] = ['done', 'cancelled', queueName, 'waiting_%'];
    
    // グループフィルタリング
    if (groupId === '__unassigned') {
      // 未割当: container_group_membersにレコードがない、またはgroup_id IS NULL
      whereConditions.push(`(t.container_id IS NULL OR t.container_id NOT IN (SELECT container_id FROM container_group_members WHERE container_id IS NOT NULL) OR t.group_id IS NULL)`);
    } else if (groupId && groupId !== '') {
      // 特定のグループ: container_group_membersでグループに属するコンテナ、またはgroup_idが一致
      whereConditions.push(`(t.container_id IN (SELECT container_id FROM container_group_members WHERE group_id = ?) OR t.group_id = ?)`);
      queryParams.push(groupId, groupId);
    }
    
    const sql = `
      SELECT DISTINCT t.id, t.runId, t.preset_id, t.container_id, t.overrides_json, t.scheduled_at, t.status, t.created_at, t.updated_at, t.group_id, t.wait_minutes, t.queue_name
      FROM tasks t
      LEFT JOIN (
        SELECT runId, MAX(started_at) as max_started_at
        FROM task_runs
        GROUP BY runId
      ) tr ON t.runId = tr.runId
      WHERE ${whereConditions.join(' AND ')}
      ORDER BY
        CASE
          WHEN t.status = 'running' THEN 0
          WHEN t.status LIKE 'waiting_%' THEN 0
          WHEN t.status = 'pending' AND (t.scheduled_at IS NULL OR t.scheduled_at <= ?) THEN 1
          WHEN t.status = 'pending' AND t.scheduled_at > ? THEN 2
          ELSE 3
        END,
        CASE
          WHEN t.status = 'running' THEN t.created_at
          WHEN t.status LIKE 'waiting_%' THEN t.created_at
          WHEN t.status = 'pending' AND (t.scheduled_at IS NULL OR t.scheduled_at <= ?) THEN COALESCE(t.scheduled_at, 0)
          WHEN t.status = 'pending' AND t.scheduled_at > ? THEN t.scheduled_at
          ELSE t.created_at
        END ASC
      LIMIT ? OFFSET ?
    `;
    
    // タスク一覧を取得（ページング対応、適切なソート順）
    const rows = dbQuery<any>(sql, [...queryParams, now, now, now, now, limit, offset]);
    
    // 総件数を取得（フロントエンド側のフィルター条件と一致：done/cancelled/実行済みで待機状態でないタスクを除外）
    // フロントエンド側のロジック: lastRun があり、かつ status が waiting_* でないタスクを除外
    const countWhereConditions: string[] = [
      't.status != ?',
      't.status != ?',
      't.queue_name = ?',
      '(tr.runId IS NULL OR t.status LIKE ?)'
    ];
    const countQueryParams: any[] = ['done', 'cancelled', queueName, 'waiting_%'];
    
    // グループフィルタリング（カウント用）
    if (groupId === '__unassigned') {
      countWhereConditions.push(`(t.container_id IS NULL OR t.container_id NOT IN (SELECT container_id FROM container_group_members WHERE container_id IS NOT NULL) OR t.group_id IS NULL)`);
    } else if (groupId && groupId !== '') {
      countWhereConditions.push(`(t.container_id IN (SELECT container_id FROM container_group_members WHERE group_id = ?) OR t.group_id = ?)`);
      countQueryParams.push(groupId, groupId);
    }
    
    const countSql = `
      SELECT COUNT(DISTINCT t.id) as count
      FROM tasks t
      LEFT JOIN (
        SELECT runId, MAX(started_at) as max_started_at
        FROM task_runs
        GROUP BY runId
      ) tr ON t.runId = tr.runId
      WHERE ${countWhereConditions.join(' AND ')}
    `;
    const countRows = dbQuery<any>(countSql, countQueryParams);
    const totalCount = (countRows && countRows[0] && countRows[0].count) ? Number(countRows[0].count) : 0;
    
    // コンテナ情報を取得してコンテナIDからコンテナ名に変換
    const dbPath = defaultContainerDb();
    let containerMap: Record<string, any> = {};
    try {
      const containers = probeContainersFromDb(dbPath);
      for (const c of containers || []) {
        try {
          const cid = String((c as any).id || ''); // UUID
          const cname = String((c as any).name || ''); // XID（コンテナ名）
          // container_id（XID）でマッチング - コンテナ名（XID）でマッチング
          if (cname) containerMap[cname] = c;
          if (cid) containerMap[cid] = c;
        } catch {}
      }
    } catch (e: any) {
      logger.event('api.tasks.container_map.err', { err: String(e?.message||e) }, 'warn');
    }
    
    const items = rows.map(r => {
      const runs = dbQuery<any>('SELECT id, runId, task_id, started_at, ended_at, status, result_json FROM task_runs WHERE runId = ? ORDER BY started_at DESC', [r.runId]);
      const last = runs && runs.length ? runs[0] : null;
        const waitMinutes = typeof r.wait_minutes === 'number' ? r.wait_minutes : (r.wait_minutes != null ? Number(r.wait_minutes) : 10);
        // Extract step information from result_json
        const resultJson = (() => {
          if (!last || !last.result_json) return {};
          try { return JSON.parse(last.result_json); } catch { return {}; }
        })();
        const currentStepIndex = (resultJson.currentStepIndex !== undefined) ? resultJson.currentStepIndex : null;
        const stepsTotal = (resultJson.stepsTotal !== undefined) ? resultJson.stepsTotal : null;
        
        // コンテナIDからコンテナ名を取得
        const containerId = r.container_id;
        let containerName = containerId;
        if (containerId) {
          const container = containerMap[String(containerId)];
          if (container) {
            containerName = (container as any).name || containerId;
          }
        }
        
        return {
        id: r.id,
        runId: r.runId,
        presetId: r.preset_id,
        presetName: null,
        containerId: r.container_id,
        containerName: containerName,
        overrides: (()=>{ try { return JSON.parse(r.overrides_json||'{}'); } catch { return {}; } })(),
        scheduledAt: r.scheduled_at,
          status: r.status,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        lastRun: last,
           groupId: r.group_id || null,
           waitMinutes,
           currentStepIndex,
           stepsTotal,
           queueName: r.queue_name || 'default'
      };
    });
    // enrich preset names and steps total
    for (const it of items) {
      try {
        const p = PresetService.getPreset(Number(it.presetId)) as any;
        if (p) {
          it.presetName = p.name;
          // Get stepsTotal from preset if not already set
          if (it.stepsTotal === null && p.steps_json) {
            try {
              const stepsArray = JSON.parse(p.steps_json);
              if (Array.isArray(stepsArray)) {
                it.stepsTotal = stepsArray.length;
              }
            } catch {}
          }
        }
      } catch {}
    }
    res.json({ ok:true, count: items.length, total: totalCount, items, limit, offset, page: Math.floor(offset / limit) });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

app.get('/api/tasks/run/:runId', (req, res) => {
  try {
    const runId = String(req.params.runId || '').trim();
    if (!runId) return res.status(400).json({ ok:false, error: 'runId required' });
    const row = dbQuery<any>('SELECT id, runId, preset_id as presetId, container_id as containerId, overrides_json as overridesJson, scheduled_at as scheduledAt, status, group_id as groupId, wait_minutes as waitMinutes FROM tasks WHERE runId = ? LIMIT 1', [runId])[0];
    if (!row) return res.status(404).json({ ok:false, error: 'task not found for runId' });
    const parsedOverrides = (() => {
      if (!row.overridesJson) return {};
      try {
        return JSON.parse(row.overridesJson);
      } catch {
        return {};
      }
    })();
    const taskPayload = Object.assign({}, row, { overrides: parsedOverrides });
    delete taskPayload.overridesJson;
    return res.json({ ok:true, task: taskPayload });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

app.patch('/api/tasks/:taskId', (req, res) => {
  try {
    const taskId = Number(req.params.taskId);
    if (!taskId) return res.status(400).json({ ok:false, error: 'taskId required' });
    const row = dbQuery<any>('SELECT id FROM tasks WHERE id = ?', [taskId])[0];
    if (!row) return res.status(404).json({ ok:false, error: 'task not found' });
    const {
      presetId,
      containerId,
      groupId,
      overrides,
      params,
      scheduledAt,
      immediate,
      queueName,
    } = req.body || {};
    const tryParse = (val: unknown) => {
      if (typeof val === 'number') return Number.isFinite(val) ? val : undefined;
      if (typeof val === 'string') {
        const parsed = Number(val);
        if (!Number.isNaN(parsed)) return parsed;
        const asDate = Date.parse(val);
        return Number.isNaN(asDate) ? undefined : asDate;
      }
      return undefined;
    };
    const updates: string[] = [];
    const paramsArr: any[] = [];
    if (typeof presetId !== 'undefined' && presetId !== null) {
      updates.push('preset_id = ?');
      paramsArr.push(Number(presetId));
    }
    if (typeof containerId !== 'undefined') {
      updates.push('container_id = ?');
      paramsArr.push(containerId ? String(containerId) : null);
    }
    if (typeof groupId !== 'undefined') {
      updates.push('group_id = ?');
      paramsArr.push(groupId ? String(groupId) : null);
    }
    if (typeof queueName !== 'undefined') {
      updates.push('queue_name = ?');
      paramsArr.push(queueName ? String(queueName) : 'default');
    }
    const overridesPayload = (() => {
      if (overrides && typeof overrides === 'object' && Object.keys(overrides).length) return overrides;
      if (params && typeof params === 'object' && Object.keys(params).length) return params;
      return null;
    })();
    if (overridesPayload) {
      updates.push('overrides_json = ?');
      paramsArr.push(JSON.stringify(overridesPayload));
    }
    const parsedScheduled = tryParse(scheduledAt);
    if (parsedScheduled) {
      updates.push('scheduled_at = ?');
      paramsArr.push(parsedScheduled);
    } else if (immediate) {
      updates.push('scheduled_at = ?');
      paramsArr.push(null);
    }
    const waitMinutesValue = typeof req.body?.waitMinutes !== 'undefined' ? parseWaitMinutes(req.body.waitMinutes) : null;
    if (waitMinutesValue !== null) {
      updates.push('wait_minutes = ?');
      paramsArr.push(waitMinutesValue);
    }
    if (!updates.length) {
      return res.status(400).json({ ok:false, error: 'no updates provided' });
    }
    updates.push('updated_at = ?');
    paramsArr.push(Date.now());
    paramsArr.push(taskId);
    dbRun(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`, paramsArr);
    res.json({ ok:true, taskId });
  } catch (e:any) {
    logger.event('api.tasks.patch.err', { err: String(e?.message||e) }, 'error');
    res.status(500).json({ ok:false, error: String(e?.message||e) });
  }
});

app.get('/api/tasks/execution', (req, res) => {
  try {
    const queueName = (req.query.queue_name as string) || 'default';
    res.json({
      ok: true,
      enabled: isExecutionEnabled(queueName),
      connectivityIssue: getExecutionConnectivityIssue(),
      queueName,
    });
  } catch (e:any) {
    logger.event('api.tasks.execution.get.err', { err: String(e?.message||e) }, 'error');
    res.status(500).json({ ok:false, error: String(e?.message||e) });
  }
});

app.post('/api/tasks/execution', async (req, res) => {
  try {
    const body = req.body || {};
    const queueName = (body.queue_name as string) || 'default';
    const enabledFlag = typeof body.enabled === 'boolean' ? body.enabled : Boolean(body.enabled);
    if (enabledFlag) {
      const connected = await canConnectToContainerBrowser(2000);
      if (!connected) {
        const { host, port } = getContainerBrowserConfig();
        const issueMsg = `接続できなかったため停止中になりました（${host}:${port}）`;
        setExecutionEnabled(false, queueName);
        setExecutionConnectivityIssue(issueMsg);
        logger.event('api.tasks.execution.post.connectivity', { host, port, queueName }, 'warn');
        return res.json({
          ok: true,
          enabled: false,
          connectivityIssue: issueMsg,
          host,
          port,
          queueName,
        });
      }
      setExecutionConnectivityIssue(null);
    } else {
      setExecutionConnectivityIssue(null);
    }
    const current = setExecutionEnabled(enabledFlag, queueName);
    res.json({
      ok: true,
      enabled: current,
      connectivityIssue: getExecutionConnectivityIssue(),
      queueName,
    });
  } catch (e:any) {
    logger.event('api.tasks.execution.post.err', { err: String(e?.message||e) }, 'error');
    res.status(500).json({ ok:false, error: String(e?.message||e) });
  }
});

app.get('/api/kv/:key', (req, res) => {
  try {
    const key = String(req.params.key || '');
    if (!key) return res.status(400).json({ ok:false, error: 'key required' });
    const stored = memGet(key);
    res.json({ ok:true, key, value: stored ?? null });
  } catch (e:any) {
    logger.event('api.kv.get.err', { err: String(e?.message||e) }, 'error');
    res.status(500).json({ ok:false, error: String(e?.message||e) });
  }
});

app.post('/api/kv/:key', (req, res) => {
  try {
    const key = String(req.params.key || '');
    if (!key) return res.status(400).json({ ok:false, error: 'key required' });
    const { value } = req.body || {};
    if (typeof value === 'undefined') return res.status(400).json({ ok:false, error: 'value required' });
    memSet(key, value);
    res.json({ ok:true, key, value });
  } catch (e:any) {
    logger.event('api.kv.post.err', { err: String(e?.message||e) }, 'error');
    res.status(500).json({ ok:false, error: String(e?.message||e) });
  }
});

// runtime.json を更新するAPIエンドポイント
app.patch('/api/runtime', (req, res) => {
  try {
    const patch = req.body || {};
    if (!patch || typeof patch !== 'object') {
      return res.status(400).json({ ok: false, error: 'patch object required' });
    }
    const runtimePath = path.resolve('config', 'runtime.json');
    let current: any = {};
    try {
      if (fs.existsSync(runtimePath)) {
        const raw = fs.readFileSync(runtimePath, 'utf8');
        current = JSON.parse(raw);
      }
    } catch (e: any) {
      logger.event('api.runtime.patch.read.err', { err: String(e?.message || e) }, 'warn');
    }
    const merged = { ...current, ...patch };
    try {
      fs.mkdirSync(path.dirname(runtimePath), { recursive: true });
      fs.writeFileSync(runtimePath, JSON.stringify(merged, null, 2), 'utf8');
      logger.event('api.runtime.patch.success', { patch: Object.keys(patch) }, 'info');
      res.json({ ok: true, config: merged });
    } catch (e: any) {
      logger.event('api.runtime.patch.write.err', { err: String(e?.message || e) }, 'error');
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  } catch (e: any) {
    logger.event('api.runtime.patch.err', { err: String(e?.message || e) }, 'error');
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get('/api/tasks/:runId/runs', (req, res) => {
  try {
    const runId = String(req.params.runId || '');
    if (!runId) return res.status(400).json({ ok:false, error: 'runId required' });
    logger.event('api.task_runs.detail.request', { runId }, 'info');
    const rows = dbQuery<any>('SELECT id, runId, task_id, started_at, ended_at, status, result_json FROM task_runs WHERE runId = ? ORDER BY started_at ASC', [runId]);
    logger.event('api.task_runs.detail.success', { runId, found: Array.isArray(rows) ? rows.length : 0 }, 'info');
    res.json({ ok:true, runId, items: rows });
  } catch (e:any) {
    logger.event('api.task_runs.detail.err', { runId: String(req.params.runId || ''), error: String(e?.message||e) }, 'error');
    res.status(500).json({ ok:false, error: String(e?.message||e) });
  }
});

app.post('/api/tasks/:runId/cancel', (req, res) => {
  try {
    const runId = String(req.params.runId || '');
    if (!runId) return res.status(400).json({ ok:false, error: 'runId required' });
    
    // タスクの現在の状態を確認
    const taskRow = dbQuery<any>('SELECT status, queue_name FROM tasks WHERE runId = ? LIMIT 1', [runId])[0];
    
    if (taskRow) {
      const currentStatus = String(taskRow.status || '');
      
      // 実行中のタスクの場合は状態を「stopped」に更新（削除しない）
      if (currentStatus === 'running') {
        // tasksテーブルの状態を「stopped」に更新
        dbRun('UPDATE tasks SET status = ?, updated_at = ? WHERE runId = ?', ['stopped', Date.now(), runId]);
        
        // task_runsテーブルの状態も「stopped」に更新（存在する場合）
        try {
          dbRun('UPDATE task_runs SET status = ? WHERE runId = ?', ['stopped', runId]);
          logger.event('api.task.cancel.status_updated_to_stopped', { runId }, 'info');
        } catch (trErr: any) {
          // task_runs entry might not exist yet, which is fine
          logger.event('api.task.cancel.task_runs_update.err', { runId, err: String(trErr?.message||trErr) }, 'debug');
        }
        
        // キューから削除
        try {
          const queueName = taskRow.queue_name || 'default';
          const removed = removeQueuedTask(runId, queueName);
          logger.event('api.task.cancel.removed_from_queue', { runId, removed, queueName }, 'debug');
        } catch (e:any) {
          logger.event('api.task.cancel.remove_queue_err', { runId, err: String(e?.message||e) }, 'warn');
        }
        
        // 待機中のタスクをキャンセル
        try {
          const queueName = taskRow.queue_name || 'default';
          const waitingCancelled = cancelWaitingRun(runId, queueName);
          if (waitingCancelled) {
            logger.event('api.task.cancel.waiting_cancelled', { runId, queueName }, 'info');
          }
        } catch (e:any) {
          logger.event('api.task.cancel.waiting_cancel_err', { runId, err: String(e?.message||e) }, 'warn');
        }
      } else {
        // 実行中以外のタスク（pending等）は既存通り削除
        dbRun('DELETE FROM task_runs WHERE runId = ?', [runId]);
        dbRun('DELETE FROM tasks WHERE runId = ?', [runId]);
        // also remove from in-memory queue if present
        try {
          const queueName = taskRow.queue_name || 'default';
          const removed = removeQueuedTask(runId, queueName);
          logger.event('api.task.cancel.removed_from_queue', { runId, removed, queueName }, 'debug');
        } catch (e:any) {
          logger.event('api.task.cancel.remove_queue_err', { runId, err: String(e?.message||e) }, 'warn');
        }
        try {
          const queueName = taskRow.queue_name || 'default';
          const waitingCancelled = cancelWaitingRun(runId, queueName);
          if (waitingCancelled) {
            logger.event('api.task.cancel.waiting_cancelled', { runId, queueName }, 'info');
          }
        } catch (e:any) {
          logger.event('api.task.cancel.waiting_cancel_err', { runId, err: String(e?.message||e) }, 'warn');
        }
      }
    } else {
      // タスクが見つからない場合は何もしない（既に削除されている可能性）
      logger.event('api.task.cancel.task_not_found', { runId }, 'debug');
    }
    
    res.json({ ok:true, runId });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

// AI selector generation: accepts HTML (or snippet) and returns selector candidates
app.post('/api/ai/generate-selector', async (req, res) => {
  try {
    const { html, hint, mode } = req.body || {};
    if (!html) return res.status(400).json({ ok:false, error: 'html is required' });
    const trimmedHtml = String(html).slice(0, 4000);
    const purpose = String(mode || 'selector').toLowerCase();
    const model = process.env.DEFAULT_NLU_MODEL || 'gpt-5-nano';

    // Build system/user prompts per mode
    let system = '';
    let user = '';
    if (purpose === 'eval') {
      system = `あなたはWebページのDOM上で安全に要素を取得し操作する短い自己完結型のJavaScriptスニペット（即時実行関数）を生成する専門家です。返却は必ずJSONで行ってください。出力形式: {"candidates":[{"code":"(function(){...})()","score":0.0,"reason":"..."}, ...]}。各codeは例外をキャッチしてエラー情報を返すようにしてください。`;
      user = `HTMLスニペット:\n${trimmedHtml}\n\nヒント: ${hint||''}\n要求: 3〜5個の候補を返してください。各候補は短い説明(reason)とscore(0-1)を持ち、実行時に {ok:true, ...} か {error: '...'} を返すことを想定してください。`;
    } else if (purpose === 'xpath') {
      system = `あなたは与えられたHTML断片から堅牢で短いXPath式を生成する専門家です。出力は必ずJSONで、形式は {"candidates":[{"xpath":"...","score":0.0,"reason":"..."}, ...]} としてください。XPathはできるだけ短く、テキストや属性を混ぜて安定するようにしてください。`;
      user = `HTMLスニペット:\n${trimmedHtml}\n\nヒント: ${hint||''}\n要求: 3〜7個の候補を返してください。各候補に score(0-1) と短い理由を付けてください。`;
    } else {
      // default: css selector generation
      system = `あなたはWebページのDOMから堅牢なCSSセレクタを生成する専門家です。返却は必ずJSONで行ってください。出力形式: {"candidates":[{"selector":"...","score":0.0,"reason":"..."}, ...]}。セレクタはできるだけ汎用的かつ具体的に。idがあれば #id を優先、なければタグ.クラス を組み合わせる。テキストベースの選択が推奨される場合は text= の形式も出してください。`;
      user = `HTMLスニペット:\n${trimmedHtml}\n\nヒント: ${hint||''}\n要求: 5個以内の候補を出し、それぞれにscore(0-1)と短い理由を付けてください。出力は必ずJSONオブジェクトで、鍵名は "candidates" としてください。`;
    }

    // Request structured JSON response from LLM; chatJson will set response_format for compatible models
    let out: any;
    try {
      out = await chatJson<any>({ model, system, user, responseJson: true, max_completion_tokens: 1400 });
      logger.event('ai.chat.success', { model, mode: purpose }, 'info');
    } catch (e:any) {
      logger.event('ai.chat.failure', { err: String(e?.message||e), model, mode: purpose }, 'error');
      throw e;
    }

    // Normalize parsed candidates
    let cands: any[] = [];
    if (out && Array.isArray((out as any).candidates)) {
      cands = (out as any).candidates;
    } else if (out && typeof out.raw === 'string') {
      try {
        const parsed = JSON.parse(out.raw);
        if (Array.isArray(parsed.candidates)) cands = parsed.candidates;
      } catch (ie) {
        // fallthrough
      }
    }

    // If no parsed candidates, return raw and include prompt for fallback copy
    if (!cands.length) {
      return res.json({ ok:true, candidates: [], raw: out, prompt: user });
    }

    res.json({ ok:true, candidates: cands, prompt: user });
  } catch (e:any) { logger.event('ai.selector.err', { err: String(e?.message||e) }, 'error'); res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

// --- dataset tap utilities and endpoints ---
function ensureDirSync(dir: string) {
  try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* ignore */ }
}

function maskSensitive(text: string) {
  if (!text) return text;
  // mask OpenAI keys
  try { text = text.replace(/sk-[A-Za-z0-9-_]{20,}/g, 'sk-******'); } catch {};
  // mask long tokens
  try { text = text.replace(/[A-Za-z0-9-_]{40,}/g, '****'); } catch {};
  // mask Windows absolute paths keeping last 3 segments
  try { text = text.replace(/([A-Za-z]:\\[^\n\s]+)/g, (m) => {
    const parts = m.split('\\');
    if (parts.length <= 4) return m;
    return `...\\${parts.slice(-3).join('\\')}`;
  }); } catch {}
  return text;
}

function appendJsonl(p: string, obj: any) {
  ensureDirSync(path.dirname(p));
  const s = JSON.stringify(obj) + '\n';
  fs.appendFileSync(p, s, { encoding: 'utf8' });
  try { logger.event('dataset.tap', { evt: 'dataset.tap', path: p, bytes: Buffer.byteLength(s, 'utf8') }, 'info'); } catch {}
}

// dataset tap removed

// Accounts API: read accounts.json
app.get('/api/accounts', (req, res) => {
  try {
    const items = readAccounts();
    res.json({ ok:true, count: items.length, items });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e) }); }
});

// Open account by name (deprecated: use Container Browser instead)
// This endpoint remains for backward compatibility but delegates to Container Browser
app.post('/api/accounts/open', async (req, res) => {
  try {
    const { name, url, headless } = req.body || {};
    if (!name) return res.status(400).json({ ok:false, error:'name is required' });
    const items = readAccounts();
    const found = items.find(a => a.name === name);
    if (!found) return res.status(404).json({ ok:false, error:'account not found' });
    
    // Use Container Browser instead of Playwright
    // コンテナはnavigateコマンドで自動的に開かれるため、openContainerは不要
    const containerId = found.profileUserDataDir;
    
    // Navigate to URL if specified (コンテナが開いていない場合は自動的に開かれる)
    if (url) {
      const navigateResult = await navigateInContext(containerId, url);
      if (!navigateResult.ok) {
        return res.status(500).json({ ok:false, error: `Failed to navigate: ${navigateResult.error}` });
      }
    }
    
    res.json({ ok:true, out: { ok: true, contextId: containerId, message: 'Container will be opened on navigate' } });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

// Containers: read from container-browser DB
app.get('/api/containers/from-db', (req, res) => {
  const dbq = String(req.query.db || '').trim();
  const dbPath = dbq || defaultContainerDb();
  const triggerHdr = String((req.get && req.get('x-trigger')) || (req.headers && req.headers['x-trigger']) || '');
  logger.event('api.cb.fromdb.req', { db: dbPath, trigger: triggerHdr }, 'info');
  try {
    const rows = probeContainersFromDb(dbPath);
    logger.event('containers.from-db.ok', { dbPath, count: rows.length, trigger: triggerHdr }, 'info');
    logger.event('api.cb.fromdb.res', { db: dbPath, count: rows.length, trigger: triggerHdr }, 'info');
    res.json({ ok: true, dbPath, count: rows.length, items: rows });
  } catch (e:any) {
    logger.event('containers.from-db.err', { dbPath, err: String(e), stack: e?.stack, trigger: triggerHdr }, 'error');
    logger.event('api.cb.fromdb.err', { err: String(e), db: dbPath, trigger: triggerHdr }, 'error');
    res.status(500).json({ ok: false, dbPath, error: String(e), stack: e?.stack });
  }
});

// Explicit fetch trigger endpoint for reliable button logging
app.post('/api/containers/fetch-trigger', (req, res) => {
  const dbPath = String(req.body?.db || defaultContainerDb());
  logger.event('api.cb.fetch_trigger.req', { db: dbPath }, 'info');
  try {
    const rows = probeContainersFromDb(dbPath);
    logger.event('api.cb.fetch_trigger.res', { db: dbPath, count: rows.length }, 'info');
    res.json({ ok: true, db: dbPath, count: rows.length, items: rows });
  } catch (e: any) {
    logger.event('api.cb.fetch_trigger.err', { db: dbPath, err: String(e), stack: e?.stack }, 'error');
    res.status(500).json({ ok: false, db: dbPath, error: String(e) });
  }
});

// Open a container row directly via dir or partition
app.post('/api/containers/open-profile', async (req, res) => {
  try {
    const { dir, partition, url, headless } = req.body || {};
    let profilePath = (dir && String(dir).trim()) ? String(dir).trim() : undefined;
    const attemptedPaths: string[] = [];
    if (profilePath) attemptedPaths.push(profilePath);

    // If provided path does not exist, try partition-derived path(s)
    if ((!profilePath || !fs.existsSync(profilePath)) && partition) {
      const p1 = dirFromPartition(partition);
      attemptedPaths.push(p1);
      if (fs.existsSync(p1)) profilePath = p1;
    }

    // Try common alternative: defaultCbDir()/profiles/<base>
    if ((!profilePath || !fs.existsSync(profilePath)) && partition) {
      const base = String(partition || '').replace(/^persist:/, '');
      if (base) {
        const p2 = path.join(defaultCbDir(), 'profiles', base);
        attemptedPaths.push(p2);
        if (fs.existsSync(p2)) profilePath = p2;
      }
    }

    if (!profilePath || !fs.existsSync(profilePath)) {
      logger.event('api.cb.open_profile.req', { dir: dir, partition, attempted: attemptedPaths }, 'warn');
      return res.status(500).json({ ok:false, error: `profilePath does not exist; attempted: ${JSON.stringify(attemptedPaths)}` });
    }

    logger.event('api.cb.open_profile.req', { dir: profilePath, partition, url }, 'info');
    try {
      // obtain token: try keytar then fallback to token.enc (optional)
      const SERVICE_NAME = 'container-browser';
      const ACCOUNT_NAME = 'container-browser-token';
      let token: string | null = null;
      try { token = await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME); } catch (e) { token = null; }
      if (!token) {
        const encPath = path.join(defaultCbDir(), 'token.enc');
        if (fs.existsSync(encPath)) {
          try {
            const raw = fs.readFileSync(encPath);
            const iv = raw.slice(0,12);
            const tag = raw.slice(12,28);
            const enc = raw.slice(28);
            const seed = (process.env.COMPUTERNAME || os.hostname() || 'local') + '::container-browser';
            const key = crypto.createHash('sha256').update(seed, 'utf8').digest();
            const dec = crypto.createDecipheriv('aes-256-gcm', key, iv);
            dec.setAuthTag(tag);
            token = Buffer.concat([dec.update(enc), dec.final()]).toString('utf8');
          } catch (e) { token = null; }
        }
      }
      if (!token) {
        // token is optional for export-restored flow; proceed without injection
        logger.event('api.cb.open_profile.warn', { warn: 'no token available, proceeding without auth injection', profilePath }, 'warn');
      }

      // コンテナはnavigateコマンドで自動的に開かれるため、openContainerは不要
      // Navigate to URL if specified (コンテナが開いていない場合は自動的に開かれる)
      if (url) {
        try {
          const navigateResult = await navigateInContext(profilePath, url);
          if (!navigateResult.ok) {
            logger.event('api.cb.open_profile.err', { err: 'navigation failed', details: navigateResult.error }, 'error');
            return res.status(500).json({ ok:false, error: navigateResult.error || 'Failed to navigate' });
          }
        } catch (e:any) {
          logger.event('api.cb.open_profile.err', { err: 'navigation failed', details: String(e?.message||e) }, 'error');
          return res.status(500).json({ ok:false, error: String(e?.message||e) });
        }
      }
      
      // コンテナIDを返す（navigateが実行されていない場合でも、コンテナIDは設定済み）
      const out = { ok: true, contextId: profilePath, message: 'Container will be opened on navigate' };
      logger.event('api.cb.open_profile.id_set', { profilePath }, 'info');

      // Note: Cookie injection is now handled by Container Browser's ensureAuth
      // If additional cookies need to be injected, use the HTTP API directly

      // restore tabs
      try {
        const dbPath = defaultContainerDb();
        const db = new Database(dbPath, { readonly: true });
        const containerId = profilePath;
        const r = db.prepare('SELECT lastSessionId FROM containers WHERE id=?').get(containerId) as any;
        const lastSessionId = r && r.lastSessionId;
        if (lastSessionId) {
          const tabs = db.prepare('SELECT url,tabIndex FROM tabs WHERE sessionId = ? ORDER BY tabIndex, id').all(lastSessionId);
          const byIndex = new Map();
          for (const t of tabs) { const idx = t.tabIndex || 0; if (!byIndex.has(idx)) byIndex.set(idx, []); byIndex.get(idx).push(t.url); }
          for (const [idx, urls] of byIndex.entries()) {
            const candidate = urls.find((u:string)=>u && !u.startsWith('about:blank')) || urls[0];
            // Tab restore is handled by Container Browser's navigate command
            // No need to manually create pages here
          }
        }
      } catch (e:any) { logger.event('api.cb.open_profile.err', { err: 'restore read failed', errMsg: String(e?.message||e) }, 'error'); return res.status(500).json({ ok:false, error: 'restore read failed' }); }

      logger.event('api.cb.open_profile.res', { contextId: out.contextId }, 'info');
      res.json({ ok:true, out, profilePath });
    } catch (e:any) {
      logger.event('api.cb.open_profile.err', { err: String(e), path: profilePath, attempted: attemptedPaths }, 'error');
      res.status(500).json({ ok:false, error: String(e?.message||e) });
    }
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

app.post('/api/containers/close-profile', async (req, res) => {
  try {
    const { dir, partition } = req.body || {};
    let profilePath = (dir && String(dir).trim()) || '';
    if (!profilePath && partition) {
      profilePath = dirFromPartition(String(partition));
    }
    if (!profilePath) return res.status(400).json({ ok:false, error: 'dir or partition required' });
    
    // Use Container Browser to close the container
    const result = await closeContainer({
      id: profilePath,
      timeoutMs: 30000
    });
    
    res.json({ ok: result.ok, profilePath, closed: result.closed });
  } catch (e:any) {
    res.status(500).json({ ok:false, error: String(e?.message||e) });
  }
});

app.post('/api/export/close', async (req, res) => {
  try {
    const { containerId, timeoutMs } = req.body || {};
    if (!containerId) return res.status(400).json({ ok:false, error: 'containerId required' });
    const { host, port } = getContainerExportConfig();
    const url = `http://${host}:${port}/internal/export-restored/close`;
    const payload: any = { id: String(containerId) };
    if (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0) {
      payload.timeoutMs = timeoutMs;
    }
    const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await resp.json().catch(() => ({ ok:false, error: 'invalid-json' }));
    if (!resp.ok) {
      try { logger.event('api.export.close.err', { containerId, status: resp.status, error: data?.error || 'remote error' }, 'error'); } catch (e) {}
      return res.status(resp.status).json(data);
    }
    try { logger.event('api.export.close.ok', { containerId, result: data }, 'info'); } catch (e) {}
    res.json(data);
  } catch (e:any) {
    try { logger.event('api.export.close.err', { containerId: req.body?.containerId || null, err: String(e) }, 'error'); } catch (e2) {}
    res.status(500).json({ ok:false, error: String(e?.message||e) });
  }
});

// Import a single container row by id into accounts.json (non-destructive)
app.post('/api/containers/import-one', (req, res) => {
  try {
    const { id, dbPath } = req.body || {};
    const resolvedDb = dbPath || defaultContainerDb();
    if (!id) return res.status(400).json({ ok:false, error:'id is required' });
    if (!fs.existsSync(resolvedDb)) return res.status(404).json({ ok:false, error:'db not found', dbPath: resolvedDb });
    logger.event('api.cb.import_one.req', { id, db: resolvedDb }, 'info');
    const db = new Database(resolvedDb, { readonly: true });
    const r = db.prepare(`SELECT id,name,userDataDir,partition FROM containers WHERE id=?`).get(id);
    if (!r) return res.status(404).json({ ok:false, error:'container not found' });
    const name = r.name || r.id;
    const dir = (r.userDataDir && String(r.userDataDir).trim()) ? r.userDataDir : dirFromPartition(r.partition);
    const existing = readAccounts();
    if (existing.some(a => a.name === name)) return res.json({ ok:true, added:false, reason:'exists', name, dir });
    existing.push({ name, profileUserDataDir: dir });
    writeAccounts(existing);
    logger.event('api.cb.import_one.res', { id, name, dir }, 'info');
    res.json({ ok:true, added:true, name, dir, total: existing.length });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

// Import containers from DB into config/accounts.json (non-destructive)
app.post('/api/containers/import-from-db', (req, res) => {
  try {
    const dbPath = (req.body && req.body.dbPath) || defaultContainerDb();
    if (!fs.existsSync(dbPath)) return res.status(404).json({ ok:false, error:'db not found', dbPath });
    const db = new Database(dbPath, { readonly: true });
    const rows = db.prepare(`SELECT id,name,userDataDir,partition FROM containers`).all();
    const existing = readAccounts();
    const byName = new Map(existing.map(a => [a.name, a]));
    let added = 0, skipped = 0;
    for (const r of rows) {
      const name = r.name || r.id;
      const dir = (r.userDataDir && String(r.userDataDir).trim()) ? r.userDataDir : dirFromPartition(r.partition);
      if (byName.has(name)) { skipped++; continue; }
      const acc = { name, profileUserDataDir: dir };
      existing.push(acc);
      byName.set(name, acc);
      added++;
    }
    writeAccounts(existing);
    res.json({ ok:true, dbPath, added, skipped, total: existing.length });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});


// ルートは dashboard へリダイレクト
app.get('/', (_req, res) => res.redirect('/dashboard.html'));

let lastId = 0;
setInterval(() => {
  try {
    // postsテーブルは廃止されました（post_libraryに統一）
    // const rows = dbQuery<any>('SELECT id,ts,platform,account,result,evidence FROM posts WHERE id > ? ORDER BY id ASC', [lastId]);
    // if (rows.length) {
    //   lastId = rows[rows.length - 1].id;
    //   const payload = JSON.stringify(rows.map((r: any) => ({ ...r, shotUrl: r.evidence ? (`/shots/${path.basename(r.evidence)}`) : null })));
    //   clients.forEach((c) => c.write(`event: posts\nid: ${lastId}\ndata: ${payload}\n\n`));
    // }
  } catch {}
}, 1500);

// ============== Post Library API ==============

function openDashboardInBrowser(port: number) {
  if (!port) return;
  const target = `http://localhost:${port}/dashboard.html`;
  const platform = os.platform();
  let cmd: string;
  let args: string[];
  if (platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '\"\"', target];
  } else if (platform === 'darwin') {
    cmd = 'open';
    args = [target];
  } else {
    cmd = 'xdg-open';
    args = [target];
  }
  const child = child_process.spawn(cmd, args, { detached: true, stdio: 'ignore' });
  child.unref?.();
}

app.listen(DASHBOARD_PORT, () => {
  logger.info(`Dashboard running → http://localhost:${DASHBOARD_PORT}`);
  logger.info(`Note: This server is intended for local use only.`);
  try {
    openDashboardInBrowser(DASHBOARD_PORT);
  } catch (e:any) {
    logger.event('dashboard.open_browser.err', { err: String(e?.message||e) }, 'warn');
  }
});

// ============== Post Library API ==============

// GET /api/post-library/items - 投稿一覧取得
app.get('/api/post-library/items', (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 1000);
    const offset = Number(req.query.offset) || 0;
    
    const items = PresetService.listPostLibrary(limit, offset);
    const stats = PresetService.getPostLibraryStats();
    
    res.json({ ok: true, items, stats });
  } catch (e:any) {
    logger.warn({ msg: 'api.post-library.items.err', err: String(e?.message||e) });
    res.status(500).json({ ok: false, error: String(e?.message||e) });
  }
});

// POST /api/post-library/items - 新規投稿追加（画像アップロード対応）
app.post('/api/post-library/items', upload.array('media', 4), async (req, res) => {
  try {
    const { content } = req.body;
    
    if (!content || typeof content !== 'string') {
      return res.status(400).json({ ok: false, error: 'content (string) is required' });
    }
    
    if (content.length > 500) {
      return res.status(400).json({ ok: false, error: 'content exceeds 500 characters' });
    }

    // Save uploaded files to storage/media/
    const mediaPaths: Array<{ type: string; path: string }> = [];
    const mediaDir = path.resolve('storage/media');
    
    if (!fs.existsSync(mediaDir)) {
      fs.mkdirSync(mediaDir, { recursive: true });
    }

    const files = (req as any).files;
    if (files && Array.isArray(files)) {
      for (let idx = 0; idx < files.length && idx < 4; idx++) {
        const file = files[idx] as any;
        const timestamp = Date.now();
        const ext = path.extname(file.originalname) || (file.mimetype.split('/')[0] === 'video' ? '.mp4' : '.jpg');
        const filename = `${timestamp.toString(36)}_${idx}${ext}`;
        const filepath = path.join(mediaDir, filename);
        
        try {
          fs.writeFileSync(filepath, file.buffer);
          const relPath = path.relative(process.cwd(), filepath).replace(/\\/g, '/');
          const mediaType = file.mimetype.startsWith('video') ? 'video' : 'image';
          mediaPaths.push({ type: mediaType, path: `./${relPath}` });
          logger.info({ msg: 'media file saved', filename, size: file.size });
        } catch (writeErr:any) {
          logger.warn({ msg: 'failed to save media file', filename, err: String(writeErr?.message||writeErr) });
        }
      }
    }

    // Insert into DB
    const result = PresetService.insertPostItem(content, mediaPaths);
    res.json({ ok: true, id: result.id });
  } catch (e:any) {
    logger.error({ msg: 'api.post-library.items.post.err', err: String(e?.message||e) });
    res.status(500).json({ ok: false, error: String(e?.message||e) });
  }
});

// DELETE /api/post-library/items/:id - 投稿削除
app.delete('/api/post-library/items/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ ok: false, error: 'id (number) required' });
    }

    PresetService.deletePostItem(id);
    res.json({ ok: true });
  } catch (e:any) {
    logger.warn({ msg: 'api.post-library.items.delete.err', id: req.params.id, err: String(e?.message||e) });
    res.status(500).json({ ok: false, error: String(e?.message||e) });
  }
});

// GET /api/post-library/unused-item - 未使用データ 1 件取得（内部用）
app.get('/api/post-library/unused-item', (req, res) => {
  try {
    const item = PresetService.getUnusedPostItem();
    if (!item) {
      return res.status(404).json({ ok: false, error: 'no unused items available' });
    }
    res.json({ ok: true, item });
  } catch (e:any) {
    logger.warn({ msg: 'api.post-library.unused-item.err', err: String(e?.message||e) });
    res.status(500).json({ ok: false, error: String(e?.message||e) });
  }
});

// PUT /api/post-library/items/:id/mark-used - 使用済みにマーク
app.put('/api/post-library/items/:id/mark-used', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ ok: false, error: 'id (number) required' });
    }

    PresetService.markPostItemUsed(id);
    res.json({ ok: true });
  } catch (e:any) {
    logger.warn({ msg: 'api.post-library.mark-used.err', id: req.params.id, err: String(e?.message||e) });
    res.status(500).json({ ok: false, error: String(e?.message||e) });
  }
});

// GET /api/post-library/export - TSV出力（表示中のページのみ）
app.get('/api/post-library/export', (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 1000);
    const offset = Number(req.query.offset) || 0;
    
    // 表示中のページのデータを取得
    const items = PresetService.listPostLibrary(limit, offset);
    
    // TSV生成（ヘッダー + データ）
    const lines: string[] = ['いいね数\t投稿文\tURL'];
    
    for (const item of items) {
      const likeCount = item.like_count !== null && item.like_count !== undefined ? String(item.like_count) : '';
      // 改行を保持（TSVではダブルクォートで囲むことで改行を含められる）
      // タブはスペースに置換（TSVの区切り文字と衝突するため）
      const content = (item.content || '').replace(/\t/g, ' ').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const url = item.source_url || '';
      lines.push(`${likeCount}\t"${content}"\t${url}`);
    }
    
    res.json({
      ok: true,
      tsv: lines.join('\n'),
      count: items.length
    });
  } catch (e:any) {
    logger.warn({ msg: 'api.post-library.export.err', err: String(e?.message||e) });
    res.status(500).json({ ok: false, error: String(e?.message||e) });
  }
});

// ============== X Posts API ==============

// GET /api/x-posts - X投稿データ一覧取得（新しいスキーマ対応）
app.get('/api/x-posts', (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 1000);
    const offset = Number(req.query.offset) || 0;
    const dateFrom = req.query.dateFrom as string | undefined;
    const dateTo = req.query.dateTo as string | undefined;
    
    // フィルター条件を構築
    let whereClause = '';
    const params: any[] = [];
    const conditions: string[] = [];
    
    // リライト済みでリライト後の本文が無い物を除外
    // リライト済み（rewritten_content IS NOT NULL）で空のものは除外
    // つまり: rewritten_content IS NULL OR rewritten_content != ''
    conditions.push("(rewritten_content IS NULL OR rewritten_content != '')");
    
    if (dateFrom || dateTo) {
      if (dateFrom) {
        conditions.push('created_at >= ?');
        params.push(Number(new Date(dateFrom).getTime()));
      }
      if (dateTo) {
        // 終了日はその日の23:59:59までを含める
        const endDate = new Date(dateTo);
        endDate.setHours(23, 59, 59, 999);
        conditions.push('created_at <= ?');
        params.push(Number(endDate.getTime()));
      }
    }
    
    if (conditions.length > 0) {
      whereClause = 'WHERE ' + conditions.join(' AND ');
    }
    
    // post_libraryテーブルから取得（古い順）
    const sql = `SELECT id, source_url as url, content, like_count, rewritten_content, media_paths as media, download_status, media_count, created_at, used_at, used FROM post_library ${whereClause} ORDER BY created_at ASC LIMIT ? OFFSET ?`;
    params.push(limit, offset);
    const rows = dbQuery<any>(sql, params);
    
    // 統計情報を取得（フィルター条件を適用）
    const statsWhere = whereClause || '';
    const statsParams = params.slice(0, -2); // LIMIT/OFFSETを除外
    const total = dbQuery<any>(`SELECT COUNT(*) as cnt FROM post_library ${statsWhere}`, statsParams)[0]?.cnt || 0;
    const usedParams = [...statsParams, 1];
    const used = dbQuery<any>(`SELECT COUNT(*) as cnt FROM post_library ${statsWhere}${statsWhere ? ' AND' : 'WHERE'} used = ?`, usedParams)[0]?.cnt || 0;
    const unused = total - used;
    
    res.json({
      ok: true,
      items: rows,
      stats: { total, used, unused },
      limit,
      offset
    });
  } catch (e:any) {
    logger.warn({ msg: 'api.x-posts.err', err: String(e?.message||e) });
    res.status(500).json({ ok: false, error: String(e?.message||e) });
  }
});

// GET /api/x-posts/export - TSV出力（いいね数、投稿文、URL）
app.get('/api/x-posts/export', (req, res) => {
  try {
    const dateFrom = req.query.dateFrom as string | undefined;
    const dateTo = req.query.dateTo as string | undefined;
    
    // フィルター条件を構築（表示と同じ条件を適用）
    let whereClause = '';
    const params: any[] = [];
    const conditions: string[] = [];
    
    // リライト済みでリライト後の本文が無い物を除外（一覧表示と同じ条件）
    conditions.push("(rewritten_content IS NULL OR rewritten_content != '')");
    
    if (dateFrom || dateTo) {
      if (dateFrom) {
        conditions.push('created_at >= ?');
        params.push(Number(new Date(dateFrom).getTime()));
      }
      if (dateTo) {
        // 終了日はその日の23:59:59までを含める
        const endDate = new Date(dateTo);
        endDate.setHours(23, 59, 59, 999);
        conditions.push('created_at <= ?');
        params.push(Number(endDate.getTime()));
      }
    }
    
    if (conditions.length > 0) {
      whereClause = 'WHERE ' + conditions.join(' AND ');
    }
    
    // フィルター条件を適用して取得（古い順）
    const sql = `SELECT like_count, content, source_url as url FROM post_library ${whereClause} ORDER BY created_at ASC`;
    const rows = dbQuery<any>(sql, params);
    
    // TSV生成（ヘッダー + データ）
    const lines: string[] = ['いいね数\t投稿文\tURL'];
    
    for (const row of rows) {
      const likeCount = row.like_count !== null && row.like_count !== undefined ? String(row.like_count) : '';
      // 改行を保持（TSVではダブルクォートで囲むことで改行を含められる）
      // タブはスペースに置換（TSVの区切り文字と衝突するため）
      const content = (row.content || '').replace(/\t/g, ' ').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const url = row.url || '';
      lines.push(`${likeCount}\t"${content}"\t${url}`);
    }
    
    res.json({
      ok: true,
      tsv: lines.join('\n')
    });
  } catch (e:any) {
    logger.warn({ msg: 'api.x-posts.export.err', err: String(e?.message||e) });
    res.status(500).json({ ok: false, error: String(e?.message||e) });
  }
});

// POST /api/x-posts/import - TSV入力（URL、メディア、リプレース後本文）
app.post('/api/x-posts/import', (req, res) => {
  try {
    const { tsv } = req.body || {};
    if (!tsv || typeof tsv !== 'string') {
      return res.status(400).json({ ok: false, error: 'TSVデータが必要です' });
    }
    
    const lines = tsv.trim().split('\n');
    if (lines.length < 2) {
      return res.status(400).json({ ok: false, error: 'TSVデータが不正です（ヘッダー行が必要）' });
    }
    
    // ヘッダー行をスキップ
    const dataLines = lines.slice(1);
    let success = 0;
    let skipped = 0;
    let errors = 0;
    
    const now = Date.now();
    
    for (const line of dataLines) {
      if (!line.trim()) continue;
      
      const cols = line.split('\t');
      if (cols.length < 3) {
        errors++;
        continue;
      }
      
      const url = cols[0]?.trim() || '';
      const media = cols[1]?.trim() || '';
      const rewrittenContent = cols[2]?.trim() || '';
      
      if (!url) {
        errors++;
        continue;
      }
      
      // 重複チェック（URLで既存確認）
      const existing = dbQuery<any>('SELECT id FROM post_library WHERE source_url = ?', [url]);
      if (existing && existing.length > 0) {
        skipped++;
        continue;
      }
      
      // 新規挿入
      try {
        // URLからaccount_idとpost_id_threadsを抽出
        let accountId: string | null = null;
        let postIdThreads: string | null = null;
        const urlMatch = url.match(/@([^\/]+)\/post\/([A-Za-z0-9]+)/);
        if (urlMatch && urlMatch.length >= 3) {
          accountId = urlMatch[1];
          postIdThreads = urlMatch[2];
        }
        dbRun(
          'INSERT INTO post_library (content, used, source_url, account_id, post_id_threads, media_paths, rewritten_content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [rewrittenContent || '', 0, url, accountId, postIdThreads, media || null, rewrittenContent || null, now, now]
        );
        success++;
      } catch (e:any) {
        logger.warn({ msg: 'api.x-posts.import.insert.err', url, err: String(e?.message||e) });
        errors++;
      }
    }
    
    res.json({
      ok: true,
      success,
      skipped,
      errors
    });
  } catch (e:any) {
    logger.warn({ msg: 'api.x-posts.import.err', err: String(e?.message||e) });
    res.status(500).json({ ok: false, error: String(e?.message||e) });
  }
});


