
import { initDb, run, query } from '../src/drivers/db.js';

async function generateHeitaiPresets() {
    initDb();

    const posts = [
        { id: 'Elizabeth', url: 'https://x.com/ElizabethG76409/status/2034988463897157866' },
        { id: 'rico', url: 'https://x.com/ricochan_diet/status/2033886437368824064' },
        { id: 'mochi', url: 'https://x.com/mochiko_diett/status/2034275899668107661' },
        { id: 'onaka', url: 'https://x.com/onaka_no_yuki/status/2035008333107929103' }
    ];

    const createEvalCode = (targetUrl: string) => {
        return "(async () => {\
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));\
  const targetUrl = '" + targetUrl + "';\
  await sleep(3000);\
  const getCurrentStatusId = () => {\
    const m = window.location.pathname.match(/\\/status\\/(\\d+)/);\
    return m ? m[1] : null;\
  };\
  const currentStatusId = getCurrentStatusId();\
  if (!currentStatusId) return { didAction: true, reason: 'not-status-page', targetUrl };\
\
  const isMatch = (article) => {\
    const links = Array.from(article.querySelectorAll('a[href*=\"/status/\"]'));\
    return links.some(l => (l.getAttribute('href') || '').includes(currentStatusId));\
  };\
\
  const tweets = Array.from(document.querySelectorAll('article[data-testid=\"tweet\"]'))\
    .filter(isMatch);\
\
  if (tweets.length === 0) return { didAction: true, reason: 'no-tweets-found', targetUrl };\
\
  for (let i = 0; i < tweets.length; i += 1) {\
    const article = tweets[i];\
    if (!article) continue;\
    let like = article.querySelector('button[data-testid=\"like\"]');\
    if (!like) {\
        const unlikeFound = article.querySelector('button[data-testid=\"unlike\"]');\
        if (unlikeFound) return { didAction: true, reason: 'already-liked-detected', targetUrl };\
        continue;\
    }\
    const pressed = like.getAttribute('aria-pressed');\
    if (pressed === 'true') return { didAction: true, reason: 'already-liked', targetUrl };\
    try {\
      like.scrollIntoView({ block: 'center' });\
      await sleep(500);\
      like.click();\
      const deadline = Date.now() + 2000;\
      while (Date.now() < deadline) {\
        const unlike = article.querySelector('button[data-testid=\"unlike\"]');\
        like = article.querySelector('button[data-testid=\"like\"]') || like;\
        const likePressed = like?.getAttribute('aria-pressed');\
        if (unlike || likePressed === 'true') {\
          return { didAction: true, index: i, targetUrl };\
        }\
        await sleep(100);\
      }\
      return { didAction: true, reason: 'like-not-confirmed-but-continued', index: i, targetUrl };\
    } catch (err) {\
      return { didAction: true, reason: 'error-but-continued', index: i, targetUrl };\
    }\
  }\
  return { didAction: true, reason: 'no-unliked-found-end', targetUrl };\
})()";
    };

    const createSteps = (targetPosts: typeof posts) => {
        const steps: any[] = [];
        targetPosts.forEach(p => {
            steps.push({
                type: 'navigate',
                url: p.url,
                expected: { urlContains: p.url },
                postWaitSeconds: 30
            });
            steps.push({
                type: 'eval',
                code: createEvalCode(p.url),
                postWaitSeconds: 10
            });
        });
        return steps;
    };

    const configs = [
        { id: 601, name: '[X兵隊] 複数いいね (4件: Elizabeth/rico/mochi/onaka)', posts: posts },
        { id: 602, name: '[X兵隊] 複数いいね (3件: Elizabeth/rico/mochi)', posts: [posts[0], posts[1], posts[2]] },
        { id: 603, name: '[X兵隊] 複数いいね (2件: Elizabeth/rico)', posts: [posts[0], posts[1]] },
        { id: 604, name: '[X兵隊] 1件いいね (Elizabethのみ)', posts: [posts[0]] },
        { id: 605, name: '[X兵隊] 単体いいね (mochikoのみ)', posts: [posts[2]] },
        { id: 606, name: '[X兵隊] 単体いいね (onakaのみ)', posts: [posts[3]] }
    ];

    const now = Date.now();
    for (const conf of configs) {
        const stepsJson = JSON.stringify(createSteps(conf.posts));
        run("INSERT OR REPLACE INTO presets (id, name, steps_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", [
            conf.id,
            conf.name,
            stepsJson,
            now,
            now
        ]);
        console.log("Updated preset " + conf.id);
    }
}

generateHeitaiPresets().catch(console.error);
