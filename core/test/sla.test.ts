import { describe, expect, it } from "vitest";
import { buildPeriods, computeMetrics, percentile } from "../src/sla";
import { detectIncidents, incidentsInPeriod } from "../src/incidents";
import { SLOT_MS, type Period, type SlotInput } from "../src/types";

const PERIOD_ALL: Period = {
  key: "all",
  label: "Whole file",
  from: new Date("2025-04-06T00:00:00Z"),
  to: new Date("2025-04-07T00:00:00Z"),
};

const PERIOD_MONTH: Period = {
  key: "2025-04",
  label: "April 2025",
  from: new Date("2025-04-06T00:00:00Z"),
  to: new Date("2025-04-07T00:00:00Z"),
};

/** Builds a day of slots with `down` failures placed at the front. */
function slots(count: number, down: number, latency = 100): SlotInput[] {
  const out: SlotInput[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      serviceId: "svc-auth",
      slot: new Date(Date.UTC(2025, 3, 6) + i * SLOT_MS),
      isDown: i < down,
      medianLatencyMs: latency,
    });
  }
  return out;
}

describe("SPEC §8.4 metrics", () => {
  it("excludes unknown slots from availability and reports them as coverage", () => {
    // 96 slots in a day; only 90 reported, 0 down.
    const metrics = computeMetrics(
      {
        serviceId: "svc-auth",
        serviceName: "auth-api",
        slots: slots(90, 0),
        latencies: [],
        incidentCount: 0,
      },
      PERIOD_MONTH,
    );
    expect(metrics.expectedSlots).toBe(96);
    expect(metrics.knownSlots).toBe(90);
    // Availability is over known slots, so missing data cannot read as an outage.
    expect(metrics.availabilityPct).toBe(100);
    expect(metrics.coveragePct).toBeCloseTo((90 / 96) * 100, 6);
  });

  it("uses the error budget formula from §8.4", () => {
    const metrics = computeMetrics(
      {
        serviceId: "svc-auth",
        serviceName: "auth-api",
        slots: slots(96, 3),
        latencies: [],
        incidentCount: 0,
      },
      PERIOD_MONTH,
    );
    expect(metrics.downtimeMinutes).toBe(45);
    expect(metrics.errorBudgetMinutes).toBeCloseTo(0.001 * 96 * 15, 9);
    expect(metrics.budgetUsedPct).toBeCloseTo((45 / (0.001 * 96 * 15)) * 100, 6);
  });

  it("three failed checks breach the SLA in a month", () => {
    // SPEC §8.4: at 15-minute granularity 99.9% allows only 2.88 down slots.
    const month = computeMetrics(
      {
        serviceId: "svc-auth",
        serviceName: "auth-api",
        slots: slots(2880, 3),
        latencies: [],
        incidentCount: 0,
      },
      { ...PERIOD_MONTH, to: new Date("2025-05-06T00:00:00Z") },
    );
    expect(month.meetsSla).toBe(false);
    expect(month.creditEligible).toBe(true);

    const two = computeMetrics(
      {
        serviceId: "svc-auth",
        serviceName: "auth-api",
        slots: slots(2880, 2),
        latencies: [],
        incidentCount: 0,
      },
      { ...PERIOD_MONTH, to: new Date("2025-05-06T00:00:00Z") },
    );
    expect(two.meetsSla).toBe(true);
  });

  it("never marks the whole-file period credit eligible", () => {
    const metrics = computeMetrics(
      {
        serviceId: "svc-auth",
        serviceName: "auth-api",
        slots: slots(96, 50),
        latencies: [],
        incidentCount: 0,
      },
      PERIOD_ALL,
    );
    expect(metrics.meetsSla).toBe(false);
    // Billing is monthly, so the whole file cannot produce a credit decision.
    expect(metrics.creditEligible).toBe(false);
  });

  it("computes percentiles like percentile_cont", () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([10], 0.95)).toBe(10);
    expect(percentile([], 0.5)).toBeNull();
  });
});

