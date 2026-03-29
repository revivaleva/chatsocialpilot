
import { closeContainer } from '../src/drivers/browser';

async function cleanup() {
    const ids = [
        '965d941e-1f17-4887-9950-071a64142b74', // AvdainL71238
        '928d2394-e322-4063-b2e1-13825ab9d6ee', // barbara75955314
        '158bd403-bf42-42fa-a645-374d1bbb7b5c', // barbara76596490
        '1c294de5-be4d-4050-890b-f17b63799f82'  // JohnDav23449715
    ];

    console.log("Cleaning up testing containers...");
    for (const id of ids) {
        try {
            await closeContainer({ id });
            console.log(`Closed: ${id}`);
        } catch (e) {
            console.log(`Failed to close ${id} (already closed or error)`);
        }
    }
    console.log("Cleanup done.");
}

cleanup().catch(console.error);
