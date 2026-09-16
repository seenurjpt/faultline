// SPEC §12.5: uploads a fixture to the deployed Worker and asserts the result
// through the read API, so a green run means the whole live path works.
//
//   PROCESSOR_URL=… WEB_URL=… npm run smoke [-- path/to/fixture.csv]
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import {
  dataLines,
  parseLine,
  splitLines,
  stripBom,
} from "../core/src/index";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHUNK_ROWS = 2000;

function fail(message: string): never {
  console.error(`FAIL  ${message}`);
  process.exit(1);
}

function pass(message: string): void {
  console.log(`ok    ${message}`);
}

async function main(): Promise<void> {
  const processorUrl = (process.env.PROCESSOR_URL ?? "").replace(/\/$/, "");
  const webUrl = (process.env.WEB_URL ?? "http://localhost:3000").replace(/\/$/, "");
  if (!processorUrl) {
    fail("PROCESSOR_URL is not set. Example: PROCESSOR_URL=https://faultline-processor.you.workers.dev");
  }

  // Pick the fixture: an argument, else the 9d file, else the first CSV.
  const explicit = process.argv[2];
  const fixturesDir = join(ROOT, "fixtures");
  let fixturePath: string;

  if (explicit) {
    fixturePath = explicit;
  } else {
    if (!existsSync(fixturesDir)) fail("No fixtures/ directory and no file given.");
    const csvs = readdirSync(fixturesDir).filter((f) => f.toLowerCase().endsWith(".csv"));
    if (csvs.length === 0) fail("fixtures/ has no CSV files.");
    fixturePath = join(fixturesDir, csvs.find((f) => f.includes("9d")) ?? csvs[0]);
  }
  if (!existsSync(fixturePath)) fail(`No such file: ${fixturePath}`);

  console.log(`\nSmoke test`);
  console.log(`  processor ${processorUrl}`);
  console.log(`  web       ${webUrl}`);
  console.log(`  fixture   ${basename(fixturePath)}\n`);

  // 1. Health
  const health = await fetch(`${processorUrl}/v1/health`);
  const healthBody = (await health.json()) as { ok?: boolean; db?: boolean };
  if (!health.ok || healthBody.db !== true) {
    fail(`health check returned ${health.status} ${JSON.stringify(healthBody)}`);
  }
  pass("health: processor up, database reachable");

  // 2. Pre-flight, locally
  const bytes = readFileSync(fixturePath);
  const text = stripBom(bytes.toString("utf8"));
  const lines = splitLines(text);
  const header = parseLine(lines[0]).map((h) => h.trim());
  const rows = dataLines(lines);
  const chunkCount = Math.ceil(rows.length / CHUNK_ROWS);
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  // 3. Create upload, forcing so a repeat run still exercises the path.
  const create = await fetch(`${processorUrl}/v1/uploads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: basename(fixturePath),
      sizeBytes: bytes.byteLength,
      sha256,
      totalRows: rows.length,
      chunkCount,
      header,
      force: true,
    }),
  });
  if (create.status !== 201) {
    fail(`create upload returned ${create.status}: ${await create.text()}`);
  }
  const { uploadId } = (await create.json()) as { uploadId: string };
  pass(`upload created: ${uploadId}`);

  // 4. Chunks, sequentially, exactly as the browser sends them.
  let sentRows = 0;
  for (let i = 0; i < chunkCount; i++) {
    const slice = rows.slice(i * CHUNK_ROWS, (i + 1) * CHUNK_ROWS);
    const body = `${lines[0]}\n${slice.join("\n")}`;
    const response = await fetch(`${processorUrl}/v1/uploads/${uploadId}/chunks/${i}`, {
      method: "PUT",
      headers: { "Content-Type": "text/csv", "X-Line-Offset": String(2 + i * CHUNK_ROWS) },
      body,
    });
    if (!response.ok) {
      fail(`chunk ${i} returned ${response.status}: ${await response.text()}`);
    }
    const report = (await response.json()) as {
      rowsIn: number; stored: number; mergedInChunk: number;
      mergedAcrossChunks: number; rejected: number;
    };

    // SPEC §6.3: the per-chunk invariant.
    const accounted =
      report.stored + report.mergedInChunk + report.mergedAcrossChunks + report.rejected;
    if (accounted !== report.rowsIn) {
      fail(
        `chunk ${i} invariant broken: rowsIn ${report.rowsIn} != ` +
          `${report.stored}+${report.mergedInChunk}+${report.mergedAcrossChunks}+${report.rejected}`,
      );
    }
    sentRows += report.rowsIn;
  }
  pass(`${chunkCount} chunks accepted, ${sentRows} rows, per-chunk invariant held`);

  // 5. Idempotency: re-send chunk 0 and confirm nothing new is stored.
  const replaySlice = rows.slice(0, CHUNK_ROWS);
  const replay = await fetch(`${processorUrl}/v1/uploads/${uploadId}/chunks/0`, {
    method: "PUT",
    headers: { "Content-Type": "text/csv", "X-Line-Offset": "2" },
    body: `${lines[0]}\n${replaySlice.join("\n")}`,
  });
  if (!replay.ok) fail(`chunk replay returned ${replay.status}`);
  const replayReport = (await replay.json()) as { stored: number };
  if (replayReport.stored !== 0) {
    fail(`replaying a chunk stored ${replayReport.stored} new rows; expected 0`);
  }
  pass("replaying a chunk stored nothing new (idempotent)");

  // 6. Complete
  const complete = await fetch(`${processorUrl}/v1/uploads/${uploadId}/complete`, {
    method: "POST",
  });
  if (!complete.ok) fail(`complete returned ${complete.status}: ${await complete.text()}`);
  const summary = (await complete.json()) as {
    rows: number; stored: number; merged: number; rejected: number;
  };
  if (summary.stored + summary.merged + summary.rejected !== summary.rows) {
    fail(
      `summary does not add up: ${summary.stored}+${summary.merged}+${summary.rejected} != ${summary.rows}`,
    );
  }
  pass(
    `complete: ${summary.rows} rows = ${summary.stored} stored + ` +
      `${summary.merged} merged + ${summary.rejected} rejected`,
  );

  // 7. Read it back through the web API.
  const overview = await fetch(`${webUrl}/api/datasets/${uploadId}/overview?period=all`);
  if (!overview.ok) {
    fail(`overview returned ${overview.status}: ${await overview.text()}`);
  }
  const body = (await overview.json()) as {
    ledger: { serviceId: string; knownSlots: number; downSlots: number; availabilityPct: number }[];
    quality: { stored: number; rejected: number };
  };
  if (body.ledger.length === 0) fail("overview returned an empty ledger");
  pass(`overview: ${body.ledger.length} services`);
  for (const row of body.ledger) {
    console.log(
      `      ${row.serviceId.padEnd(14)} ${String(row.knownSlots).padStart(5)} known  ` +
        `${String(row.downSlots).padStart(3)} down  ${row.availabilityPct.toFixed(3)}%`,
    );
  }

  // 8. Logs endpoint answers and paginates.
  const logs = await fetch(`${webUrl}/api/datasets/${uploadId}/logs?outcome=failures&limit=5`);
  if (!logs.ok) fail(`logs returned ${logs.status}`);
  const logsBody = (await logs.json()) as { rows: unknown[]; total: number; nextCursor: string | null };
  pass(`logs: ${logsBody.total} failures, first page ${logsBody.rows.length} rows`);

  console.log("\nAll smoke checks passed.\n");
}

main().catch((error: unknown) => {
  console.error("\nSmoke test threw:", error);
  process.exit(1);
});
