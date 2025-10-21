import fs from 'node:fs';
import path from 'node:path';
import { RuntimeConfig } from '../types';

export function makeTools(cfg: RuntimeConfig) {
  return {
    async updateConfig(args: { file: 'runtime' | 'policy'; patch: any }) {
      const file = args.file === 'runtime' ? 'config/runtime.json' : 'config/policy.json';
      const p = path.resolve(file);
      const current = JSON.parse(fs.readFileSync(p, 'utf-8'));
      const merged = { ...current, ...args.patch };
      fs.writeFileSync(p, JSON.stringify(merged, null, 2), 'utf-8');
      return `更新しました: ${file}`;
    },

    async runBenchmark(args: { concurrency?: number; durationMin?: number }) {
      const c = args.concurrency ?? cfg.maxConcurrentBrowsers ?? 4;
      const d = args.durationMin ?? 10;
      return `ベンチ開始（ダミー）: concurrency=${c} duration=${d}min。実行は "npm run bench" を使用してください。`;
    },

    async createJob(args: { kind: string; params: any }) {
      return `ジョブ作成を受理: kind=${args.kind}`;
    },

    async healingRequest(args: { url: string }) {
      return `自己修復要求を受理: ${args.url}`;
    },
  };
}


