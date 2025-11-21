import OpenAI from 'openai';
import { run, query } from '../drivers/db';
import { logger } from '../utils/logger';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function embedText(text: string) {
  const model = process.env.RAG_EMBED_MODEL || '';
  if (!model) return null;
  try {
    const res = await client.embeddings.create({ model, input: text });
    return res.data?.[0]?.embedding || null;
  } catch (e:any) { logger.event('rag.embed.err', { err: String(e) }, 'error'); return null; }
}

export function upsertKbDoc(doc: {type:string, scope:string, title:string, content:string}) {
  const now = Date.now();
  return run('INSERT INTO kb_docs(type,scope,title,content,updated_at) VALUES(?,?,?,?,?)', [doc.type, doc.scope, doc.title, doc.content, now]);
}

export function retrieve(q: {query:string, scope?:string, topK?:number}) {
  const rows = query<any>('SELECT id,title,content,embedding_json FROM kb_docs WHERE scope = ? OR ? IS NULL', [q.scope||null, q.scope||null]);
  // fallback simple scoring: count tokens in title/content
  const toks = (q.query||'').toLowerCase().split(/\s+/).filter(Boolean);
  const scored = rows.map((r:any)=>{
    const hay = ((r.title||'') + ' ' + (r.content||'')).toLowerCase();
    let score = 0; for (const t of toks) if (hay.includes(t)) score += 1;
    return { r, score };
  }).sort((a:any,b:any)=>b.score-a.score).slice(0, q.topK||5).map(x=>x.r);
  return scored;
}




