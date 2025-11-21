import { query, run } from '../drivers/db';
import { logger } from '../utils/logger';

export type Capability = { key:string; title?:string; description?:string; params_json?:string; preconds_json?:string; risk_score?:number; enabled?:number; example_prompts?: string[] };

export function listEnabled(): Capability[] {
  return query<Capability>('SELECT key,title,description,params_json,preconds_json,risk_score,enabled FROM capabilities WHERE enabled=1 ORDER BY updated_at DESC LIMIT 100', []);
}

export function upsertCapability(cap: Capability) {
  const now = Date.now();
  try {
    return run(`INSERT INTO capabilities(key,title,description,params_json,preconds_json,risk_score,enabled,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET title=excluded.title, description=excluded.description, params_json=excluded.params_json, preconds_json=excluded.preconds_json, risk_score=excluded.risk_score, enabled=excluded.enabled, updated_at=excluded.updated_at`, [cap.key, cap.title||'', cap.description||'', cap.params_json||'', cap.preconds_json||'', cap.risk_score||0, cap.enabled||1, now]);
  } catch (e:any) { logger.event('cap.upsert.err', { err: String(e) }, 'error'); throw e; }
}

export function examplesFor(key:string) {
  // Attempt to read examples from DB table `capability_examples` if present.
  try {
    const rows = query<any>('SELECT user_utterance, expected_args_json, notes FROM capability_examples WHERE capability_key = ? ORDER BY id DESC LIMIT 20', [key]);
    if (rows && rows.length) return rows;
  } catch (e:any) {
    // ignore DB errors and fall back to in-memory examples
  }

  // In-memory examples for High-level capabilities (fallback)
  const examples: Record<string, any[]> = {
    'x_like_recent_posts': [
      { user_utterance: '@foo の最新ツイートから 5 件くらいだけいいねして', expected_args_json: JSON.stringify({ maxLikes: 5, strategy: 'simple' }), notes: 'simple strategy で上位5件にいいね' }
    ],
    'x_open_profile': [
      { user_utterance: '@bar のプロフィールを開いて', expected_args_json: JSON.stringify({ accountTag: '@bar' }), notes: 'accountTag または screenName を指定してください' }
    ],
    'x_collect_recent_posts': [
      { user_utterance: 'このプロフィールの最新投稿を10件集めて', expected_args_json: JSON.stringify({ maxCount: 10 }), notes: '現在開いているプロフィールから収集する想定' }
    ],
    'list_containers': [
      { user_utterance: 'コンテナの一覧を教えて', expected_args_json: JSON.stringify({}), notes: '現在利用可能な全コンテナを列挙' },
      { user_utterance: '使えるコンテナを全部見せて', expected_args_json: JSON.stringify({}), notes: 'コンテナ一覧表示' }
    ],
    'run_preset': [
      { user_utterance: 'プリセットID 6 をコンテナ abc で実行して', expected_args_json: JSON.stringify({ presetId: 6, containerId: 'abc' }), notes: 'presetId と containerId を指定' }
    ]
  };
  return examples[key] || [];
}

export function calcRiskGate(risk_score:number, envThreshold?:number) {
  const t = typeof envThreshold === 'number' ? envThreshold : Number(process.env.RISK_CONFIRM_THRESHOLD || 0.6);
  return (risk_score || 0) >= t;
}

