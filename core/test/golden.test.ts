// SPEC §12.1–§12.4: the acceptance numbers. These run the full pipeline over
// the real fixtures in chunks of 2,000 and simulate the database merge across
// chunks in memory.
//
// The fixtures are not in the repository. When they are absent these tests
// skip with a message rather than passing silently on no data.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  clean,
  createContext,
  detectIncidents,
  headerIndex,
  median,
  mergeChecks,
  mergeKey,
  parseLine,
  processChunk,
  splitLines,
  stripBom,
  SLOT_MS,
  type CleanCheck,
  type SlotInput,
} from "../src/index";

const FIXTURES = join(process.cwd(), "fixtures");
const hasFixtures =
  existsSync(FIXTURES) &&
  readdirSync(FIXTURES).some((f) => f.toLowerCase().endsWith(".csv"));

// SPEC §12.1, keyed by the distinctive part of each filename.
const GOLDEN_CLEANING: Record<
  string,
  {
    rows: number; epoch: number; offset: number; seconds: number;
    blank: number; negative: number; rejected: number; stored: number;
    merged: number; knownSlots: number; expectedSlots: number;
  }
> = {
  "9d": { rows: 4672, epoch: 70, offset: 32, seconds: 935, blank: 56, negative: 1, rejected: 1, stored: 4664, merged: 7, knownSlots: 4319, expectedSlots: 4320 },
  "12d": { rows: 6230, epoch: 93, offset: 43, seconds: 1242, blank: 74, negative: 1, rejected: 1, stored: 6219, merged: 10, knownSlots: 5759, expectedSlots: 5760 },
  "14d": { rows: 7269, epoch: 109, offset: 50, seconds: 1452, blank: 87, negative: 1, rejected: 1, stored: 7256, merged: 12, knownSlots: 6720, expectedSlots: 6720 },
  "21d": { rows: 10904, epoch: 163, offset: 76, seconds: 2184, blank: 130, negative: 1, rejected: 1, stored: 10885, merged: 18, knownSlots: 10079, expectedSlots: 10080 },
  "30d": { rows: 15577, epoch: 233, offset: 109, seconds: 3131, blank: 186, negative: 1, rejected: 1, stored: 15551, merged: 25, knownSlots: 14399, expectedSlots: 14400 },
};

// SPEC §12.2: whole-file known / down slots per service.
const GOLDEN_AVAILABILITY: Record<string, Record<string, [number, number]>> = {
  "9d":  { "svc-auth": [864, 4],   "svc-notify": [864, 3],   "svc-payments": [863, 4],  "svc-reports": [864, 21],  "svc-search": [864, 9] },
  "12d": { "svc-auth": [1151, 6],  "svc-notify": [1152, 3],  "svc-payments": [1152, 13], "svc-reports": [1152, 27], "svc-search": [1152, 28] },
  "14d": { "svc-auth": [1344, 5],  "svc-notify": [1344, 32], "svc-payments": [1344, 14], "svc-reports": [1344, 47], "svc-search": [1344, 7] },
  "21d": { "svc-auth": [2016, 4],  "svc-notify": [2016, 3],  "svc-payments": [2016, 46], "svc-reports": [2016, 54], "svc-search": [2015, 17] },
  "30d": { "svc-auth": [2879, 29], "svc-notify": [2880, 8],  "svc-payments": [2880, 34], "svc-reports": [2880, 82], "svc-search": [2880, 29] },
};

function fixtureFor(tag: string): string | null {
  if (!hasFixtures) return null;
  const match = readdirSync(FIXTURES).find(
    (f) => f.toLowerCase().endsWith(".csv") && f.includes(tag),
  );
  return match ? join(FIXTURES, match) : null;
}

type Processed = {
  checks: Map<string, CleanCheck>;
  rejected: number;
  merged: number;
  rows: number;
  flagCounts: Record<string, number>;
};

/** Runs a fixture through the pipeline, merging across chunks as the DB does. */
function runFixture(path: string, chunkRows = 2000): Processed {
  const lines = splitLines(stripBom(readFileSync(path, "utf8")));
  const header = lines[0];
  const body = lines.slice(1).filter((l) => l.trim() !== "");

  const checks = new Map<string, CleanCheck>();
  const flagCounts: Record<string, number> = {};
  let rejected = 0;
  let merged = 0;

  // SPEC §12.1 counts columns like "Seconds unit" and "Epoch" per *row* in
  // the file. processChunk already merges duplicates within its chunk, so
  // counting its output would lose one instance per merged pair. These
  // counts therefore come from cleaning each row on its own.
  const ctx = createContext();
  const headerLength = parseLine(header).length;
  const index = headerIndex(header);
  const unitColumn = index.latency_unit;
  body.forEach((line, i) => {
    const fields = parseLine(line);
    const result = clean(fields, index, 2 + i, ctx, headerLength);
    if (result.kind === "check") {
      for (const flag of result.check.flags) {
        flagCounts[flag] = (flagCounts[flag] ?? 0) + 1;
      }
      return;
    }
    // A rejected row still declared a unit, and §12.1's "Seconds unit"
    // column counts the file's rows, not just the ones that survived. The
    // `999` row in the 14d and 21d files reports seconds.
    if (unitColumn !== undefined) {
      const unit = (fields[unitColumn] ?? "").trim().toLowerCase();
      if (unit === "s") {
        flagCounts.latency_unit_seconds =
          (flagCounts.latency_unit_seconds ?? 0) + 1;
      }
    }
  });

  for (let start = 0; start < body.length; start += chunkRows) {
    const slice = body.slice(start, start + chunkRows);
    const result = processChunk(`${header}\n${slice.join("\n")}`, 2 + start);
    rejected += result.counts.rejected;
    merged += result.counts.mergedInChunk;

    for (const check of result.checks) {
      const key = mergeKey(check);
      const existing = checks.get(key);
      if (existing === undefined) {
        checks.set(key, check);
      } else {
        checks.set(key, mergeChecks(existing, check));
        merged++;
      }
    }
  }

  return { checks, rejected, merged, rows: body.length, flagCounts };
}

