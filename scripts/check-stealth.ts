import { initDb } from "../src/drivers/db.js";
import { evalInContext, execInContainer } from "../src/drivers/browser.ts";

async function main() {
  initDb();

  const containerId = "335f2182-a060-4fc7-99e6-b873c8971d56";
  const url = "https://bot.sannysoft.com/"; // ブラウザの秘匿性チェックサイト

  console.log(`Checking stealth status at ${url}...`);
  await execInContainer(containerId, "navigate", { url });
  await new Promise((r) => setTimeout(r, 10000));

  // 結果をスクショ
  const shot = await execInContainer(
    containerId,
    "eval",
    { eval: "null" },
    { screenshot: true },
  );
  console.log("Stealth Check Screenshot:", shot.screenshotPath);

  // IP/Proxy 情報を確認
  console.log("Checking IP/Proxy info...");
  await execInContainer(containerId, "navigate", {
    url: "https://api.ipify.org?format=json",
  });
  await new Promise((r) => setTimeout(r, 3000));
  const ipResult = await evalInContext(containerId, "document.body.innerText");
  console.log("Current IP:", ipResult.result);
}

main().catch(console.error);
