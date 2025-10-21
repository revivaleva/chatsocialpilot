import fs from 'node:fs';
import path from 'node:path';
import { chatJson } from '../drivers/openai';
import { RuntimeConfig } from '../types';

type ParseResult = {
  intent: string;
  arguments: Record<string, any>;
  confidence: number;
  missing_fields?: string[];
  risks?: string[];
  user_summary?: string;
};

function readPrompt() {
  return fs.readFileSync(path.resolve('src/agent/system_prompt.md'), 'utf-8');
}

export async function parseIntent(cfg: RuntimeConfig, userText: string): Promise<ParseResult> {
  const sys = readPrompt();
  return await chatJson<ParseResult>({
    model: cfg.models.nlu,
    system: sys,
    user: { text: userText },
    responseJson: true,
    temperature: 0.2,
    max_tokens: 400,
  });
}

export type Toolset = {
  updateConfig: (args: any) => Promise<string>;
  runBenchmark: (args: any) => Promise<string>;
  createJob: (args: any) => Promise<string>;
  healingRequest: (args: any) => Promise<string>;
};

export async function routeByIntent(cfg: RuntimeConfig, parsed: ParseResult, tools: Toolset) {
  const floor = cfg.routing.confidenceFloor;
  if (parsed.intent === 'ask_clarify' || parsed.confidence < floor) {
    return `不足情報があります: ${parsed.missing_fields?.join(', ') || '未特定'}`;
  }
  switch (parsed.intent) {
    case 'update_config':   return tools.updateConfig(parsed.arguments);
    case 'run_benchmark':   return tools.runBenchmark(parsed.arguments);
    case 'create_job':      return tools.createJob(parsed.arguments);
    case 'healing_request': return tools.healingRequest(parsed.arguments);
    default:                return `未対応 intent: ${parsed.intent}`;
  }
}


