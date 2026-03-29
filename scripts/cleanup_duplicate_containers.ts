
import { deleteContainer } from '../src/drivers/browser';

async function main() {
    console.log("Auditing containers...");
    const host = "http://127.0.0.1:3002"; // Hardcoded port as per settings
    const res = await fetch(`${host}/internal/containers`).then(r => r.json());
    if (!res.ok) throw new Error("Failed to fetch containers");

    const containers = res.containers;
    const grouped: Record<string, any[]> = {};

    for (const c of containers) {
        if (!grouped[c.name]) grouped[c.name] = [];
        grouped[c.name].push(c);
    }

    let deleteCount = 0;
    for (const name in grouped) {
        const list = grouped[name];
        if (list.length <= 1) continue;

        // Sort by createdAt ASC (oldest first)
        list.sort((a, b) => a.createdAt - b.createdAt);

        const original = list[0];
        const duplicates = list.slice(1);

        console.log(`Name: ${name} -> Keeping oldest [${original.id}]. Deleting ${duplicates.length} duplicates...`);

        for (const dup of duplicates) {
            console.log(`  Deleting ${dup.id} (Created: ${new Date(dup.createdAt).toISOString()})`);
            const delRes = await deleteContainer(dup.id);
            if (delRes.ok) {
                deleteCount++;
            } else {
                console.error(`  Failed to delete ${dup.id}: ${delRes.error}`);
            }
        }
    }

    console.log(`Cleanup complete. Total deleted: ${deleteCount}`);
}

main().catch(console.error);
