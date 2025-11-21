import { chatJson } from '../drivers/openai';

export type IntentName = 'open_profile' | 'navigate' | 'click' | 'type' | 'none';

export type ParsedIntent = {
  intent: IntentName;
  confidence: number;     // 0..1
  args: Record<string, any>;
  reason?: string;
};

const PATH_RE = /([A-Za-z]:\\[^*?"<>|]+)(?=\s|$)/; // Windowsパス簡易検出
const URL_RE  = /(https?:\/\/\S+)/i;

function quickRegexParse(text: string): ParsedIntent | null {
  const hasVerb = /(開い|起動|使っ|ひら|open|profile|プロファイル)/i.test(text);
  const mPath = text.match(PATH_RE);
  if (hasVerb && mPath) {
    const mUrl = text.match(URL_RE);
    return {
      intent: 'open_profile',
      confidence: mUrl ? 0.8 : 0.7,
      args: { profilePath: mPath[1], url: mUrl ? mUrl[1] : undefined, headless: false },
      reason: 'regex',
    };
  }
  // quick navigate detection
  const navVerb = /(移動|開く|navigate|go to|アクセス)/i.test(text);
  const mUrl = text.match(URL_RE);
  if (navVerb && mUrl) {
    return { intent: 'navigate', confidence: 0.8, args: { url: mUrl[1] }, reason: 'regex' };
  }
  // quick click/type heuristics
  if (/クリック|押して|ボタン|click/i.test(text)) {
    return { intent: 'click', confidence: 0.6, args: { selector: undefined }, reason: 'heuristic' };
  }
  if (/入力|タイプ|type|入力してください|検索に/i.test(text)) {
    return { intent: 'type', confidence: 0.6, args: { selector: undefined, text: text }, reason: 'heuristic' };
  }
  return null;
}

export async function parseIntent(text: string): Promise<ParsedIntent> {
  const r = quickRegexParse(text);
  if (r) return r;

  const sys = [
    'You are an intent parser. Return a single JSON object only.',
    'Allowed intents: "open_profile", "navigate", "click", "type", "none".',
    'Schema: {"intent":"open_profile|navigate|click|type|none","confidence":0..1,"args":{...},"reason":string}',
    'For click: args should include { "selector": "..." } when possible.',
    'For type: args should include { "selector": "...", "text": "..." } when possible.',
    'If you are not sure, return {"intent":"none","confidence":0.3,"args":{}}.',
    'For Windows paths, return the full raw string as given.',
    'Answer JSON only without any extra text.'
  ].join(' ');
  const user = `Text: ${text}`;
  const out = await chatJson({ model: process.env.NLU_MODEL || 'gpt-5-nano', system: sys, user, responseJson: false, temperature: Number(process.env.NLU_TEMPERATURE || 0.2), max_completion_tokens: 300 });

  try {
    const parsed = JSON.parse(out as unknown as string || '{}');
    if (!parsed || typeof parsed !== 'object') throw new Error('not object');
    if (!parsed.intent) return { intent:'none', confidence:0.3, args:{}, reason:'parse-fallback' };
    let intent: IntentName = 'none';
    if (parsed.intent === 'open_profile') intent = 'open_profile';
    else if (parsed.intent === 'navigate') intent = 'navigate';
    else if (parsed.intent === 'click') intent = 'click';
    else if (parsed.intent === 'type') intent = 'type';
    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence ?? 0.5)));
    const args = parsed.args && typeof parsed.args === 'object' ? parsed.args : {};
    // minimal validation
    if (intent === 'click' && !args.selector) {
      // allow heuristic selector later, keep as is
    }
    return { intent, confidence, args, reason: parsed.reason || 'llm' };
  } catch (e) {
    // JSON parse failed — return raw LLM reply so caller can surface it to the user if desired
    return { intent:'none', confidence:0.3, args:{}, reason:'json-error', ...(typeof out === 'string' ? { raw: out } : {}) } as ParsedIntent & { raw?: string };
  }
}


