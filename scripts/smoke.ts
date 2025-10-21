import { postOnce } from '../src/services/posting';
import { initDb } from '../src/drivers/db';

async function main() {
  const html = `
  <!doctype html>
  <meta charset="utf-8">
  <title>ChatSocialPilot Smoke</title>
  <style>body{font-family:sans-serif;padding:40px} h1{margin:0 0 8px}</style>
  <h1>Smoke OK</h1>
  <p>このページは data: URL で生成されています。</p>`;

  initDb({ wal: true });
  await postOnce({
    userDataDir: 'C:/Profiles/Threads/threadsA',
    headless: true,
    url: 'data:text/html;charset=utf-8,' + encodeURIComponent(html),
    content: 'hello from ChatSocialPilot'
  });
  console.log('smoke done');
}

main().catch((e) => { console.error(e); process.exit(1); });


