import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';

async function main(){
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const cfgPath = path.resolve('config','ft.json');
  let id = process.argv[2];
  if (!id && fs.existsSync(cfgPath)) {
    try { id = JSON.parse(fs.readFileSync(cfgPath,'utf8')).last_job_id; } catch {}
  }
  if (!id) { console.error('no job id'); process.exit(1); }
  const job = await client.fineTunes.retrieve(id as string);
  console.log('job:', job);
  if (job && (job as any).fine_tuned_model) {
    const cfg = JSON.parse(fs.readFileSync(cfgPath,'utf8')||'{}');
    cfg.last_model = (job as any).fine_tuned_model;
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
    console.log('recorded model id', cfg.last_model);
  }
}

main().catch(e=>{ console.error(e); process.exit(1); });




