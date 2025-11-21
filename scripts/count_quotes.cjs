const fs = require('fs');
const path = require('path');
const file = path.resolve('public','dashboard.html');
const html = fs.readFileSync(file,'utf8');
const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
let m, idx = 0;
while ((m = re.exec(html)) !== null) {
  idx++;
  if (idx === 5) {
    const code = m[1];
    console.log('backticks', (code.match(/`/g)||[]).length);
    console.log('single', (code.match(/'/g)||[]).length);
    console.log('double', (code.match(/"/g)||[]).length);
    break;
  }
}


