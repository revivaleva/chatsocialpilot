import fs from 'node:fs';
import path from 'node:path';

function randMs(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function main() {
  const csvPath = path.resolve('logs', `bench-${Date.now()}.csv`);
  if (!fs.existsSync('logs')) fs.mkdirSync('logs', { recursive: true });
  const rows = ['ts,jobMs,ok'];
  for (let i = 0; i < 50; i++) {
    const t = Date.now();
    const ms = randMs(120, 1200);
    await new Promise((r) => setTimeout(r, ms));
    const ok = Math.random() < 0.95 ? 1 : 0;
    rows.push(`${new Date(t).toISOString()},${ms},${ok}`);
  }
  fs.writeFileSync(csvPath, rows.join('\n'), 'utf-8');
  console.log(`Bench CSV written: ${csvPath}`);
}

main();


