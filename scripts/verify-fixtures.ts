// Runs the core pipeline over the fixtures and prints the SPEC §12 tables, so
// the golden numbers can be checked without a database or a deploy.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  detectIncidents,
  median,
  mergeChecks,
  mergeKey,
  processChunk,
  splitLines,
  stripBom,
  SLOT_MS,
  type CleanCheck,
  type Incident,
  type SlotInput,
} from "../core/src/index";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = join(ROOT, "fixtures");
const CHUNK_ROWS = 2000;

type FileResult = {
  name: string;
  rows: number;
  epoch: number;
  offset: number;
  seconds: number;
  blankLatency: number;
  negativeLatency: number;
  rejected: number;
  stored: number;
  merged: number;
  knownSlots: number;
  expectedSlots: number;
  checks: Map<string, CleanCheck>;
};

/** Processes one fixture in chunks, merging across chunks like the database. */
function runFile(path: string, name: string, chunkRows = CHUNK_ROWS): FileResult {
  const text = stripBom(readFileSync(path, "utf8"));
  const lines = splitLines(text);
  const header = lines[0];
  const body = lines.slice(1).filter((l) => l.trim() !== "");

  const checks = new Map<string, CleanCheck>();
  let rejected = 0;
  let mergedAcross = 0;
  let mergedInChunks = 0;
  const issues: Record<string, number> = {};

  for (let start = 0; start < body.length; start += chunkRows) {
    const slice = body.slice(start, start + chunkRows);
    const chunk = `${header}\n${slice.join("\n")}`;
    const result = processChunk(chunk, 2 + start);

    rejected += result.counts.rejected;
    mergedInChunks += result.counts.mergedInChunk;
    for (const [flag, count] of Object.entries(result.issues)) {
      issues[flag] = (issues[flag] ?? 0) + (count ?? 0);
    }

    // The same upsert the Worker performs, in memory.
    for (const check of result.checks) {
      const key = mergeKey(check);
      const existing = checks.get(key);
      if (existing === undefined) {
        checks.set(key, check);
      } else {
        checks.set(key, mergeChecks(existing, check));
        mergedAcross++;
      }
    }
  }

  // Raw per-row counts (before merging), which is what SPEC §12.1 reports.
  let epoch = 0;
  let offset = 0;
  let seconds = 0;
  let blank = 0;
  let negative = 0;
  for (let start = 0; start < body.length; start += chunkRows) {
    const slice = body.slice(start, start + chunkRows);
    const result = processChunk(`${header}\n${slice.join("\n")}`, 2 + start, undefined);
    for (const check of result.checks) {
      if (check.flags.includes("ts_epoch_converted")) epoch++;
      if (check.flags.includes("ts_offset_converted")) offset++;
      if (check.flags.includes("latency_unit_seconds")) seconds++;
      if (check.flags.includes("latency_missing")) blank++;
      if (check.flags.includes("latency_negative_dropped")) negative++;
    }
  }

  // Known and expected slots across the whole file.
  const slotKeys = new Set<string>();
  let minTime = Infinity;
  let maxTime = -Infinity;
  const services = new Set<string>();
  for (const check of checks.values()) {
    const t = check.checkedAt.getTime();
    slotKeys.add(`${check.serviceId}\u0000${t}`);
    services.add(check.serviceId);
    if (t < minTime) minTime = t;
    if (t > maxTime) maxTime = t;
  }

  const rangeStart = Math.floor(minTime / 86_400_000) * 86_400_000;
  const rangeEnd = Math.floor(maxTime / 86_400_000) * 86_400_000 + 86_400_000;
  const slotsPerService = Math.round((rangeEnd - rangeStart) / SLOT_MS);

  return {
    name,
    rows: body.length,
    epoch,
    offset,
    seconds,
    blankLatency: blank,
    negativeLatency: negative,
    rejected,
    stored: checks.size,
    merged: mergedInChunks + mergedAcross,
    knownSlots: slotKeys.size,
    expectedSlots: slotsPerService * services.size,
    checks,
  };
}

