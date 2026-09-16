import { describe, expect, it } from "vitest";
import { clean, createContext, parseTimestamp } from "../src/clean";
import { headerIndex, parseLine } from "../src/csv";
import type { CleanCheck } from "../src/types";

const HEADER =
  "service_id,service_name,timestamp,status_code,latency,latency_unit,agent,region";
const INDEX = headerIndex(HEADER);
const HEADER_LEN = parseLine(HEADER).length;

// A fixed clock keeps the "more than a day in the future" rule deterministic.
const NOW = () => Date.UTC(2025, 3, 20, 12, 0, 0);

function run(line: string, lineNumber = 2) {
  return clean(parseLine(line), INDEX, lineNumber, createContext(NOW), HEADER_LEN);
}

function expectCheck(line: string): CleanCheck {
  const result = run(line);
  if (result.kind !== "check") {
    throw new Error(`expected a check, got rejection ${result.reason}`);
  }
  return result.check;
}

function expectReject(line: string): string {
  const result = run(line);
  if (result.kind !== "reject") throw new Error("expected a rejection");
  return result.reason;
}

describe("SPEC §7.1 hard rules", () => {
  it("1. rejects a row with fewer fields than the header", () => {
    expect(expectReject("svc-auth,auth-api,2025-04-06T00:00:00Z,200")).toBe(
      "malformed_row",
    );
  });

  it("2. rejects an empty required field", () => {
    expect(
      expectReject("svc-auth,auth-api,2025-04-06T00:00:00Z,200,10,ms,,ap-south-1"),
    ).toBe("missing_required_field");
    expect(
      expectReject(",auth-api,2025-04-06T00:00:00Z,200,10,ms,agent-1,ap-south-1"),
    ).toBe("missing_required_field");
  });

  it("3. rejects a service id that is not svc-<slug>", () => {
    expect(
      expectReject("auth,auth-api,2025-04-06T00:00:00Z,200,10,ms,agent-1,ap-south-1"),
    ).toBe("invalid_service_id");
    expect(
      expectReject("svc_auth,auth-api,2025-04-06T00:00:00Z,200,10,ms,agent-1,in"),
    ).toBe("invalid_service_id");
  });

  it("4. rejects an unreadable timestamp", () => {
    expect(
      expectReject("svc-auth,auth-api,not-a-date,200,10,ms,agent-1,ap-south-1"),
    ).toBe("invalid_timestamp");
  });

  it("5. rejects an ISO timestamp with no zone", () => {
    expect(
      expectReject("svc-auth,auth-api,2025-04-06T00:00:00,200,10,ms,agent-1,in"),
    ).toBe("timestamp_without_timezone");
  });

  it("6. rejects timestamps outside a plausible range", () => {
    expect(
      expectReject("svc-auth,auth-api,1999-12-31T23:45:00Z,200,10,ms,agent-1,in"),
    ).toBe("timestamp_out_of_bounds");
    expect(
      expectReject("svc-auth,auth-api,2030-01-01T00:00:00Z,200,10,ms,agent-1,in"),
    ).toBe("timestamp_out_of_bounds");
  });

  it("7. rejects an off-grid timestamp rather than snapping it", () => {
    expect(
      expectReject("svc-auth,auth-api,2025-04-06T00:07:00Z,200,10,ms,agent-1,in"),
    ).toBe("off_grid_timestamp");
    expect(
      expectReject("svc-auth,auth-api,2025-04-06T00:15:30Z,200,10,ms,agent-1,in"),
    ).toBe("off_grid_timestamp");
  });

  it("8. rejects a status code outside 100-599 — the `999` row in every fixture", () => {
    expect(
      expectReject("svc-auth,auth-api,2025-04-06T00:00:00Z,999,10,ms,agent-1,in"),
    ).toBe("invalid_status_code");
    expect(
      expectReject("svc-auth,auth-api,2025-04-06T00:00:00Z,abc,10,ms,agent-1,in"),
    ).toBe("invalid_status_code");
  });

  it("applies hard rules in order: the first failure names the reason", () => {
    // Bad service id *and* a bad timestamp: rule 3 runs before rule 4.
    expect(
      expectReject("nope,auth-api,not-a-date,200,10,ms,agent-1,ap-south-1"),
    ).toBe("invalid_service_id");
  });
});