function slotsByService(checks: Map<string, CleanCheck>): Map<string, SlotInput[]> {
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

describe.skipIf(!hasFixtures)("SPEC §12.1 cleaning totals", () => {
  for (const [tag, golden] of Object.entries(GOLDEN_CLEANING)) {
    it(`${tag} fixture reproduces the golden row`, () => {
      const path = fixtureFor(tag);
      if (!path) {
        throw new Error(`No fixture matching "${tag}" in fixtures/`);
      }

      const result = runFixture(path);
      expect(result.rows, "rows").toBe(golden.rows);
      expect(result.rejected, "rejected").toBe(golden.rejected);
      expect(result.checks.size, "stored checks").toBe(golden.stored);
      expect(result.merged, "merged").toBe(golden.merged);
      expect(result.flagCounts.ts_epoch_converted ?? 0, "epoch").toBe(golden.epoch);
      expect(result.flagCounts.ts_offset_converted ?? 0, "+05:30").toBe(golden.offset);
      expect(result.flagCounts.latency_unit_seconds ?? 0, "seconds").toBe(golden.seconds);
      expect(result.flagCounts.latency_negative_dropped ?? 0, "negative").toBe(golden.negative);

      // Known slots across all services.
      const slotKeys = new Set<string>();
      for (const check of result.checks.values()) {
        slotKeys.add(`${check.serviceId}\u0000${check.checkedAt.getTime()}`);
      }
      expect(slotKeys.size, "known slots").toBe(golden.knownSlots);
    });
  }
});

describe.skipIf(!hasFixtures)("SPEC §12.2 whole-file availability", () => {
  for (const [tag, expected] of Object.entries(GOLDEN_AVAILABILITY)) {
    it(`${tag} fixture matches known/down slots per service`, () => {
      const path = fixtureFor(tag);
      if (!path) throw new Error(`No fixture matching "${tag}"`);

      const byService = slotsByService(runFixture(path).checks);
      for (const [serviceId, [known, down]] of Object.entries(expected)) {
        const slots = byService.get(serviceId) ?? [];
        expect(slots.length, `${serviceId} known`).toBe(known);
        expect(slots.filter((s) => s.isDown).length, `${serviceId} down`).toBe(down);
      }
    });
  }
});

describe.skipIf(!hasFixtures)("SPEC §12.5 chunk-size invariance", () => {
  it("chunk sizes 1,000 / 2,000 / 5,000 / whole file give identical checks", () => {
    const path = fixtureFor("9d") ?? fixtureFor("12d");
    if (!path) throw new Error("No fixture available");

    const sizes = [1000, 2000, 5000, Number.MAX_SAFE_INTEGER];
    const runs = sizes.map((size) => runFixture(path, size));
    const first = runs[0];

    for (const run of runs.slice(1)) {
      expect(run.checks.size).toBe(first.checks.size);
      // Same keys, and the surviving row for each key is the same.
      for (const [key, check] of first.checks) {
        const other = run.checks.get(key);
        expect(other, `key ${key}`).toBeDefined();
        expect(other?.statusCode).toBe(check.statusCode);
        expect(other?.latencyMs).toBe(check.latencyMs);
        expect(other?.sourceLine).toBe(check.sourceLine);
      }
    }
  });
});

describe.skipIf(!hasFixtures)("SPEC §12.4 incidents", () => {
  it("detects the logged incidents with no false confirmations", () => {
    const logPath = join(FIXTURES, "dataset_incident_log.json");
    const path = fixtureFor("30d");
    if (!path) throw new Error("No 30d fixture");

    const byService = slotsByService(runFixture(path).checks);
    const confirmed: { serviceId: string; start: string; downSlots: number }[] = [];

    for (const [serviceId, slots] of byService) {
      const baseline = median(
        slots.map((s) => s.medianLatencyMs).filter((v): v is number => v !== null),
      );
      for (const incident of detectIncidents(serviceId, slots, baseline)) {
        if (incident.confirmed) {
          confirmed.push({
            serviceId,
            start: incident.start.toISOString(),
            downSlots: incident.downSlots,
          });
        }
      }
    }

    // SPEC §12.4: the 30d file has exactly two confirmed incidents.
    expect(confirmed).toHaveLength(2);
    const auth = confirmed.find((c) => c.serviceId === "svc-auth");
    const reports = confirmed.find((c) => c.serviceId === "svc-reports");
    expect(auth?.start).toBe("2025-04-22T04:00:00.000Z");
    expect(auth?.downSlots).toBe(18);
    expect(reports?.start).toBe("2025-04-09T11:45:00.000Z");
    expect(reports?.downSlots).toBe(7);

    if (existsSync(logPath)) {
      const raw = JSON.parse(readFileSync(logPath, "utf8")) as unknown;
      expect(raw, "incident log parsed").toBeTruthy();
    }
  });
});

describe.skipIf(hasFixtures)("golden tests", () => {
  it("skipped: add the fixtures to fixtures/ to run them", () => {
    // Visible in the report so an empty fixtures/ never reads as a pass.
    expect(hasFixtures).toBe(false);
  });
});

// A tiny guard so the slot maths above cannot drift silently.
describe("slot arithmetic", () => {
  it("uses 15-minute slots", () => {
    expect(SLOT_MS).toBe(900_000);
  });
});
