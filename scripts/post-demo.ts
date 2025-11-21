import { initDb } from '../src/drivers/db';
import { postOnce } from '../src/services/posting';

async function main() {
  initDb({ wal: true });
  await postOnce({
    userDataDir: 'C:/Profiles/Threads/threadsA', // 実在パスに変更可
    headless: false,                               // 初回は手動ログインのため可視化推奨
    url: 'https://www.threads.net/',               // data: での検証も可
    content: 'Hello from ChatSocialPilot (demo)'
  });
  console.log('post-demo done');
}

main().catch((e) => { console.error(e); process.exit(1); });


