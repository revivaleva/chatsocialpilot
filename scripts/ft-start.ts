import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';

async function main(){
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const src = path.resolve(process.env.FT_INPUT || 'logs/dataset.clean.jsonl');
  if (!fs.existsSync(src)) { console.error('input not found:', src); process.exit(1); }
  console.log('uploading', src);
  const up = await client.files.create({ file: fs.createReadStream(src) as any, purpose: 'fine-tune' });
  console.log('uploaded id=', up.id);
  const base = process.env.FT_BASE_MODEL || 'gpt-4o-mini';
  const job = await client.fineTunes.create({ training_file: up.id, model: base });
  console.log('job created id=', job.id);
  const cfg = { last_job_id: job.id, base_model: base, created_at: Date.now() };
  fs.writeFileSync(path.resolve('config','ft.json'), JSON.stringify(cfg, null, 2), 'utf8');
}

main().catch(e=>{ console.error(e); process.exit(1); });




