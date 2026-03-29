
import fs from 'fs';
import path from 'path';

const logDir = 'logs';
const result: Record<string, { saved: number, skipped: number, total: number, maxPosts: number, keyword?: string }> = {};

async function analyzeLogs() {
    const files = fs.readdirSync(logDir).filter(f => f.startsWith('app-') && f.endsWith('.log'));

    files.forEach(file => {
        const content = fs.readFileSync(path.join(logDir, file), 'utf8');
        const lines = content.split('\n');

        lines.forEach(line => {
            if (!line.trim()) return;
            try {
                const entry = JSON.parse(line);
                const rid = entry.runId;
                if (!rid || entry.presetId !== 28) return;

                if (!result[rid]) {
                    result[rid] = { saved: 0, skipped: 0, total: 0, maxPosts: 0 };
                }

                if (entry.ev === 'task.for.start') {
                    result[rid].maxPosts = entry.max_posts;
                }

                if (entry.ev === 'task.for.save_posts') {
                    result[rid].saved += (entry.saved || 0);
                    result[rid].skipped += (entry.skipped || 0);
                    // entry.total is for this loop, not total.
                }
            } catch (e) {
                // skip invalid json
            }
        });
    });

    console.log("Log Analysis of Threads Posts Retrieval (Preset 28):");
    console.log("Run ID | Saved | Skipped | Target");

    let totalSavedAll = 0;
    let totalSkippedAll = 0;
    let runCount = 0;
    let fullMatchedCount = 0;

    Object.entries(result).sort().forEach(([rid, data]) => {
        if (data.saved === 0 && data.skipped === 0) return; // skip runs with no action
        console.log(`${rid.substring(0, 30)}... | ${data.saved} | ${data.skipped} | ${data.maxPosts}`);
        totalSavedAll += data.saved;
        totalSkippedAll += data.skipped;
        runCount++;
        if (data.saved >= data.maxPosts && data.maxPosts > 0) {
            fullMatchedCount++;
        }
    });

    console.log("\n--- Final Aggregation ---");
    console.log(`Unique Active Runs: ${runCount}`);
    console.log(`Total Saved: ${totalSavedAll}`);
    console.log(`Total Skipped: ${totalSkippedAll}`);
    console.log(`Average Saved per Run: ${(totalSavedAll / runCount).toFixed(1)}`);
    console.log(`Skip Rate: ${(totalSkippedAll / (totalSavedAll + totalSkippedAll) * 100).toFixed(1)}%`);
    console.log(`Target Completion Rate: ${fullMatchedCount}/${runCount} (${((fullMatchedCount / runCount) * 100).toFixed(1)}%)`);
}

analyzeLogs();
