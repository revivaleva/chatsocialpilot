import { listEnabled, topKFor } from '../services/capabilities.js';
import { memorySummary } from './memory.js';
import { chatJson } from '../drivers/openai.js';
import { logger } from '../utils/logger.js';

// Planner types: backward-compatible V2 with optional multi-step plan
export type PlannerStep = {
  capability: string;
  arguments: Record<string, any>;
  description?: string; // 人間向け説明（日本語可）
}

export type PlannerResultV2 = {
  /** 実行モード: サーバ側がどう扱うべきかのヒント（任意） */
  mode?: "execute" | "confirm" | "clarify" | "chat_only" | "error";
  decision: "execute" | "confirm" | "clarify" | "decline";
  // 既存互換: 単発 capability
  capability: string | null;
  arguments: Record<string, any>;
  // 新規: マルチステップ計画（配列 or null）
  steps?: PlannerStep[] | null;
  missing_fields: string[];
  confidence: number;
  user_summary: string;
  reason: string;
}

// alias for backwards compatibility
export type PlannerResult = PlannerResultV2;

export async function buildCapabilitiesPrompt(caps:any[]) {
  const parts = caps.slice(0,8).map((c:any)=>`- key: ${c.key}\n  title: ${c.title}\n  desc: ${c.description}\n  params: ${c.params_json || '[]'}\n`);
  return parts.join('\n');
}

// Fast-path heuristic for very explicit utterances that map directly to a single capability.
// Returns a PlannerResultV2 when matched, or null to continue normal LLM routing.
function fastPlanFromUtterance(
  userText: string,
  caps: Array<{ key: string; title?: string; description?: string }>
): PlannerResultV2 | null {
  const q = String(userText || '').toLowerCase();
  // simple token checks for container-list intent (Japanese/English)
  const isContainerListQuery = q.includes('コンテナ') || q.includes('container') || q.includes('コンテナの一覧') || q.includes('一覧を教えて');
  if (!isContainerListQuery) return null;
  const hasListCap = caps.find(c => String(c.key) === 'list_containers');
  if (!hasListCap) return null;

  const plan: PlannerResultV2 = {
    mode: 'execute',
    decision: 'execute',
    capability: 'list_containers',
    arguments: {},
    steps: [
      {
        capability: 'list_containers',
        arguments: {},
        description: '利用可能なコンテナ一覧を取得する'
      }
    ],
    missing_fields: [],
    confidence: 0.99,
    user_summary: '利用可能なコンテナの一覧を取得したい。',
    reason: 'ユーザがコンテナの一覧を明示的に要求しており、list_containers capability が存在するため。'
  };
  return plan;
}

