import { describe, expect, it } from "vitest";
import { mergeChecks, mergeKey, mergeWithinChunk } from "../src/merge";
import { processChunk } from "../src/pipeline";
import { splitLines, parseLine } from "../src/csv";
import type { CleanCheck } from "../src/types";

function check(overrides: Partial<CleanCheck> = {}): CleanCheck {
  return {
    serviceId: "svc-auth",
    serviceName: "auth-api",
    checkedAt: new Date("2025-04-06T00:00:00.000Z"),
    agent: "agent-1",
    region: "ap-south-1",
    statusCode: 200,
    latencyMs: 142,
    tsFormat: "iso_utc",
    rawTimestamp: "2025-04-06T00:00:00Z",
    sourceLine: 2,
    flags: [],
    ...overrides,
  };
}

describe("SPEC §7.4 merge rule", () => {
  it("a failure beats a success", () => {
    const merged = mergeChecks(
      check({ statusCode: 200, sourceLine: 2 }),
      check({ statusCode: 503, sourceLine: 9 }),
    );
    expect(merged.statusCode).toBe(503);
    expect(merged.flags).toContain("merged_duplicate");
    expect(merged.flags).toContain("status_conflict_same_agent");
  });

  it("a failure seen first is not overwritten by a later success", () => {
    const merged = mergeChecks(
      check({ statusCode: 500, sourceLine: 2 }),
      check({ statusCode: 200, sourceLine: 9 }),
    );
    expect(merged.statusCode).toBe(500);
  });

  it("two failures keep the first seen", () => {
    const merged = mergeChecks(
      check({ statusCode: 502, sourceLine: 2 }),
      check({ statusCode: 503, sourceLine: 9 }),
    );
    expect(merged.statusCode).toBe(502);
    expect(merged.flags).toContain("status_conflict_same_agent");
  });

  it("a non-null latency beats a null one", () => {
    const merged = mergeChecks(
      check({ latencyMs: null, sourceLine: 2 }),
      check({ latencyMs: 300, sourceLine: 9 }),
    );
    expect(merged.latencyMs).toBe(300);
  });

  it("keeps the earliest source line", () => {
    const merged = mergeChecks(
      check({ sourceLine: 90 }),
      check({ sourceLine: 12 }),
    );
    expect(merged.sourceLine).toBe(12);
  });

  it("unions the flags of both rows", () => {
    const merged = mergeChecks(
      check({ flags: ["ts_epoch_converted"] }),
      check({ flags: ["latency_unit_seconds"] }),
    );
    expect(merged.flags).toContain("ts_epoch_converted");
    expect(merged.flags).toContain("latency_unit_seconds");
  });

  it("identical status codes do not raise a conflict flag", () => {
    const merged = mergeChecks(check(), check({ sourceLine: 9 }));
    expect(merged.flags).not.toContain("status_conflict_same_agent");
  });

  it("does not treat a different agent as a duplicate", () => {
    const a = check({ agent: "agent-1" });
    const b = check({ agent: "agent-2" });
    expect(mergeKey(a)).not.toBe(mergeKey(b));
    const { merged, mergedInChunk } = mergeWithinChunk([a, b]);
    expect(merged).toHaveLength(2);
    expect(mergedInChunk).toBe(0);
  });

  it("only sees the duplicate after timestamp normalisation", () => {
    // Same instant written as ISO and as epoch seconds.
    const iso = check({ rawTimestamp: "2025-04-06T00:00:00Z" });
    const epoch = check({
      rawTimestamp: "1743897600",
      tsFormat: "epoch_s",
      sourceLine: 40,
      flags: ["ts_epoch_converted"],
    });
    expect(mergeKey(iso)).toBe(mergeKey(epoch));
    const { merged, mergedInChunk } = mergeWithinChunk([iso, epoch]);
    expect(merged).toHaveLength(1);
    expect(mergedInChunk).toBe(1);
    expect(merged[0].flags).toContain("merged_duplicate");
  });
});

describe("SPEC §12.5 CSV splitting", () => {
  it("keeps a quoted newline inside one row", () => {
    const text = 'a,b\n"line one\nline two",second\n';
    const lines = splitLines(text);
    expect(lines).toHaveLength(2);
    expect(parseLine(lines[1])[0]).toBe("line one\nline two");
  });

  it("handles escaped quotes", () => {
    expect(parseLine('"say ""hi""",x')).toEqual(['say "hi"', "x"]);
  });

  it("handles CRLF endings", () => {
    expect(splitLines("a,b\r\nc,d\r\n")).toEqual(["a,b", "c,d"]);
  });
});

describe("chunk invariant", () => {
  const HEADER =
    "service_id,service_name,timestamp,status_code,latency,latency_unit,agent,region";

  it("rowsIn = stored + mergedInChunk + rejected", () => {
    const body = [
      "svc-auth,auth-api,2025-04-06T00:00:00Z,200,142,ms,agent-1,ap-south-1",
      // duplicate of the row above, written as epoch
      "svc-auth,auth-api,1743897600,200,142,ms,agent-1,ap-south-1",
      "svc-auth,auth-api,2025-04-06T00:15:00Z,999,142,ms,agent-1,ap-south-1",
      "svc-auth,auth-api,2025-04-06T00:30:00Z,200,142,ms,agent-1,ap-south-1",
    ].join("\n");

    const result = processChunk(`${HEADER}\n${body}`, 2, () =>
      Date.UTC(2025, 3, 20),
    );
    const { rowsIn, stored, mergedInChunk, rejected } = result.counts;
    expect(rowsIn).toBe(4);
    expect(rejected).toBe(1);
    expect(mergedInChunk).toBe(1);
    expect(stored).toBe(2);
    expect(rowsIn).toBe(stored + mergedInChunk + rejected);
  });

  it("reports the real file line number for a rejection", () => {
    const body = "svc-auth,auth-api,2025-04-06T00:00:00Z,999,1,ms,agent-1,in";
    const result = processChunk(`${HEADER}\n${body}`, 4002, () =>
      Date.UTC(2025, 3, 20),
    );
    expect(result.rejections[0].lineNumber).toBe(4002);
  });
});
