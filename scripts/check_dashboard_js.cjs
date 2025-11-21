#!/usr/bin/env node
// Simple checker: extract inline <script> blocks from public/dashboard.html and attempt to parse them with new Function()
const fs = require('fs');
const path = require('path');

const file = path.resolve('public','dashboard.html');
if (!fs.existsSync(file)) {
  console.error('file not found', file);
  process.exit(2);
}
const html = fs.readFileSync(file,'utf8');
const scripts = [];
const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
let m;
while ((m = re.exec(html)) !== null) {
  scripts.push(m[1]);
}
if (!scripts.length) {
  console.log('no scripts found');
  process.exit(0);
}
let ok = true;
scripts.forEach((s, idx) => {
  try {
    // wrap in function to parse
    new Function(s);
    console.log(`[ok] script #${idx+1} parsed`);
  } catch (e) {
    ok = false;
    console.error(`[syntax error] script #${idx+1}:`, e && e.message ? e.message : String(e));
    // show snippet around possible error position if possible
    if (e && e.loc && typeof e.loc.line === 'number') {
      const lines = s.split(/\r?\n/);
      const L = Math.max(0, e.loc.line - 4);
      const R = Math.min(lines.length, e.loc.line + 3);
      console.error('--- context ---');
      for (let i=L;i<R;i++) {
        const no = i+1;
        console.error((no===e.loc.line? '>' : ' ') + String(no).padStart(4) + ': ' + lines[i]);
      }
      console.error('--- end ---');
    }
  }
});
process.exit(ok?0:1);


