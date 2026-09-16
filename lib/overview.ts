import "server-only";
// Builds the SPEC §11.2 overview payload from slot rows, using packages in
// core/ for every rule so the Worker and the dashboard agree by construction.
import {
  buildPeriods,
  computeMetrics,
  detectIncidents,
  incidentsInPeriod,
  median,
  SLOT_MS,
  type Incident as CoreIncident,
  type SlotInput,
} from "@/core/src/index";
import {
  getDataset,
  getLatencies,
  getQuality,
  getServices,
  getSlots,
  type SlotRow,
} from "./queries";
import type { Incident, Overview } from "./types";

function toSlotInputs(rows: SlotRow[]): Map<string, SlotInput[]> {
  const byService = new Map<string, SlotInput[]>();
  for (const row of rows) {
    const list = byService.get(row.service_id) ?? [];
    list.push({
      serviceId: row.service_id,
      slot: new Date(row.slot),
      isDown: row.is_down,
      medianLatencyMs:
        row.median_latency_ms === null ? null : Number(row.median_latency_ms),
    });
    byService.set(row.service_id, list);
  }
  return byService;
}

function serialiseIncident(
  incident: CoreIncident,
  serviceName: string,
): Incident {
  return {
    serviceId: incident.serviceId,
    serviceName,
    start: incident.start.toISOString(),
    end: incident.end.toISOString(),
    durationMinutes: incident.durationMinutes,
    downSlots: incident.downSlots,
    healthySlotsInside: incident.healthySlotsInside,
    latencyRatio: incident.latencyRatio,
    confirmed: incident.confirmed,
  };
}

