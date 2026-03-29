import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const presets = query("SELECT id, name, steps_json FROM presets");
    for (const preset of presets) {
        const urls = preset.steps_json.match(/https?:\/\/[^\s"']+/g) || [];
        const nonSocialUrls = urls.filter(u => !u.includes('twitter.com') && !u.includes('x.com') && !u.includes('threads.net') && !u.includes('google.com') && !u.includes('outlook.com'));
        if (nonSocialUrls.length > 0) {
            console.log(`Preset ID: ${preset.id}, Name: ${preset.name}`);
            console.log(`Non-social URLs:`, nonSocialUrls);
        }
    }
}

main().catch(console.error);
