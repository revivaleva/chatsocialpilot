const acorn = require('acorn');
const fs = require('fs');
const s = fs.readFileSync('public/dashboard.html', 'utf8');
const re = /<script\b[^>]*data-safe-script=['\"]?([A-Za-z0-9_-]+)['\"]?[^>]*>([\s\S]*?)<\/script>/i;
const m = s.match(re);
if (!m) {
  console.error('safe script not found');
  process.exit(2);
}
const id = m[1];
const code = m[2];
try {
  acorn.parse(code, { ecmaVersion: 2023, sourceType: 'script' });
  console.log('parsed ok');
} catch (e) {
  console.error('parse error:', e.message);
  console.error('loc:', e.loc);
  const lines = code.split(/\\r?\\n/);
  const ln = e.loc && e.loc.line ? e.loc.line : null;
  const start = Math.max(1, (ln || 1) - 5);
  const end = Math.min(lines.length, (ln || 1) + 5);
  for (let i = start; i <= end; i++) {
    const mark = (i === ln) ? '>>' : '  ';
    console.error(`${mark} ${String(i).padStart(4)}: ${lines[i-1]}`);
  }
  process.exit(1);
}


