import 'dotenv/config';
import OpenAI from 'openai';
import { logger } from '../utils/logger';

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: Number(process.env.OPENAI_TIMEOUT_MS || 60000),
  maxRetries: Number(process.env.OPENAI_MAX_RETRIES || 1),
});

export const MAX_HARD_CAP = Number(process.env.CHAT_MAX_HARD_CAP || 4000);
export const DEFAULT_OPENAI_MAXTOKENS = Number(process.env.DEFAULT_OPENAI_MAXTOKENS ?? 1800);
function clampMax(x: number) { return Math.max(100, Math.min(MAX_HARD_CAP, Math.floor(x))); }

export type ChatArgs = {
  model: string;
  system?: string;
  user: string | object;
  responseJson?: boolean;
  temperature?: number;
  max_completion_tokens?: number; // new canonical param
  max_tokens?: number;            // backward-compatible
  request_timeout_ms?: number;
  signal?: AbortSignal;
};

function decideTemperatureToSend(model: string, t?: number): number | undefined {
  const m = String(model || '').toLowerCase();
  // Models containing 'nano' do not accept custom temperature; omit the field.
  if (m.includes('nano')) return undefined;
  return typeof t === 'number' ? t : undefined;
}

export async function chatJson<T = unknown>(args: ChatArgs): Promise<T> {
  const { model, system, user, responseJson = true } = args;
  const temperature = decideTemperatureToSend(model, args.temperature);
  const max_completion_tokens = (args.max_completion_tokens ?? args.max_tokens ?? 1200);
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: typeof user === 'string' ? user : JSON.stringify(user) });

  const req: any = { model, messages, max_completion_tokens };
  if (typeof temperature === 'number') req.temperature = temperature;
  if (responseJson) req.response_format = { type: 'json_object' };
  const t0 = Date.now();
  const timeoutMs = typeof args.request_timeout_ms === 'number' ? args.request_timeout_ms : Number(process.env.OPENAI_REQ_TIMEOUT_MS || 65000);
  // Build explicit body to avoid sending unsupported params in request body
  const body: any = { model: req.model, messages: req.messages, max_completion_tokens: req.max_completion_tokens };
  if (typeof req.temperature === 'number') body.temperature = req.temperature;
  if (req.response_format) body.response_format = req.response_format;
  const call = () => client.chat.completions.create(body);
  const timeoutPromise = new Promise((_res, rej) => setTimeout(() => rej(Object.assign(new Error('request timeout'), { code: 'timeout' })), timeoutMs));
  let abortPromise: Promise<never> | null = null;
  let onAbort: (() => void) | null = null;
  if (args.signal) {
    abortPromise = new Promise((_r, rej) => {
      onAbort = () => rej(Object.assign(new Error('aborted'), { code: 'aborted' }));
      args.signal!.addEventListener('abort', onAbort);
    });
  }

  try {
    // log request shape (do not include message contents) for debugging unknown-parameter issues
    try {
      const keys = Object.keys(req);
      const msgCount = Array.isArray(req.messages) ? req.messages.length : undefined;
      logger.event('ai.chat.req', { model: req.model, keys, messages_count: msgCount, hasTimeoutField: Object.prototype.hasOwnProperty.call(req, 'timeout') }, 'debug');
    } catch (_) {}

    const res: any = await Promise.race([call(), timeoutPromise, abortPromise].filter(Boolean) as Promise<any>[]);
    const ms = Date.now() - t0;
    const text = res.choices?.[0]?.message?.content ?? '';
    const usage = (res as any).usage || {};
    logger.event('ai.chat.success', {
      model: req.model,
      max: req.max_completion_tokens,
      temperature: req.temperature,
      ms,
      usage,
      choices: res.choices?.length ?? 0,
      request_id: (res as any).id || undefined,
      messages_count: req.messages?.length ?? 0,
    }, 'info');
    const txt = res.choices?.[0]?.message?.content ?? '{}';
    try { return JSON.parse(txt) as T; }
    catch { logger.warn(`JSON parse failed; returning raw content: ${txt.slice(0, 120)}...`); return { raw: txt } as unknown as T; }
  } catch (e:any) {
    const ms = Date.now() - t0;
    logger.event('ai.chat.error', {
      model: req.model,
      max: req.max_completion_tokens,
      temperature: req.temperature,
      ms,
      status: e?.status,
      code: e?.code || e?.code || (e && e.code) || (e && e.name),
      type: e?.type,
      param: e?.param,
      request_id: e?.request_id,
      msg: String(e?.message || e),
    }, 'error');
    throw e;
  } finally {
    if (onAbort && args.signal) args.signal.removeEventListener('abort', onAbort);
  }
}

// テキストで返す版（ストリームなしの簡易API）
export async function chatText(args: ChatArgs): Promise<string> {
  const { model, system, user } = args as ChatArgs;
  const temperature = decideTemperatureToSend(model, args.temperature);
  const max_completion_tokens = (args.max_completion_tokens ?? args.max_tokens ?? 1200);
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: typeof user === 'string' ? user : JSON.stringify(user) });

  const req: any = { model, messages, max_completion_tokens };
  if (typeof temperature === 'number') req.temperature = temperature;

  const body: any = { model: req.model, messages: req.messages, max_completion_tokens: req.max_completion_tokens };
  if (typeof req.temperature === 'number') body.temperature = req.temperature;
  const call = () => client.chat.completions.create(body);
  const timeoutMs = typeof args.request_timeout_ms === 'number' ? args.request_timeout_ms : Number(process.env.OPENAI_REQ_TIMEOUT_MS || 65000);
  const timeoutPromise = new Promise((_res, rej) => setTimeout(() => rej(Object.assign(new Error('request timeout'), { code: 'timeout' })), timeoutMs));
  let abortPromise: Promise<never> | null = null;
  let onAbort: (() => void) | null = null;
  if (args.signal) {
    abortPromise = new Promise((_r, rej) => {
      onAbort = () => rej(Object.assign(new Error('aborted'), { code: 'aborted' }));
      args.signal!.addEventListener('abort', onAbort);
    });
  }

  try {
    const res: any = await Promise.race([call(), timeoutPromise, abortPromise].filter(Boolean) as Promise<any>[]);
    return res.choices?.[0]?.message?.content ?? '';
  } finally {
    if (onAbort && args.signal) args.signal.removeEventListener('abort', onAbort);
  }
}



