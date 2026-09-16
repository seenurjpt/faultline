// SPEC §8: slot health, periods and the per-service metrics table.
import {
  SLA_TARGET_PCT,
  SLOT_MINUTES,
  SLOT_MS,
  type Period,
  type ServiceMetrics,
  type SlotInput,
  type SlotState,
} from "./types";

/** SPEC §8.2: worst agent wins — one down report makes the slot down. */
export function slotState(
  hasReport: boolean,
  anyDown: boolean,
): SlotState {
  if (!hasReport) return "unknown";
  return anyDown ? "down" : "up";
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  // Linear interpolation, matching Postgres percentile_cont.
  const rank = p * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (rank - lower) * (sorted[upper] - sorted[lower]);
}

export function median(values: number[]): number | null {
  return percentile(values, 0.5);
}

function utcMonthStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function addMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * SPEC §8.3: the whole file, then one entry per UTC calendar month the data
 * touches, each clipped to the dataset range and carrying how much of the
 * month was actually measured.
 */
export function buildPeriods(rangeStart: Date, rangeEnd: Date): Period[] {
  const all: Period = {
    key: "all",
    label: "Whole file",
    from: rangeStart,
    to: rangeEnd,
  };

  const months: Period[] = [];
  let cursor = utcMonthStart(rangeStart);

  while (cursor < rangeEnd) {
    const monthStart = cursor;
    const monthEnd = addMonth(cursor);
    const from = monthStart < rangeStart ? rangeStart : monthStart;
    const to = monthEnd > rangeEnd ? rangeEnd : monthEnd;

    months.push({
      key: `${monthStart.getUTCFullYear()}-${String(monthStart.getUTCMonth() + 1).padStart(2, "0")}`,
      label: `${MONTH_NAMES[monthStart.getUTCMonth()]} ${monthStart.getUTCFullYear()}`,
      from,
      to,
      measuredDays: Math.round((to.getTime() - from.getTime()) / 86_400_000),
      monthDays: Math.round(
        (monthEnd.getTime() - monthStart.getTime()) / 86_400_000,
      ),
    });

    cursor = monthEnd;
  }

  return [all, ...months];
}

export type MetricsInput = {
  serviceId: string;
  serviceName: string;
  /** Slots for this service inside the period, one row per reported slot. */
  slots: SlotInput[];
  /** Non-null latencies of stored checks in the period. */
  latencies: number[];
  incidentCount: number;
};

/**
 * SPEC §8.4. Unknown slots are excluded from availability and surfaced through
 * coverage instead: treating missing data as "up" would hide outages, and
 * treating it as "down" would pay credits for monitoring gaps.
 */
export function computeMetrics(
  input: MetricsInput,
  period: Period,
): ServiceMetrics {
  const expectedSlots = Math.round(
    (period.to.getTime() - period.from.getTime()) / SLOT_MS,
  );

  let knownSlots = 0;
  let downSlots = 0;
  for (const slot of input.slots) {
    knownSlots++;
    if (slot.isDown) downSlots++;
  }

  const availabilityPct =
    knownSlots === 0 ? 0 : ((knownSlots - downSlots) / knownSlots) * 100;
  const downtimeMinutes = downSlots * SLOT_MINUTES;
  const errorBudgetMinutes = 0.001 * knownSlots * SLOT_MINUTES;
  const budgetUsedPct =
    errorBudgetMinutes === 0
      ? 0
      : (downtimeMinutes / errorBudgetMinutes) * 100;
  const meetsSla = availabilityPct >= SLA_TARGET_PCT;

  return {
    serviceId: input.serviceId,
    serviceName: input.serviceName,
    expectedSlots,
    knownSlots,
    downSlots,
    coveragePct: expectedSlots === 0 ? 0 : (knownSlots / expectedSlots) * 100,
    availabilityPct,
    downtimeMinutes,
    errorBudgetMinutes,
    budgetUsedPct,
    meetsSla,
    // SPEC §8.3: billing verdicts are a monthly decision only.
    creditEligible: period.key !== "all" && !meetsSla,
    p50LatencyMs: round1(percentile(input.latencies, 0.5)),
    p95LatencyMs: round1(percentile(input.latencies, 0.95)),
    incidentCount: input.incidentCount,
  };
}

function round1(value: number | null): number | null {
  return value === null ? null : Math.round(value);
}

/** SPEC §11.2: one character per slot — `u` up, `d` down, `.` unknown. */
export function buildStateString(
  slots: Map<number, SlotInput>,
  periodStart: Date,
  slotCount: number,
): { states: string; latencyRatio: (number | null)[] } {
  const chars: string[] = new Array(slotCount);
  const ratios: (number | null)[] = new Array(slotCount).fill(null);

  for (let i = 0; i < slotCount; i++) {
    const at = periodStart.getTime() + i * SLOT_MS;
    const slot = slots.get(at);
    if (slot === undefined) {
      chars[i] = ".";
      continue;
    }
    chars[i] = slot.isDown ? "d" : "u";
  }

  return { states: chars.join(""), latencyRatio: ratios };
}
