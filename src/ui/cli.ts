import readline from 'node:readline';
import { parseIntent, routeByIntent } from '../agent/core';
import { makeTools } from '../agent/tools';
import { RuntimeConfig } from '../types';

export function openCli(cfg: RuntimeConfig) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const tools = makeTools(cfg);

  const ask = () => rl.question('> ', async (line) => {
    if (!line.trim()) return ask();
    if (line.trim() === 'exit') return rl.close();
    try {
      const parsed = await parseIntent(cfg, line);
      const out = await routeByIntent(cfg, parsed, tools);
      console.log(out);
    } catch (e) {
      console.error('Error:', e);
    } finally {
      ask();
    }
  });

  console.log('ChatOps CLI: "exit" で終了');
  ask();
}