function slotInputs(checks: Map<string, CleanCheck>): Map<string, SlotInput[]> {
  // One slot per service per 15 minutes, worst agent winning (SPEC §8.2).
  const bySlot = new Map<string, { down: boolean; latencies: number[] }>();
  for (const check of checks.values()) {
    const key = `${check.serviceId}\u0000${check.checkedAt.getTime()}`;
    const entry = bySlot.get(key) ?? { down: false, latencies: [] };
    if (check.statusCode < 200 || check.statusCode > 399) entry.down = true;
    if (check.latencyMs !== null) entry.latencies.push(check.latencyMs);
    bySlot.set(key, entry);
  }

  const byService = new Map<string, SlotInput[]>();
  for (const [key, entry] of bySlot) {
    const [serviceId, timeRaw] = key.split("\u0000");
    const list = byService.get(serviceId) ?? [];
    list.push({
      serviceId,
      slot: new Date(Number(timeRaw)),
      isDown: entry.down,
      medianLatencyMs: median(entry.latencies),
    });
    byService.set(serviceId, list);
  }

  for (const list of byService.values()) {
    list.sort((a, b) => a.slot.getTime() - b.slot.getTime());
  }
  return byService;
}

function pad(value: string | number, width: number): string {
  return String(value).padStart(width);
}