export async function buildOverview(
  datasetId: string,
  periodKey: string,
): Promise<Overview | null> {
  const dataset = await getDataset(datasetId);
  if (!dataset) return null;

  const rangeStart = new Date(dataset.range_start);
  const rangeEnd = new Date(dataset.range_end);

  const [slotRows, services, quality] = await Promise.all([
    getSlots(datasetId),
    getServices(datasetId),
    getQuality(datasetId),
  ]);

  const periods = buildPeriods(rangeStart, rangeEnd);
  const period = periods.find((p) => p.key === periodKey) ?? periods[0];
  const nameById = new Map(services.map((s) => [s.id, s.name]));

  const slotsByService = toSlotInputs(slotRows);

  // SPEC §11.2: incidents are detected over the whole dataset, then filtered
  // to the period. Detecting inside the period would split any incident that
  // crosses a month boundary.
  const allIncidents: Incident[] = [];
  const baselines = new Map<string, number | null>();

  for (const service of services) {
    const slots = slotsByService.get(service.id) ?? [];
    const baseline = median(
      slots
        .map((s) => s.medianLatencyMs)
        .filter((v): v is number => v !== null),
    );
    baselines.set(service.id, baseline);

    for (const incident of detectIncidents(service.id, slots, baseline)) {
      allIncidents.push(serialiseIncident(incident, service.name));
    }
  }

  const periodIncidents = incidentsInPeriod(
    allIncidents.map((i) => ({
      ...i,
      start: new Date(i.start),
      end: new Date(i.end),
    })),
    period.from,
    period.to,
  ).map((i) => serialiseIncident(i, nameById.get(i.serviceId) ?? i.serviceId));

  // Latency percentiles come from Postgres, which sees every stored check,
  // not just the per-slot medians.
  const latencyRows = await getLatencies(datasetId, period.from, period.to);
  const latencyById = new Map(latencyRows.map((r) => [r.service_id, r]));

  const slotCount = Math.round(
    (period.to.getTime() - period.from.getTime()) / SLOT_MS,
  );

  const ledger = services.map((service) => {
    const all = slotsByService.get(service.id) ?? [];
    const inPeriod = all.filter(
      (s) =>
        s.slot.getTime() >= period.from.getTime() &&
        s.slot.getTime() < period.to.getTime(),
    );
    const latency = latencyById.get(service.id);

    const metrics = computeMetrics(
      {
        serviceId: service.id,
        serviceName: service.name,
        slots: inPeriod,
        latencies: [],
        incidentCount: periodIncidents.filter(
          (i) => i.confirmed && i.serviceId === service.id,
        ).length,
      },
      period,
    );

    return {
      ...metrics,
      p50LatencyMs: latency?.p50 === null || latency?.p50 === undefined
        ? null
        : Math.round(Number(latency.p50)),
      p95LatencyMs: latency?.p95 === null || latency?.p95 === undefined
        ? null
        : Math.round(Number(latency.p95)),
    };
  });

  // Ribbon lanes: one character per slot, plus the latency ratio that drives
  // spike height.
  const ribbonServices = services.map((service) => {
    const baseline = baselines.get(service.id) ?? null;
    const byTime = new Map<number, SlotInput>();
    for (const slot of slotsByService.get(service.id) ?? []) {
      byTime.set(slot.slot.getTime(), slot);
    }

    const states: string[] = new Array(slotCount);
    const latencyRatio: (number | null)[] = new Array(slotCount).fill(null);

    for (let i = 0; i < slotCount; i++) {
      const at = period.from.getTime() + i * SLOT_MS;
      const slot = byTime.get(at);
      if (!slot) {
        states[i] = ".";
        continue;
      }
      states[i] = slot.isDown ? "d" : "u";
      if (slot.medianLatencyMs !== null && baseline !== null && baseline > 0) {
        latencyRatio[i] = Math.round((slot.medianLatencyMs / baseline) * 10) / 10;
      }
    }

    return {
      serviceId: service.id,
      serviceName: service.name,
      states: states.join(""),
      latencyRatio,
    };
  });

  const totalKnown = ledger.reduce((sum, l) => sum + l.knownSlots, 0);
  const totalExpected = ledger.reduce((sum, l) => sum + l.expectedSlots, 0);
  const summary = (dataset.summary ?? {}) as {
    stored?: number;
    merged?: number;
    rejected?: number;
  };

  const belowTarget = ledger.filter((l) => !l.meetsSla).length;
  const worst = [...ledger].sort(
    (a, b) => a.availabilityPct - b.availabilityPct,
  )[0];

  return {
    dataset: {
      id: dataset.id,
      filename: dataset.filename,
      rangeStart: rangeStart.toISOString(),
      rangeEnd: rangeEnd.toISOString(),
    },
    periods: periods.map((p) => ({
      key: p.key,
      label: p.label,
      from: p.from.toISOString(),
      to: p.to.toISOString(),
      measuredDays: p.measuredDays,
      monthDays: p.monthDays,
    })),
    period: {
      key: period.key,
      label: period.label,
      from: period.from.toISOString(),
      to: period.to.toISOString(),
      measuredDays: period.measuredDays,
      monthDays: period.monthDays,
    },
    ledger,
    headline: {
      servicesBelowTarget: belowTarget,
      servicesTotal: ledger.length,
      confirmedIncidents: periodIncidents.filter((i) => i.confirmed).length,
      worstService: worst?.serviceId ?? "",
    },
    ribbon: {
      start: period.from.toISOString(),
      slotMinutes: 15,
      services: ribbonServices,
    },
    incidents: periodIncidents,
    quality: {
      rows: dataset.total_rows,
      stored: summary.stored ?? 0,
      merged: summary.merged ?? 0,
      rejected: summary.rejected ?? 0,
      rejectedByReason: quality.rejectedByReason,
      issues: quality.issues,
      coveragePct: totalExpected === 0 ? 0 : (totalKnown / totalExpected) * 100,
    },
  };
}

/** SPEC §8.1: slow means over 2× the service's median latency. */
export async function slowThresholds(
  datasetId: string,
): Promise<Record<string, number>> {
  const rows = await getSlots(datasetId);
  const byService = toSlotInputs(rows);
  const thresholds: Record<string, number> = {};
  for (const [serviceId, slots] of byService) {
    const baseline = median(
      slots.map((s) => s.medianLatencyMs).filter((v): v is number => v !== null),
    );
    if (baseline !== null) thresholds[serviceId] = baseline * 2;
  }
  return thresholds;
}
