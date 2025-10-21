import OpenAI from 'openai';
import { logger } from '../utils/logger';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export type ChatArgs = {
  model: string;
  system?: string;
  user: string | object;
  responseJson?: boolean;
  temperature?: number;
  max_tokens?: number;
};

export async function chatJson<T = unknown>(args: ChatArgs): Promise<T> {
  const { model, system, user, responseJson = true, temperature = 0.2, max_tokens } = args;
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: typeof user === 'string' ? user : JSON.stringify(user) });

  const res = await client.chat.completions.create({
    model, messages, temperature, max_tokens,
    response_format: responseJson ? { type: 'json_object' } : undefined,
  });

  const txt = res.choices[0]?.message?.content ?? '{}';
  try { return JSON.parse(txt) as T; }
  catch { logger.warn(`JSON parse failed; returning raw content: ${txt.slice(0, 120)}...`); return { raw: txt } as unknown as T; }
}