function main(): void {
  if (!existsSync(FIXTURES)) {
    console.error(`No fixtures/ directory at ${FIXTURES}.`);
    console.error("Add the five CSVs and dataset_incident_log.json, then re-run.");
    process.exit(1);
  }

  const files = readdirSync(FIXTURES)
    .filter((f) => f.toLowerCase().endsWith(".csv"))
    .sort();

  if (files.length === 0) {
    console.error("fixtures/ has no .csv files.");
    process.exit(1);
  }

  console.log("\nSPEC §12.1 — cleaning totals\n");
  console.log(
    [
      "file".padEnd(34), pad("rows", 7), pad("epoch", 7), pad("+5:30", 7),
      pad("sec", 7), pad("blank", 7), pad("neg", 5), pad("rej", 5),
      pad("stored", 8), pad("merged", 7), pad("known", 7), pad("expect", 7),
    ].join(" "),
  );

  const results: FileResult[] = [];
  for (const file of files) {
    const result = runFile(join(FIXTURES, file), file);
    results.push(result);
    console.log(
      [
        file.padEnd(34), pad(result.rows, 7), pad(result.epoch, 7),
        pad(result.offset, 7), pad(result.seconds, 7), pad(result.blankLatency, 7),
        pad(result.negativeLatency, 5), pad(result.rejected, 5),
        pad(result.stored, 8), pad(result.merged, 7), pad(result.knownSlots, 7),
        pad(result.expectedSlots, 7),
      ].join(" "),
    );
  }

  console.log("\nSPEC §12.2 — availability, whole file (known / down / %)\n");
  for (const result of results) {
    const byService = slotInputs(result.checks);
    const parts: string[] = [];
    for (const [serviceId, slots] of [...byService].sort()) {
      const down = slots.filter((s) => s.isDown).length;
      const pct = ((slots.length - down) / slots.length) * 100;
      parts.push(`${serviceId} ${slots.length}/${down}/${pct.toFixed(3)}`);
    }
    console.log(`${result.name.padEnd(34)} ${parts.join("  ")}`);
  }

  console.log("\nSPEC §12.4 — incidents\n");
  let confirmedTotal = 0;
  const detected: { file: string; incidents: Incident[] }[] = [];

  for (const result of results) {
    const byService = slotInputs(result.checks);
    const incidents: Incident[] = [];
    for (const [serviceId, slots] of [...byService].sort()) {
      const baseline = median(
        slots.map((s) => s.medianLatencyMs).filter((v): v is number => v !== null),
      );
      incidents.push(...detectIncidents(serviceId, slots, baseline));
    }
    incidents.sort((a, b) => a.start.getTime() - b.start.getTime());
    detected.push({ file: result.name, incidents });

    for (const incident of incidents) {
      if (incident.confirmed) confirmedTotal++;
      console.log(
        `${result.name.padEnd(34)} ${incident.serviceId.padEnd(14)} ` +
          `${incident.start.toISOString().slice(0, 16)} → ` +
          `${new Date(incident.end.getTime() - SLOT_MS).toISOString().slice(11, 16)}  ` +
          `${pad(incident.downSlots, 3)} down  ratio ${incident.latencyRatio.toFixed(2)}  ` +
          `${incident.confirmed ? "confirmed" : "unconfirmed"}`,
      );
    }
  }

  // SPEC §9: compare against the provided log by overlap. The log uses 0-based
  // day numbers counted from each file's own start date, and its windows
  // include healthy flapping checks at the edges, so an exact boundary match
  // would fail on incidents this rule detects correctly.
  const logPath = join(FIXTURES, "dataset_incident_log.json");
  if (existsSync(logPath)) {
    type LogEntry = {
      days: number;
      start: string;
      incidents: Record<string, string>;
    };
    const log = JSON.parse(readFileSync(logPath, "utf8")) as Record<
      string,
      LogEntry
    >;

    let logged = 0;
    let matched = 0;
    const unmatched: string[] = [];

    for (const { file, incidents } of detected) {
      const entry = log[file];
      if (!entry) continue;
      const fileStart = Date.parse(`${entry.start}T00:00:00Z`);

      for (const [label, window] of Object.entries(entry.incidents)) {
        logged++;
        // "svc-search day 4" → service and a 0-based day from the file start.
        const parsed = /^(\S+)\s+day\s+(\d+)$/.exec(label.trim());
        // "check-points 48-67 (~12:00-16:45 UTC)" → the slot range that day.
        const points = /check-points\s+(\d+)-(\d+)/.exec(window);
        if (!parsed || !points) {
          unmatched.push(`${file}: could not read "${label}"`);
          continue;
        }

        const serviceId = parsed[1];
        const dayStart = fileStart + Number(parsed[2]) * 86_400_000;
        const from = dayStart + Number(points[1]) * SLOT_MS;
        const to = dayStart + (Number(points[2]) + 1) * SLOT_MS;

        const hit = incidents.find(
          (i) =>
            i.serviceId === serviceId &&
            i.confirmed &&
            i.start.getTime() < to &&
            i.end.getTime() > from,
        );
        if (hit) matched++;
        else unmatched.push(`${file}: ${label} ${window}`);
      }
    }

    console.log(
      `\nLogged incidents: ${logged}. Matched by overlap: ${matched}. ` +
        `Confirmed incidents detected: ${confirmedTotal}.`,
    );
    for (const miss of unmatched) console.log(`  unmatched  ${miss}`);
    if (confirmedTotal > matched) {
      console.log(
        `  note: ${confirmedTotal - matched} confirmed incident(s) are not in the log.`,
      );
    }
  } else {
    console.log(`\nConfirmed incidents detected: ${confirmedTotal}.`);
    console.log("(dataset_incident_log.json not found, so no comparison was made.)");
  }

  // SPEC §12.5: chunk-size invariance.
  console.log("\nSPEC §12.5 — chunk-size invariance\n");
  for (const file of files) {
    const sizes = [1000, 2000, 5000, Number.MAX_SAFE_INTEGER];
    const stored = sizes.map(
      (size) => runFile(join(FIXTURES, file), file, size).stored,
    );
    const same = stored.every((s) => s === stored[0]);
    console.log(
      `${file.padEnd(34)} ${stored.join(" / ")}  ${same ? "identical" : "DIFFERENT"}`,
    );
  }

  console.log("");
}

main();