export async function router(userText:string, context:any): Promise<PlannerResultV2> {
  const top = topKFor(userText, Number(process.env.CAP_TOPK||8));
  const capsBlock = await buildCapabilitiesPrompt(top);
  // fast-path: simple heuristic to map explicit queries to capabilities without LLM
  try {
    const fastPlan = fastPlanFromUtterance(userText, top);
    if (fastPlan) {
      logger.event('planner.fast_path', { userText, mode: fastPlan.mode, capability: fastPlan.capability }, 'info');
      return fastPlan;
    }
  } catch (e:any) { /* ignore fast-path errors and continue to LLM */ }

  // New system prompt: stronger JSON-only planner prompt with explicit mode guidance.
  const examplesBlock = `// Single-step (backward-compatible)
User: "プリセットを1つ作成して"
=> {"decision":"execute","capability":"create_preset","arguments":{"name":"preset-from-chat","description":""},"steps":[{"capability":"create_preset","arguments":{"name":"preset-from-chat","description":""},"description":"空のプリセットを作成"}],"missing_fields":[],"confidence":0.95,"user_summary":"プリセット作成を要求","reason":"直接的な作成要求"}

// Single-step: list containers
User: "コンテナの一覧を教えて"
=> {"decision":"execute","capability":"list_containers","arguments":{},"steps":[{"capability":"list_containers","arguments":{},"description":"利用可能なコンテナ一覧を取得する"}],"missing_fields":[],"confidence":0.95,"user_summary":"利用可能なコンテナ一覧の取得を要求","reason":"コンテナの一覧を教えてと明示されているため"}

// Multi-step: open profile -> collect -> like recent posts
User: "@foo の最新ツイートから 5 件だけいいねして"
=> {"decision":"execute","capability":"x_like_recent_posts","arguments":{},"steps":[{"capability":"x_open_profile","arguments":{"accountTag":"@foo"},"description":"プロフィールを開く"},{"capability":"x_collect_recent_posts","arguments":{"maxCount":10},"description":"最近の投稿を収集"},{"capability":"x_like_recent_posts","arguments":{"maxLikes":5,"strategy":"simple"},"description":"収集した中から5件いいね"}],"missing_fields":[],"confidence":0.92,"user_summary":"@foo の最新5件にいいねを行う","reason":"具体的な対象アカウントと件数が指示されているためマルチステップで実行可能"}`;

  const system = `
あなたは「chatsocialpilot」というツールの NLU プランナーです。  
ユーザーの日本語の指示と、あらかじめ渡された「利用可能な capability 一覧」を読み取り、実行するべき high-level capability とその引数・ステップを JSON オブジェクト 1つだけで出力してください。

あなた自身はブラウザ操作や投稿を直接実行しません。あなたの役割は、ツールに対して「何を、どの capability で、どの引数で、どの順番で実行すべきか」を決めることです。

---

# 1. 出力形式（必須）

常に次のフィールドを持つ JSON オブジェクト 1つだけを出力してください。日本語の説明や前後のテキストは一切含めないでください。

{
  "mode": "execute | confirm | clarify | chat_only | error",
  "decision": "execute | confirm | clarify | decline",
  "capability": "string | null",
  "arguments": { },
  "steps": [ { "capability": "string", "arguments": { }, "description": "string (optional)" } ] | null,
  "missing_fields": ["field_name_1","field_name_2"],
  "confidence": 0.0,
  "user_summary": "ユーザーの意図を1〜2文で日本語要約",
  "reason": "どの capability / mode を選んだかの日本語の簡潔な理由"
}

mode の意味:
- "execute": 必要情報が揃っており、そのまま実行してよい。
- "confirm": 実行前にユーザー確認が望ましい（大規模一括等）。
- "clarify": 情報不足。missing_fields に必要項目を列挙する。
- "chat_only": 実操作不要の雑談・説明依頼。
- "error": 解析不能な場合の最終手段。

decision は mode と整合させてください（例: mode="execute" → decision="execute"）。

capability / steps / arguments:
- capability は必ず渡された capability 一覧（下記 ${'${capsBlock}'} に含まれる key のいずれかを指定してください）。
- steps は必要な場合のみ使用。単純な操作は null か []。
- arguments は実行に必要な最小限のフィールドのみを含めること。自然文全体を入れないでください。

missing_fields:
- 実行に不足しているキー名を列挙してください（例: "target_url","preset_id","group_name" 等）。不足がある場合は mode="clarify" にしてください。

confidence:
- 0.0〜1.0。自動実行が安全なら 0.9 以上を推奨。

user_summary / reason:
- 日本語で簡潔に要約・理由を記述してください（ログ向け）。

---

# 2. あなたに渡される情報
1. ユーザー発話 "userText"（日本語）
2. 利用可能な capability 一覧（${capsBlock}）
3. 必要に応じて few-shot 例（${examplesBlock}）

必ず 2 の一覧に含まれる key のみを使ってください。

---

# 3. 意図ごとの基本方針（要旨）

3-1. できる事（help）
- 発話例: "できる事を教えて", "何ができますか"
- 出力: mode="execute", capability="list_capabilities", arguments: {}, confidence: 0.95+

3-2. プリセット作成/編集
- "空のプリセットを作って" → capability: "preset_create_empty", arguments に名前/説明があれば含める

3-3. タスク作成/編集/削除
- グループ指定の場合は group_names を使う。URL や preset が不足すれば missing_fields に列挙して mode="clarify"。

3-4. タスク状況確認
- "直近の失敗タスクはある？" → capability: "task_list_recent", arguments: { status: "failed", limit: 20 }

3-5. グループ管理
- "A001, A002 を alpha に分類して" → capability: "group_assign_members", arguments: { group_name: "alpha", members: ["A001","A002"], create_group_if_missing: true }

3-6. 雑談・説明
- mode="chat_only", capability=null, confidence は低め（0.3〜0.6）

---

# 4. Examples (few-shot)

${examplesBlock}

---

常に単一の JSON オブジェクトのみを返してください。解析に不安がある場合は mode="clarify" と missing_fields を使ってください。
Think step by step about which single capability best matches the user's request.
Prefer high‑level capabilities (x_* and run_preset, list_containers, etc.) over low‑level actions.

特に次のような日本語の発話については、必ず下記のように扱ってください:

- ユーザーが「コンテナの一覧を教えて」「利用可能なコンテナを見せて」などと尋ねる場合:
  - mode = "execute"
  - decision = "execute"
  - capability = "list_containers"
  - arguments = {}
  - steps は null か、1 つの step で list_containers を実行する形にしてよいです。

- ユーザーが「できる事を教えて」「何ができますか？」と聞いているだけの場合:
  - mode = "chat_only"
  - decision = "decline"
  - capability = null
  - steps = null
  - missing_fields = []

- 破壊的・危険な操作を含むプリセットの実行（大量のいいね、削除など）が指示された場合:
  - mode = "confirm"
  - decision = "confirm"
  - capability = "run_preset" または対象となるプリセットキー
  - missing_fields に足りないパラメータ名を入れる（例: "target_account", "limit" など）

---

Examples:

${examplesBlock}

Repeat: your entire reply MUST be a single JSON object with the exact keys described above.
Do not wrap it in backticks.
Do not include any extra commentary.
`;

  const user = `User utterance: ${userText}\n\nReturn the JSON object now.`;

  try {
    const mdl = process.env.PLANNER_MODEL || process.env.NLU_MODEL || 'gpt-5-nano';
    let out = await chatJson<any>({ model: mdl, system, user, responseJson: true, max_completion_tokens: 400 });
    // If the LLM returned a wrapper { raw: "...." } (JSON parse failed in driver),
    // attempt to recover a JSON object embedded in the raw string (common when model
    // emits extra commentary). This makes planner more robust to non-strict LLM output.
    if (out && typeof out === 'object' && typeof (out as any).raw === 'string') {
      const rawStr = String((out as any).raw || '');
      try {
        // try naive parse first (in case it's valid JSON string)
        out = JSON.parse(rawStr);
      } catch (_) {
        // fallback: extract first {...} block and try to parse it
        const m = rawStr.match(/(\{[\s\S]*\})/);
        if (m && m[1]) {
          try { out = JSON.parse(m[1]); } catch (_) { /* keep original out */ }
        }
      }
    }
    // Normalize fallback: ensure we always return a PlannerResultV2-shaped object
    if (!out || typeof out !== 'object') {
      logger.event('planner.err', { err: 'planner returned non-object' }, 'error');
      return { mode: 'error', decision:'decline', capability:null, arguments:{}, steps: null, missing_fields: [], confidence: 0.0, user_summary:'', reason:'planner-invalid' };
    }

    // Extract canonical fields with safe defaults
    const decision = typeof out.decision === 'string' ? out.decision as PlannerResultV2['decision'] : 'decline';
    const capability = typeof out.capability === 'string' ? out.capability : null;
    const args = (out.arguments && typeof out.arguments === 'object') ? out.arguments : {};
    const missing_fields = Array.isArray(out.missing_fields) ? out.missing_fields : [];
    const confidence = typeof out.confidence === 'number' ? out.confidence : 0.0;
    const steps = Object.prototype.hasOwnProperty.call(out, 'steps') ? out.steps : null;
    const user_summary = typeof out.user_summary === 'string' ? out.user_summary : '';
    const reason = typeof out.reason === 'string' ? out.reason : '';

    // Normalize mode: prefer explicit out.mode, otherwise derive from decision (safe defaults)
    let mode: PlannerResultV2['mode'];
    if (typeof out.mode === 'string') {
      mode = out.mode as PlannerResultV2['mode'];
    } else {
      if (decision === 'execute') mode = 'execute';
      else if (decision === 'confirm') mode = 'confirm';
      else if (decision === 'clarify') mode = 'clarify';
      else mode = 'chat_only';
    }

    const result: PlannerResultV2 = {
      mode,
      decision,
      capability,
      arguments: args,
      steps,
      missing_fields,
      confidence,
      user_summary,
      reason,
    };
    return result;
  } catch (e:any) {
    logger.event('planner.err', { err: String(e) }, 'error');
    return { mode: 'error', decision:'decline', capability:null, arguments:{}, steps: null, missing_fields: [], confidence: 0.0, user_summary:'', reason:'error' };
  }
}

export async function argFill(capability:any, params_spec:any, userText:string, context:any) {
  const mdl = process.env.ARGFILLER_MODEL || process.env.PLANNER_MODEL || 'gpt-5-nano';
  const sys = `Fill missing arguments for capability ${capability}. Params spec: ${JSON.stringify(params_spec)}. User: ${userText}`;
  try {
    const out = await chatJson({ model: mdl, system: sys, user: '', responseJson: true, max_completion_tokens: 200 });
    return out;
  } catch (e:any) { logger.event('argfill.err', { err: String(e) }, 'error'); return {}; }
}




