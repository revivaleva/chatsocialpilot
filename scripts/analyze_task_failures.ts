import Database from "better-sqlite3";
const db = new Database("storage/app.db");

const rows = db
  .prepare(
    `
    SELECT tr.status, tr.result_json, t.container_id, t.runId
    FROM task_runs tr
    JOIN tasks t ON tr.runId = t.runId
    WHERE tr.started_at > ?
    ORDER BY tr.started_at DESC
`,
  )
  .all(Date.now() - 24 * 3600 * 1000);

console.log(`Found ${rows.length} runs in the last 24 hours.`);

const failures = rows.filter((r) => r.status !== "ok" && r.status !== "done");
console.log(`Failures/Non-OK: ${failures.length}`);

failures.slice(0, 10).forEach((f) => {
  console.log(`--- [${f.status}] Container: ${f.container_id} ---`);
  try {
    const res = JSON.parse(f.result_json);
    console.log("Error:", res.error || res.message || "Unknown error");
    if (res.results) {
      const suspendedStep = res.results.find(
        (s) =>
          s.result &&
          s.result.body &&
          s.result.body.result &&
          s.result.body.result.suspended,
      );
      if (suspendedStep) {
        console.log("Suspended detected by step:", suspendedStep.stepIndex);
        console.log("Eval Result:", suspendedStep.result.body.result);
      }
    }
  } catch (e) {
    console.log("Raw Result:", f.result_json);
  }
});