describe("SPEC §7.2 soft rules", () => {
  it("converts epoch seconds and flags it", () => {
    const check = expectCheck(
      "svc-auth,auth-api,1743897600,200,10,ms,agent-1,ap-south-1",
    );
    expect(check.flags).toContain("ts_epoch_converted");
    expect(check.tsFormat).toBe("epoch_s");
    expect(check.checkedAt.toISOString()).toBe("2025-04-06T00:00:00.000Z");
  });

  it("converts epoch milliseconds and flags it", () => {
    const check = expectCheck(
      "svc-auth,auth-api,1743897600000,200,10,ms,agent-1,ap-south-1",
    );
    expect(check.flags).toContain("ts_epoch_converted");
    expect(check.tsFormat).toBe("epoch_ms");
  });

  it("SPEC §12.5: +05:30 becomes the right UTC instant", () => {
    const check = expectCheck(
      "svc-auth,auth-api,2025-04-12T14:15:00+05:30,200,10,ms,agent-1,ap-south-1",
    );
    expect(check.checkedAt.toISOString()).toBe("2025-04-12T08:45:00.000Z");
    expect(check.flags).toContain("ts_offset_converted");
    expect(check.tsFormat).toBe("iso_offset");
  });

  it("keeps the raw timestamp exactly as received", () => {
    const check = expectCheck(
      "svc-auth,auth-api,2025-04-12T14:15:00+05:30,200,10,ms,agent-1,ap-south-1",
    );
    expect(check.rawTimestamp).toBe("2025-04-12T14:15:00+05:30");
  });

  it("converts seconds to milliseconds", () => {
    const check = expectCheck(
      "svc-search,search-api,2025-04-06T00:00:00Z,200,2.193,s,agent-1,ap-south-1",
    );
    expect(check.latencyMs).toBe(2193);
    expect(check.flags).toContain("latency_unit_seconds");
  });

  it("keeps a row with blank latency, nulling the value", () => {
    const check = expectCheck(
      "svc-auth,auth-api,2025-04-06T00:00:00Z,200,,ms,agent-1,ap-south-1",
    );
    expect(check.latencyMs).toBeNull();
    expect(check.flags).toContain("latency_missing");
  });

  it("drops a negative latency but keeps the check", () => {
    const check = expectCheck(
      "svc-auth,auth-api,2025-04-06T00:00:00Z,200,-5,ms,agent-1,ap-south-1",
    );
    expect(check.latencyMs).toBeNull();
    expect(check.flags).toContain("latency_negative_dropped");
    expect(check.statusCode).toBe(200);
  });

  it("drops an unparseable latency", () => {
    const check = expectCheck(
      "svc-auth,auth-api,2025-04-06T00:00:00Z,200,fast,ms,agent-1,ap-south-1",
    );
    expect(check.latencyMs).toBeNull();
    expect(check.flags).toContain("latency_unparseable");
  });

  it("drops a latency with an unknown unit", () => {
    const check = expectCheck(
      "svc-auth,auth-api,2025-04-06T00:00:00Z,200,10,minutes,agent-1,ap-south-1",
    );
    expect(check.latencyMs).toBeNull();
    expect(check.flags).toContain("latency_unit_unknown");
  });

  it("stores a missing region as null and flags it", () => {
    const check = expectCheck(
      "svc-auth,auth-api,2025-04-06T00:00:00Z,200,10,ms,agent-1,",
    );
    expect(check.region).toBeNull();
    expect(check.flags).toContain("region_missing");
  });

  it("keeps the first service name and flags a later conflict", () => {
    const ctx = createContext(NOW);
    const first = clean(
      parseLine("svc-auth,auth-api,2025-04-06T00:00:00Z,200,10,ms,agent-1,in"),
      INDEX, 2, ctx, HEADER_LEN,
    );
    const second = clean(
      parseLine("svc-auth,auth-svc,2025-04-06T00:15:00Z,200,10,ms,agent-1,in"),
      INDEX, 3, ctx, HEADER_LEN,
    );
    expect(first.kind === "check" && first.check.serviceName).toBe("auth-api");
    expect(second.kind === "check" && second.check.serviceName).toBe("auth-api");
    expect(second.kind === "check" && second.check.flags).toContain(
      "service_name_conflict",
    );
  });

  it("accepts a 4xx as a stored check that counts as down", () => {
    const check = expectCheck(
      "svc-auth,auth-api,2025-04-06T00:00:00Z,404,10,ms,agent-1,ap-south-1",
    );
    expect(check.statusCode).toBe(404);
  });
});

describe("timestamp parsing", () => {
  it("never hands an unvalidated string to Date.parse", () => {
    // Date.parse would happily read this; the ISO regex must reject it first.
    expect(parseTimestamp("April 6, 2025").ok).toBe(false);
    expect(parseTimestamp("2025-04-06").ok).toBe(false);
  });

  it("accepts optional seconds and fractions", () => {
    expect(parseTimestamp("2025-04-06T00:00Z").ok).toBe(true);
    expect(parseTimestamp("2025-04-06T00:00:00.000Z").ok).toBe(true);
  });
});
