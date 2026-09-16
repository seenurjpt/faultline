// Response shapes from SPEC §11. The UI renders these and nothing else,
// so the read API can replace the mock source without touching components.

export type DatasetSummary = {
  id: string;
  filename: string;
  rangeStart: string;
  rangeEnd: string;
  completedAt: string;
  totals: { rows: number; stored: number; merged: number; rejected: number };
};

export type Period = {
  key: string; // "all" | "YYYY-MM"
  label: string;
  from: string;
  to: string;
  measuredDays?: number;
  monthDays?: number;
};

export type LedgerRow = {
  serviceId: string;
  serviceName: string;
  availabilityPct: number;
  knownSlots: number;
  expectedSlots: number;
  coveragePct: number;
  downSlots: number;
  downtimeMinutes: number;
  errorBudgetMinutes: number;
  budgetUsedPct: number;
  meetsSla: boolean;
  creditEligible: boolean;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  incidentCount: number;
};

export type RibbonService = {
  serviceId: string;
  serviceName: string;
  /** SPEC §11.2: one character per slot — `u` up, `d` down, `.` unknown. */
  states: string;
  /** Slot median latency ÷ service baseline, 1 decimal, null when unknown. */
  latencyRatio: (number | null)[];
};

export type Ribbon = {
  start: string;
  slotMinutes: number;
  services: RibbonService[];
};

export type Incident = {
  serviceId: string;
  serviceName: string;
  start: string;
  end: string;
  durationMinutes: number;
  downSlots: number;
  healthySlotsInside: number;
  latencyRatio: number;
  confirmed: boolean;
};

export type Quality = {
  rows: number;
  stored: number;
  merged: number;
  rejected: number;
  rejectedByReason: Record<string, number>;
  issues: Record<string, number>;
  coveragePct: number;
};

export type Overview = {
  dataset: {
    id: string;
    filename: string;
    rangeStart: string;
    rangeEnd: string;
  };
  periods: Period[];
  period: Period;
  ledger: LedgerRow[];
  headline: {
    servicesBelowTarget: number;
    servicesTotal: number;
    confirmedIncidents: number;
    worstService: string;
  };
  ribbon: Ribbon;
  incidents: Incident[];
  quality: Quality;
};

export type CheckFlag =
  | "ts_epoch_converted"
  | "ts_offset_converted"
  | "latency_unit_seconds"
  | "latency_missing"
  | "latency_negative_dropped"
  | "latency_unparseable"
  | "merged_duplicate"
  | "status_conflict_same_agent";

export type LogRow = {
  checkedAt: string;
  serviceId: string;
  serviceName: string;
  agent: string;
  region: string | null;
  statusCode: number;
  outcome: "up" | "down";
  latencyMs: number | null;
  slow: boolean;
  flags: string[];
  rawTimestamp: string;
  sourceLine: number;
};

export type RejectedRow = {
  lineNumber: number;
  reason: string;
  rawLine: string;
};

export type LogsResponse = {
  rows: LogRow[];
  nextCursor: string | null;
  total: number;
};

export type RejectedResponse = {
  rows: RejectedRow[];
  nextCursor: string | null;
  total: number;
};

export type Outcome = "all" | "failures" | "slow" | "flagged" | "rejected";
export type Tz = "utc" | "ist";
