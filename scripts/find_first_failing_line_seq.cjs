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
    let acc = '';
    for (let i = 0; i < lines.length; i++) {
      acc += lines[i] + '\n';
      try {
        new vm.Script(acc, { filename: 'tmp' });
      } catch (e) {
        console.log('first failing at line', i+1);
        const start = Math.max(1, i-6);
        const end = Math.min(lines.length, i+3);
        for (let j = start; j <= end; j++) {
          const mark = (j === i+1) ? '>>' : '  ';
          console.log(`${mark} ${String(j).padStart(4)}: ${lines[j-1]}`);
        }
        process.exit(0);
      }
    }
    console.log('no failing prefix found; full script might still fail on final check');
    process.exit(0);
  }
}
console.log('script #5 not found');


