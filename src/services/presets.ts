import fs from 'node:fs';
import path from 'node:path';
import { query, run } from '../drivers/db';
import { logger } from '../utils/logger';

export type PresetListOrderBy = 'id' | 'name' | 'created_at' | 'updated_at';
export type PresetListDir = 'asc' | 'desc';

export function listPresets(opts: { orderBy?: PresetListOrderBy; dir?: PresetListDir } = {}) {
  const orderBy = opts.orderBy ?? 'id';
  const dir = opts.dir ?? 'desc';

  const orderBySql = (() => {
    switch (orderBy) {
      case 'name':
        return 'name COLLATE NOCASE';
      case 'created_at':
        return 'created_at';
      case 'updated_at':
        return 'updated_at';
      case 'id':
      default:
        return 'id';
    }
  })();
  const dirSql = dir === 'asc' ? 'ASC' : 'DESC';

  // Keep ordering stable even when multiple rows share the same sort key
  const tieBreaker = orderBySql === 'id' ? '' : ', id DESC';
  return query(
    `SELECT id,name,description,steps_json,created_at,updated_at FROM presets ORDER BY ${orderBySql} ${dirSql}${tieBreaker}`
  );
}

export function getPreset(id: number) {
  const rows = query('SELECT id,name,description,steps_json,created_at,updated_at,use_post_library FROM presets WHERE id=?', [id]);
  return rows && rows.length ? rows[0] : null;
}

export function presetHasContainerStep(presetId: number): boolean {
  const preset = getPreset(presetId) as any;
  if (!preset) return false;
  try {
    const steps = JSON.parse(preset.steps_json || '[]');
    return Array.isArray(steps) && steps.some((s: any) => s.type === 'container' || s.type === 'open_container');
  } catch {
    return false;
  }
}

export function createPreset(name: string, description: string, stepsJson: string) {
  const now = Date.now();
  const res = run('INSERT INTO presets(name,description,steps_json,created_at,updated_at) VALUES(?,?,?,?,?)', [name, description, stepsJson, now, now]);
  logger.info({ msg: 'preset created', id: res.lastInsertRowid, name });
  return { id: res.lastInsertRowid };
}

export function updatePreset(id: number, name: string, description: string, stepsJson: string, usePostLibrary?: number) {
  const now = Date.now();
  const usePostLib = usePostLibrary ? 1 : 0;
  run('UPDATE presets SET name=?, description=?, steps_json=?, use_post_library=?, updated_at=? WHERE id=?', [name, description, stepsJson, usePostLib, now, id]);
  return { ok: true };
}

export function deletePreset(id: number) {
  run('DELETE FROM presets WHERE id=?', [id]);
  return { ok: true };
}

export function recordJobRun(jobId: number|null, presetId: number, stepIndex: number, stepJson: string, okFlag: boolean, resultJson: any, errorText: string|null, elapsedMs: number) {
  const now = Date.now();
  run('INSERT INTO job_runs(job_id,preset_id,step_index,step_json,ok,result_json,error_text,elapsed_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?)', [jobId, presetId, stepIndex, stepJson, okFlag ? 1 : 0, JSON.stringify(resultJson || {}), errorText, elapsedMs, now]);
}

// ============== Post Library ==============

function ensureMediaDir() {
  const mediaDir = path.resolve('storage/media');
  try {
    if (!fs.existsSync(mediaDir)) {
      fs.mkdirSync(mediaDir, { recursive: true });
      logger.info({ msg: 'media directory created', path: mediaDir });
    }
  } catch (e:any) {
    logger.warn({ msg: 'failed to create media directory', err: String(e?.message||e) });
  }
  return mediaDir;
}

export type PostLibraryItem = {
  id: number;
  content: string;
  used: number;
  media?: Array<{ id: number; type: string; path: string }>;
  created_at: number;
  updated_at: number;
  source_url?: string;
  account_id?: string;
  post_id_threads?: string;
  like_count?: number;
  rewritten_content?: string;
  used_at?: number;
  media_paths?: string;
  download_status?: string;
  downloaded_at?: number;
  media_count?: number;
};

export function insertPostItem(content: string, mediaPaths?: Array<{ type: string; path: string }>) {
  try {
    ensureMediaDir();
    const now = Date.now();
    const res = run('INSERT INTO post_library(content, used, created_at, updated_at) VALUES(?,?,?,?)', [content, 0, now, now]);
    const postId = res.lastInsertRowid as number;

    if (mediaPaths && Array.isArray(mediaPaths) && mediaPaths.length > 0) {
      for (const media of mediaPaths.slice(0, 4)) {
        try {
          run('INSERT INTO post_media(post_id, type, path, created_at) VALUES(?,?,?,?)', [postId, media.type, media.path, now]);
        } catch (e:any) {
          logger.warn({ msg: 'failed to insert post_media', err: String(e?.message||e), postId });
        }
      }
    }

    logger.info({ msg: 'post item inserted', postId, content: content.slice(0, 50), mediaCount: mediaPaths?.length || 0 });
    return { id: postId };
  } catch (e:any) {
    logger.error({ msg: 'insertPostItem error', err: String(e?.message||e) });
    throw e;
  }
}

