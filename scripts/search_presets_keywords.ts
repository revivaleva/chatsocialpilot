import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const keywords = ['birthday', 'phone_number', 'last_name', 'first_name', 'last_kananame'];
    const presets = query("SELECT id, name, steps_json FROM presets");

    for (const preset of presets) {
        for (const kw of keywords) {
            if (preset.steps_json.includes(kw)) {
                console.log(`Match! Preset ID: ${preset.id}, Name: ${preset.name}, Keyword: ${kw}`);
            }
        }
    }
}

main().catch(console.error);
