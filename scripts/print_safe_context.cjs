const fs = require('fs');
const s = fs.readFileSync('public/dashboard.html','utf8');
const re = /<script\b[^>]*data-safe-script=['"]?([A-Za-z0-9_-]+)['"]?[^>]*>([\s\S]*?)<\/script>/i;
const m = s.match(re);
if (!m) { console.error('not found'); process.exit(2); }
const code = m[2];
const lines = code.split(/\r?\n/);
const start = 680;
const end = 705;
for (let i = start; i <= end; i++) {
  const l = lines[i-1] || '';
  console.log(String(i).padStart(4)+': '+l);
}


