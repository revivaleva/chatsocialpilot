const fs = require('fs');
const vm = require('vm');
const path = require('path');
const file = path.resolve('public','dashboard.html');
const html = fs.readFileSync(file,'utf8');
const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
let m, idx = 0;
while ((m = re.exec(html)) !== null) {
  idx++;
  if (idx === 5) {
    const lines = m[1].split(/\r?\n/);
    let lo = 1, hi = lines.length, badAt = -1;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const tryCode = lines.slice(0, mid).join('\n');
      try {
        new vm.Script(tryCode, { filename: 'dash_pref' });
        // parsed ok up to mid
        lo = mid + 1;
      } catch (e) {
        badAt = mid;
        hi = mid - 1;
      }
    }
    console.log('first failing line:', badAt);
    console.log('--- context around failure ---');
    const start = Math.max(1, badAt - 6);
    const end = Math.min(lines.length, badAt + 2);
    for (let i = start; i <= end; i++) {
      const mark = (i === badAt) ? '>>' : '  ';
      console.log(`${mark} ${String(i).padStart(4)}: ${lines[i-1]}`);
    }
    process.exit(0);
  }
}
console.log('script #5 not found');