export async function getUnusedPostItem(): Promise<PostLibraryItem | null> {
  try {
    const { transaction, query: dbQuery, run: dbRun } = await import('../drivers/db.js');
    
    // トランザクション内で投稿を取得し、同時に使用済みにマーク（競合を防ぐ）
    const post = await transaction(async () => {
      // まず投稿を取得（取得条件を追加）
      // used_atがNULLではないused=0のレコードは不整合の可能性があるため除外
      const rows = dbQuery<PostLibraryItem>(
        `SELECT id, content, rewritten_content, used, created_at, updated_at 
         FROM post_library 
         WHERE used = 0 
           AND (used_at IS NULL OR used_at = 0)
           AND rewritten_content IS NOT NULL 
           AND rewritten_content != '' 
           AND (media_paths IS NULL OR media_paths = '' OR download_status = 'completed')
         ORDER BY created_at ASC 
         LIMIT 1`
      );
      
      if (!rows || rows.length === 0) return null;
      
      const candidate = rows[0];
      const postId = candidate.id;
      const now = Date.now();
      
      // 取得と同時に使用済みにマーク（アトミック操作）
      const updateResult = dbRun(
        'UPDATE post_library SET used = 1, used_at = ?, updated_at = ? WHERE id = ? AND used = 0',
        [now, now, postId]
      );
      
      // 更新された行数が0の場合、他のタスクが既に使用済みにマークした（競合）
      if (updateResult.changes === 0) {
        return null;
      }
      
      // 更新成功した場合、メディア情報を取得して返す
      const mediaRows = dbQuery<any>('SELECT id, type, path FROM post_media WHERE post_id=?', [postId]);
      candidate.media = (mediaRows || []) as any[];
      
      return candidate;
    });
    
    return post;
  } catch (e:any) {
    logger.warn({ msg: 'getUnusedPostItem error', err: String(e?.message||e) });
    return null;
  }
}

export function markPostItemUsed(postId: number) {
  try {
    const now = Date.now();
    run('UPDATE post_library SET used=1, used_at=?, updated_at=? WHERE id=?', [now, now, postId]);
    logger.info({ msg: 'post item marked as used', postId });
  } catch (e:any) {
    logger.warn({ msg: 'markPostItemUsed error', err: String(e?.message||e), postId });
  }
}

export function deletePostItem(postId: number) {
  try {
    // 1) Get all media paths
    const mediaRows = query<any>('SELECT path FROM post_media WHERE post_id=?', [postId]);

    // 2) Delete files from filesystem
    if (mediaRows && Array.isArray(mediaRows)) {
      for (const row of mediaRows) {
        try {
          const fullPath = path.resolve(row.path);
          if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
            logger.info({ msg: 'media file deleted', path: fullPath });
          }
        } catch (e:any) {
          logger.warn({ msg: 'failed to delete media file', path: row.path, err: String(e?.message||e) });
        }
      }
    }

    // 3) Delete from DB (CASCADE will handle post_media)
    run('DELETE FROM post_library WHERE id=?', [postId]);
    logger.info({ msg: 'post item deleted', postId });
  } catch (e:any) {
    logger.error({ msg: 'deletePostItem error', err: String(e?.message||e), postId });
    throw e;
  }
}

export function listPostLibrary(limit: number = 50, offset: number = 0) {
  try {
    const rows = query<PostLibraryItem>('SELECT id, content, used, created_at, updated_at, source_url, account_id, post_id_threads, like_count, rewritten_content, used_at, media_paths, download_status, downloaded_at, media_count FROM post_library ORDER BY created_at DESC LIMIT ? OFFSET ?', [limit, offset]);

    if (!rows || rows.length === 0) return [];

    for (const post of rows) {
      const mediaRows = query<any>('SELECT id, type, path FROM post_media WHERE post_id=?', [post.id]);
      post.media = (mediaRows || []) as any[];
    }

    return rows;
  } catch (e:any) {
    logger.warn({ msg: 'listPostLibrary error', err: String(e?.message||e) });
    return [];
  }
}

export function getPostLibraryStats() {
  try {
    const total = query<any>('SELECT COUNT(*) as cnt FROM post_library');
    const unused = query<any>('SELECT COUNT(*) as cnt FROM post_library WHERE used=0');
    return {
      total: total?.[0]?.cnt || 0,
      unused: unused?.[0]?.cnt || 0,
      used: (total?.[0]?.cnt || 0) - (unused?.[0]?.cnt || 0)
    };
  } catch (e:any) {
    logger.warn({ msg: 'getPostLibraryStats error', err: String(e?.message||e) });
    return { total: 0, unused: 0, used: 0 };
  }
}


