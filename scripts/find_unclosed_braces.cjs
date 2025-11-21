const fs = require('fs');
const path = require('path');
const file = path.resolve('public','dashboard.html');
if (!fs.existsSync(file)) {
  console.error('file not found', file);
  process.exit(2);
}
const html = fs.readFileSync(file,'utf8');
const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
let m, idx = 0;
while ((m = re.exec(html)) !== null) {
  idx++;
  if (idx === 5) {
    const code = m[1];
    const lines = code.split(/\r?\n/);
    const stack = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (let j = 0; j < line.length; j++) {
        const ch = line[j];
        if (ch === '{') stack.push({ ch, line: i+1, col: j+1, context: line.slice(0,80) });
        if (ch === '}') {
          if (stack.length) stack.pop(); else {
            console.log('unmatched } at', i+1, 'col', j+1);
          }
        }
      }
    }
    if (stack.length) {
      console.log('Unclosed { count=', stack.length);
      stack.forEach((s, k) => {
        console.log(`#${k+1} at line ${s.line} col ${s.col}: ${s.context}`);
      });
    } else {
      console.log('No unclosed { found');
    }
    process.exit(0);
  }
}
console.log('script #5 not found');


