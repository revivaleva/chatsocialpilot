import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

function maskSensitive(text: string) {
  if (!text) return text;
  text = text.replace(/sk-[A-Za-z0-9-_]{20,}/g, 'sk-******');
  text = text.replace(/[A-Za-z0-9-_]{40,}/g, '****');
  text = text.replace(/([A-Za-z]:\\[^\s]+)/g, (m)=>{
    const parts = m.split('\\');
    if (parts.length <= 4) return m;
    return `...\\${parts.slice(-3).join('\\')}`;
  });
  return text;
}

function sha1(s:string){ return crypto.createHash('sha1').update(s).digest('hex'); }

async function main(){
  const src = path.resolve('logs','dataset.jsonl');
  const dst = path.resolve('logs','dataset.clean.jsonl');
  if (!fs.existsSync(src)) { console.error('no dataset.jsonl'); process.exit(1); }
  const lines = fs.readFileSync(src,'utf8').split('\n').filter(Boolean);
  const map = new Map<string,{line:string,ts:number}>();
  for (const l of lines) {
    try{
      const j = JSON.parse(l);
      // normalize messages to mask
      if (Array.isArray(j.messages)) {
        for (const m of j.messages) if (m && typeof m.content==='string') m.content = maskSensitive(m.content);
      }
      const key = sha1(JSON.stringify(j.messages||[]));
      map.set(key, { line: JSON.stringify(j), ts: j.ts || Date.now() });
    } catch(e){ /* skip */ }
  }
  // keep latest per key
  const items = Array.from(map.values()).sort((a,b)=>a.ts - b.ts);
  const ws = fs.createWriteStream(dst, { encoding:'utf8' });
  for (const it of items) ws.write(it.line + '\n');
  ws.end();
  console.log('wrote', dst, items.length);
}

main().catch(e=>{ console.error(e); process.exit(1); });