export function topKFor(text:string, k=5, rules?: any) {
  // include in-memory high-level capability catalog as candidates, then score over title+description
  const highLevel: Capability[] = [
    { key: 'show_help', title: 'Show help', description: '利用可能な機能の一覧と簡単な利用例を表示します', params_json: JSON.stringify({}), example_prompts: ['できる事を教えて', '何ができますか？'], risk_score: 0.0, enabled: 1 },
    { key: 'list_containers', title: 'List containers', description: '利用可能なコンテナの一覧を取得する (コンテナ一覧 / container list). args: { limit? }', params_json: JSON.stringify({ limit: 'number?' }), example_prompts: ['コンテナの一覧を教えてください', '使えるコンテナを全部見せて'], risk_score: 0.1, enabled: 1 },
    { key: 'preset_create_empty', title: 'Create empty preset', description: '空のプリセットを作成します. args: { name?, description? }', params_json: JSON.stringify({ name: 'string?', description: 'string?' }), example_prompts: ['空のプリセットを作って', 'プリセットを1つ作成して'], risk_score: 0.05, enabled: 1 },
    { key: 'preset_edit_steps', title: 'Edit preset steps', description: '既存プリセットのステップを追加/更新/削除します. args: { preset_identifier, operation, step_index?, step_patch? }', params_json: JSON.stringify({ preset_identifier: 'string', operation: '"add"|"update"|"delete"', step_index: 'number?', step_patch: '{}' }), example_prompts: ['プリセット7にステップを1つ追加して', 'プリセットID 3 のステップ2を更新して'], risk_score: 0.1, enabled: 1 },
    { key: 'task_create', title: 'Create task', description: 'コンテナ/グループ/プリセット/URL からタスクを作成します', params_json: JSON.stringify({ containers: 'string[]?', group: 'string?', preset: 'string?', target_url: 'string?', action: 'string?', wait_seconds_between: 'number?' }), example_prompts: ['コンテナAでこのURLにいいねするタスクを作って', 'alphaグループでこの投稿にいいねするタスクを作成して'], risk_score: 0.3, enabled: 1 },
    { key: 'task_delete', title: 'Delete task', description: '指定したタスクを削除します. args: { task_id?, filter? }', params_json: JSON.stringify({ task_id: 'string?', filter: '{}' }), example_prompts: ['タスクID 123 を削除して', '最近の失敗タスクを全部削除して'], risk_score: 0.6, enabled: 1 },
    { key: 'task_update', title: 'Update task', description: '既存タスクの内容を更新します. args: { task_id, patch }', params_json: JSON.stringify({ task_id: 'string', patch: '{}' }), example_prompts: ['タスク123のURLを変更して'], risk_score: 0.4, enabled: 1 },
    { key: 'task_query_status', title: 'Query task status', description: 'タスクの実行状況を確認します. args: { group?, only_failed?, since? }', params_json: JSON.stringify({ group: 'string?', only_failed: 'boolean?', since: 'string?' }), example_prompts: ['直近の失敗タスクはある？', 'alphaグループの実行状況を教えて'], risk_score: 0.05, enabled: 1 },
    { key: 'group_assign_members', title: 'Assign group members', description: 'コンテナをグループに分類します. args: { group, containers, create_group_if_missing? }', params_json: JSON.stringify({ group: 'string', containers: 'string[]', create_group_if_missing: 'boolean?' }), example_prompts: ['A001, A002 を alpha に分類して', 'コンテナ01と02をテストグループに入れて'], risk_score: 0.05, enabled: 1 }
  ];
  // DB rows (if available)
  let rows: any[] = [];
  try {
    rows = query<any>('SELECT key,title,description,params_json,preconds_json,risk_score FROM capabilities WHERE enabled=1', []);
  } catch (e:any) { rows = []; }
  // Merge high-level with DB rows, prefer DB row if key duplicates
  const rowMap: Record<string, any> = {};
  for (const r of highLevel) rowMap[String(r.key)] = r;
  for (const r of rows) rowMap[String(r.key)] = r;
  const merged = Object.values(rowMap);

  const toks = (text||'').toLowerCase().split(/\s+/).filter(Boolean);
  const scored = merged.map((r:any)=>{
    const hay = ((r.title||'') + ' ' + (r.description||'')).toLowerCase();
    let score = 0;
    for (const t of toks) if (hay.includes(t)) score += 1;
    // small boost for short keys match
    if ((r.key||'').toLowerCase().includes(text.toLowerCase())) score += 2;
    // Heuristic boost for Japanese/English "container" queries which often lack spaces
    // (e.g. "コンテナの一覧を教えてください") so that list_containers appears in topK.
    const q = String(text || '').toLowerCase();
    if (r.key === 'list_containers' && (q.includes('コンテナ') || q.includes('container') || q.includes('一覧'))) score += 3;
    return { row: r, score };
  }).filter(s=>s.score>0).sort((a,b)=>b.score-a.score).slice(0,k).map(s=>s.row);
  // fallback: if no match, return merged top-k
  if (!scored.length) return merged.slice(0,k);
  return scored;
}




