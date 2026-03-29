import Database from "better-sqlite3";
const db = new Database("storage/app.db");

const rows = db
  .prepare(
    `
    SELECT tr.status, tr.result_json, t.container_id, t.runId
    FROM task_runs tr
    JOIN tasks t ON tr.runId = t.runId
    WHERE tr.result_json LIKE '%suspended%'
    ORDER BY tr.started_at DESC
    LIMIT 20
`,
  )
  .all();

console.log(`Found ${rows.length} runs with 'suspended' in result_json.`);

rows.forEach((f) => {
  console.log(`--- [${f.status}] Container: ${f.container_id} ---`);
  try {
    const res = JSON.parse(f.result_json);
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
        console.log("Error Message:", suspendedStep.result.body.result.error);
        // We don't have the HTML here, but the error message tells us what was matched.
      }
    }
  } catch (e) {
    console.log("Parse Error");
  }
});
