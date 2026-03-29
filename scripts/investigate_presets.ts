
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    console.log('Investigating Threads presets...');

    const presets = query(`
        SELECT id, name, steps_json 
        FROM presets 
        WHERE name LIKE '%Threads%' OR id = 28
    `);

    console.log(`Found ${presets.length} presets.`);

    presets.forEach((p: any) => {
        console.log(`\n--- Preset ID: ${p.id}, Name: ${p.name} ---`);
        try {
            const steps = JSON.parse(p.steps_json);
            steps.forEach((s: any, i: number) => {
                console.log(`Step ${i}: ${s.type} - ${s.description || 'No description'}`);
                if (s.type === 'for' && s.steps) {
                    s.steps.forEach((ss: any, ii: number) => {
                        console.log(`  Sub-step ${ii}: ${ss.type} - ${ss.description || 'No description'}`);
                        if (ss.type === 'eval' && ss.code) {
                            console.log(`    Eval Code Snippet: ${ss.code.substring(0, 200)}...`);
                            // Check for filters
                            if (ss.code.includes('likeCount <')) {
                                const match = ss.code.match(/likeCount < (\d+)/);
                                console.log(`    Like Filter: < ${match ? match[1] : 'unknown'}`);
                            }
                            if (ss.code.includes('hasHiragana')) {
                                console.log(`    Language Filter: Japanese check present`);
                            }
                        }
                    });
                }
            });
        } catch (e) {
            console.log('Error parsing steps_json');
        }
    });
}

main().catch(console.error);
