const fs = require('fs');
const path = require('path');
const file = path.resolve('public','dashboard.html');
const html = fs.readFileSync(file,'utf8');
const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
let m, idx = 0;
while ((m = re.exec(html)) !== null) {
  idx++;
  if (idx === 5) {
    const lines = m[1].split(/\r?\n/);
    let p = 0, b = 0, c = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (let j = 0; j < line.length; j++) {
        const ch = line[j];
        if (ch === '(') p++;
        if (ch === ')') { p--; if (p < 0) { console.log('unmatched ) at line', i+1, 'col', j+1); process.exit(0); } }
        if (ch === '{') b++;
        if (ch === '}') { b--; if (b < 0) { console.log('unmatched } at line', i+1, 'col', j+1); process.exit(0); } }
        if (ch === '[') c++;
        if (ch === ']') { c--; if (c < 0) { console.log('unmatched ] at line', i+1, 'col', j+1); process.exit(0); } }
      }
    }
    console.log('balances:', '( )=', p, '{ }=', b, '[ ]=', c);
    console.log('--- script content below ---');
    lines.forEach((L, k) => console.log(String(k+1).padStart(4)+': '+L));
    process.exit(0);
  }
}
console.log('script #5 not found');