describe("SPEC §8.3 periods", () => {
  it("clips months to the dataset range and reports measured days", () => {
    const periods = buildPeriods(
      new Date("2025-04-06T00:00:00Z"),
      new Date("2025-05-06T00:00:00Z"),
    );
    expect(periods[0].key).toBe("all");
    expect(periods.map((p) => p.key)).toEqual(["all", "2025-04", "2025-05"]);

    const april = periods[1];
    expect(april.measuredDays).toBe(25);
    expect(april.monthDays).toBe(30);
    expect(april.from.toISOString()).toBe("2025-04-06T00:00:00.000Z");
    expect(april.to.toISOString()).toBe("2025-05-01T00:00:00.000Z");

    const may = periods[2];
    expect(may.measuredDays).toBe(5);
    expect(may.monthDays).toBe(31);
  });
});

describe("SPEC §9 incident detection", () => {
  const baseline = 100;

  function run(pattern: string, latencyDuring = 400): SlotInput[] {
    // "d" down, "u" up, "." unknown (omitted from the slot list entirely).
    return [...pattern].flatMap((ch, i) => {
      if (ch === ".") return [];
      return [
        {
          serviceId: "svc-x",
          slot: new Date(Date.UTC(2025, 3, 6) + i * SLOT_MS),
          isDown: ch === "d",
          medianLatencyMs: ch === "d" ? latencyDuring : baseline,
        },
      ];
    });
  }

  it("does not report a cluster of two", () => {
    const incidents = detectIncidents("svc-x", run("uuddsuu".replace("s", "u")), baseline);
    expect(incidents).toHaveLength(0);
  });

  it("reports a cluster of three", () => {
    const incidents = detectIncidents("svc-x", run("uuddduu"), baseline);
    expect(incidents).toHaveLength(1);
    expect(incidents[0].downSlots).toBe(3);
  });

  it("a gap of three healthy slots splits a cluster", () => {
    // Three healthy slots between failures is a gap of 4, over the limit.
    const incidents = detectIncidents("svc-x", run("ddduuudddd"), baseline);
    expect(incidents).toHaveLength(2);
  });

  it("a gap of two healthy slots keeps one cluster and counts the flapping", () => {
    const incidents = detectIncidents("svc-x", run("dgduudddd".replace("g", "d")), baseline);
    expect(incidents).toHaveLength(1);
    expect(incidents[0].healthySlotsInside).toBe(2);
  });

  it("confirms only when latency also spiked", () => {
    const confirmed = detectIncidents("svc-x", run("udddddu", 400), baseline);
    expect(confirmed[0].confirmed).toBe(true);
    expect(confirmed[0].latencyRatio).toBeGreaterThanOrEqual(2);

    // Same failures, normal latency: a real cluster, but not a confirmed incident.
    const unconfirmed = detectIncidents("svc-x", run("udddddu", 105), baseline);
    expect(unconfirmed).toHaveLength(1);
    expect(unconfirmed[0].confirmed).toBe(false);
  });

  it("end is the last down slot plus one slot", () => {
    const incidents = detectIncidents("svc-x", run("dddu"), baseline);
    expect(incidents[0].start.toISOString()).toBe("2025-04-06T00:00:00.000Z");
    expect(incidents[0].end.toISOString()).toBe("2025-04-06T00:45:00.000Z");
    expect(incidents[0].durationMinutes).toBe(45);
  });

  it("filters to incidents overlapping the period", () => {
    const incidents = detectIncidents("svc-x", run("dddu"), baseline);
    const inside = incidentsInPeriod(
      incidents,
      new Date("2025-04-06T00:00:00Z"),
      new Date("2025-04-07T00:00:00Z"),
    );
    expect(inside).toHaveLength(1);
    const outside = incidentsInPeriod(
      incidents,
      new Date("2025-05-01T00:00:00Z"),
      new Date("2025-06-01T00:00:00Z"),
    );
    expect(outside).toHaveLength(0);
  });
});
