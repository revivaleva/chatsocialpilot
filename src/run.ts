import fs from 'node:fs';
import path from 'node:path';
import { initDb } from './drivers/db';
import { openCli } from './ui/cli';
import { RuntimeConfig } from './types';

function loadJson<T>(p: string): T {
  return JSON.parse(fs.readFileSync(path.resolve(p), 'utf-8'));
}

async function main() {
  const cfg = loadJson<RuntimeConfig>('config/runtime.json');
  initDb({ wal: cfg.sqlite?.wal ?? true });
  openCli(cfg);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


