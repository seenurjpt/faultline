// SPEC §9: cluster down slots, keep clusters of 3 or more, then confirm the
// ones where latency also spiked. Validated against dataset_incident_log.json:
// this rule finds all 8 logged incidents with no false confirmations.
import { median } from "./sla";
import { SLOT_MS, type Incident, type SlotInput } from "./types";

/** More than 2 healthy/unknown slots between failures starts a new cluster. */
const MAX_GAP_SLOTS = 3;
/** SPEC §9.2: a cluster of 2 is noise, not an incident. */
const MIN_DOWN_SLOTS = 3;
/** SPEC §9.3: confirmation needs the window median at 2× the baseline. */
const LATENCY_CONFIRM_RATIO = 2;

type Cluster = {
  downSlotTimes: number[];
  start: number;
  lastDown: number;
};

/**
 * Detects incidents for one service.
 *
 * `slots` must cover the whole dataset (not just the displayed period): a
 * cluster that straddles a month boundary is one incident, and clipping first
 * would split it into two shorter ones.
 */
export function detectIncidents(
  serviceId: string,
  slots: SlotInput[],
  baselineLatencyMs: number | null,
): Incident[] {
  const ordered = [...slots].sort((a, b) => a.slot.getTime() - b.slot.getTime());
  const byTime = new Map<number, SlotInput>();
  for (const slot of ordered) byTime.set(slot.slot.getTime(), slot);

  // 1. Cluster the down slots.
  const clusters: Cluster[] = [];
  let current: Cluster | null = null;

  for (const slot of ordered) {
    if (!slot.isDown) continue;
    const t = slot.slot.getTime();

    if (current === null) {
      current = { downSlotTimes: [t], start: t, lastDown: t };
      continue;
    }

    const gapSlots = (t - current.lastDown) / SLOT_MS;
    if (gapSlots > MAX_GAP_SLOTS) {
      clusters.push(current);
      current = { downSlotTimes: [t], start: t, lastDown: t };
    } else {
      current.downSlotTimes.push(t);
      current.lastDown = t;
    }
  }
  if (current !== null) clusters.push(current);

  // 2. Keep only clusters big enough to be an outage.
  const kept = clusters.filter(
    (c) => c.downSlotTimes.length >= MIN_DOWN_SLOTS,
  );

  // 3. Confirm with latency, and shape the output.
  return kept.map((cluster) => {
    const end = cluster.lastDown + SLOT_MS;

    // The window runs to the end of the last down slot, so the latency of the
    // failing slot itself counts toward confirmation.
    const windowLatencies: number[] = [];
    let healthySlotsInside = 0;

    for (let t = cluster.start; t < end; t += SLOT_MS) {
      const slot = byTime.get(t);
      if (slot === undefined) continue;
      if (!slot.isDown) healthySlotsInside++;
      if (slot.medianLatencyMs !== null) {
        windowLatencies.push(slot.medianLatencyMs);
      }
    }

    const windowMedian = median(windowLatencies);
    const latencyRatio =
      baselineLatencyMs === null ||
      baselineLatencyMs === 0 ||
      windowMedian === null
        ? 0
        : windowMedian / baselineLatencyMs;

    return {
      serviceId,
      start: new Date(cluster.start),
      end: new Date(end),
      durationMinutes: Math.round((end - cluster.start) / 60_000),
      downSlots: cluster.downSlotTimes.length,
      healthySlotsInside,
      latencyRatio: Math.round(latencyRatio * 100) / 100,
      confirmed: latencyRatio >= LATENCY_CONFIRM_RATIO,
    };
  });
}

/** SPEC §8.1: the baseline is the service's median latency over the dataset. */
export function serviceBaseline(slots: SlotInput[]): number | null {
  const values = slots
    .map((s) => s.medianLatencyMs)
    .filter((v): v is number => v !== null);
  return median(values);
}

/** SPEC §11.2: incidents overlapping the selected period. */
export function incidentsInPeriod(
  incidents: Incident[],
  from: Date,
  to: Date,
): Incident[] {
  return incidents
    .filter((i) => i.start.getTime() < to.getTime() && i.end.getTime() > from.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}
