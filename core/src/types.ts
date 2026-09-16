// SPEC §7.3 and §9. This module is pure TypeScript with zero runtime
// dependencies and no I/O, so the Worker and the web app share one
// implementation of every rule.

export const REQUIRED_COLUMNS = [
  "service_id",
  "service_name",
  "timestamp",
  "status_code",
  "latency",
  "latency_unit",
  "agent",
  "region",
] as const;

export type RequiredColumn = (typeof REQUIRED_COLUMNS)[number];

export type TsFormat = "iso_utc" | "iso_offset" | "epoch_s" | "epoch_ms";

/** SPEC §7.1: a row that fails a hard rule is rejected with one of these. */
export type RejectionReason =
  | "malformed_row"
  | "missing_required_field"
  | "invalid_service_id"
  | "invalid_timestamp"
  | "timestamp_without_timezone"
  | "timestamp_out_of_bounds"
  | "off_grid_timestamp"
  | "invalid_status_code";

/** SPEC §7.2 and §7.4: flags recorded on a kept row. */
export type CheckFlag =
  | "ts_epoch_converted"
  | "ts_offset_converted"
  | "latency_unit_seconds"
  | "latency_missing"
  | "latency_unparseable"
  | "latency_negative_dropped"
  | "latency_unit_unknown"
  | "region_missing"
  | "service_name_conflict"
  | "merged_duplicate"
  | "status_conflict_same_agent";

export type CleanCheck = {
  serviceId: string;
  serviceName: string;
  /** UTC, always on a 15-minute grid. */
  checkedAt: Date;
  agent: string;
  region: string | null;
  statusCode: number;
  latencyMs: number | null;
  tsFormat: TsFormat;
  /** Exactly as received, for the logs view. */
  rawTimestamp: string;
  /** File line number (header is line 1). */
  sourceLine: number;
  flags: CheckFlag[];
};

export type Rejection = {
  lineNumber: number;
  reason: RejectionReason;
  rawLine: string;
};

export type CleanResult =
  | { kind: "check"; check: CleanCheck }
  | { kind: "reject"; reason: RejectionReason };

export type IssueCounts = Partial<Record<CheckFlag, number>>;

export type ChunkCounts = {
  rowsIn: number;
  stored: number;
  mergedInChunk: number;
  rejected: number;
};

export type ProcessedChunk = {
  checks: CleanCheck[];
  rejections: Rejection[];
  counts: ChunkCounts;
  issues: IssueCounts;
};

// ---------------------------------------------------------------------------
// SLA model — SPEC §8
// ---------------------------------------------------------------------------

/** SPEC §8.2: one slot is one service × one 15-minute UTC window. */
export type SlotState = "up" | "down" | "unknown";

export type SlotInput = {
  serviceId: string;
  /** Start of the 15-minute slot, UTC. */
  slot: Date;
  isDown: boolean;
  medianLatencyMs: number | null;
};

export type Period = {
  key: string;
  label: string;
  from: Date;
  to: Date;
  measuredDays?: number;
  monthDays?: number;
};

export type ServiceMetrics = {
  serviceId: string;
  serviceName: string;
  expectedSlots: number;
  knownSlots: number;
  downSlots: number;
  coveragePct: number;
  availabilityPct: number;
  downtimeMinutes: number;
  errorBudgetMinutes: number;
  budgetUsedPct: number;
  meetsSla: boolean;
  creditEligible: boolean;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  incidentCount: number;
};

// ---------------------------------------------------------------------------
// Incidents — SPEC §9
// ---------------------------------------------------------------------------

export type Incident = {
  serviceId: string;
  /** First down slot. */
  start: Date;
  /** Last down slot + 15 minutes. */
  end: Date;
  durationMinutes: number;
  downSlots: number;
  /** Flapping indicator: healthy slots inside the cluster. */
  healthySlotsInside: number;
  /** Window median ÷ service baseline, 2 decimals. */
  latencyRatio: number;
  confirmed: boolean;
};

export const SLOT_MINUTES = 15;
export const SLOT_MS = SLOT_MINUTES * 60_000;
/** SPEC §8.4: the SLA target every verdict is measured against. */
export const SLA_TARGET_PCT = 99.9;
