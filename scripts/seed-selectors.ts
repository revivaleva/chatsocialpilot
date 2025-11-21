import { initDb, run } from '../src/drivers/db';

function insert(site: string, key: string, candidates: any[], score = 0.6) {
  const now = new Date().toISOString();
  const locJson = JSON.stringify(candidates);
  run('INSERT INTO selectors(site_hash, key, locator_json, success_rate, updated_at) VALUES (?, ?, ?, ?, ?)',
    [site, key, locJson, score, now]);
  console.log(`seeded: ${site} ${key} x${candidates.length}`);
}

async function main(){
  initDb({ wal: true });

  // Threads 想定（必要に応じて site を変更）
  const site = 'www.threads.net';

  insert(site, 'text_area', [
    { strategy:'getByRole', locator:'textbox' },
    { strategy:'css', locator:'[contenteditable="true"]' },
    { strategy:'css', locator:'textarea' },
  ], 0.7);

  insert(site, 'post_button', [
    { strategy:'getByText', locator:'投稿' },
    { strategy:'getByText', locator:'Post' },
    { strategy:'getByText', locator:'Share' },
  ], 0.6);

  console.log('seed done');
}
main();





