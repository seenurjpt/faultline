// SPEC §7.1 and §7.2: hard rules reject a row, soft rules keep it with a flag.
// The hard rules run in the exact order given in §7.1; the first failure wins,
// so the reason code always names the first thing wrong with the row.
import type {
  CheckFlag,
  CleanCheck,
  CleanResult,
  TsFormat,
} from "./types";

// SPEC §7.1: never pass an unvalidated string to Date.parse — it accepts
// far more than ISO-8601 and silently guesses a zone for what it can't read.
const ISO_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const EPOCH_S_RE = /^\d{10}$/;
const EPOCH_MS_RE = /^\d{13}$/;
const SERVICE_ID_RE = /^svc-[a-z0-9-]+$/;

const MIN_TIME = Date.UTC(2000, 0, 1);
const ONE_DAY_MS = 86_400_000;

export type CleanContext = {
  /** Remembers the first name seen per service id, for §7.2 conflicts. */
  serviceNames: Map<string, string>;
  /** Injectable clock so "more than a day in the future" is testable. */
  now?: () => number;
};

export function createContext(now?: () => number): CleanContext {
  return { serviceNames: new Map(), now };
}

type ParsedTimestamp =
  | { ok: true; date: Date; format: TsFormat }
  | { ok: false; reason: "invalid_timestamp" | "timestamp_without_timezone" };

/** SPEC §7.1 rules 4 and 5, plus the epoch forms from §7.2. */
export function parseTimestamp(raw: string): ParsedTimestamp {
  if (EPOCH_S_RE.test(raw)) {
    return { ok: true, date: new Date(Number(raw) * 1000), format: "epoch_s" };
  }
  if (EPOCH_MS_RE.test(raw)) {
    return { ok: true, date: new Date(Number(raw)), format: "epoch_ms" };
  }

  if (ISO_RE.test(raw)) {
    const ms = Date.parse(raw);
    if (Number.isNaN(ms)) return { ok: false, reason: "invalid_timestamp" };
    // A trailing Z is already UTC; any other offset had to be converted.
    const format: TsFormat = raw.endsWith("Z") ? "iso_utc" : "iso_offset";
    return { ok: true, date: new Date(ms), format };
  }

  // Looks like an ISO date-time but carries no zone: that is a distinct
  // failure from unparseable junk, because the value itself is plausible.
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(raw)) {
    return { ok: false, reason: "timestamp_without_timezone" };
  }

  return { ok: false, reason: "invalid_timestamp" };
}

/** SPEC §7.2: latency conversion, unit handling and the flags each sets. */
function parseLatency(
  rawLatency: string,
  rawUnit: string,
  flags: CheckFlag[],
): number | null {
  const unit = rawUnit.trim().toLowerCase();

  if (rawLatency === "") {
    flags.push("latency_missing");
    return null;
  }

  const value = Number(rawLatency);
  if (!Number.isFinite(value)) {
    flags.push("latency_unparseable");
    return null;
  }
  if (value < 0) {
    flags.push("latency_negative_dropped");
    return null;
  }

  if (unit === "s") {
    flags.push("latency_unit_seconds");
    return Math.round(value * 1000);
  }
  if (unit === "ms") {
    return Math.round(value);
  }

  // An unrecognised unit makes the number meaningless, so it is dropped from
  // latency statistics rather than assumed to be milliseconds.
  flags.push("latency_unit_unknown");
  return null;
}

/**
 * Cleans one parsed row. `fields` comes from the CSV parser, `index` maps
 * column names to positions, and `lineNumber` is the file line for the logs.
 */
export function clean(
  fields: string[],
  index: Record<string, number>,
  lineNumber: number,
  ctx: CleanContext,
  headerLength: number,
): CleanResult {
  // Rule 1: too few fields to be a row at all.
  if (fields.length < headerLength) {
    return { kind: "reject", reason: "malformed_row" };
  }

  const at = (column: string): string => {
    const i = index[column];
    return i === undefined ? "" : (fields[i] ?? "").trim();
  };

  const serviceIdRaw = at("service_id");
  const timestampRaw = at("timestamp");
  const statusRaw = at("status_code");
  const agent = at("agent");

  // Rule 2: the four values without which a check means nothing.
  if (
    serviceIdRaw === "" ||
    timestampRaw === "" ||
    statusRaw === "" ||
    agent === ""
  ) {
    return { kind: "reject", reason: "missing_required_field" };
  }

  // Rule 3: service id shape.
  const serviceId = serviceIdRaw.toLowerCase();
  if (!SERVICE_ID_RE.test(serviceId)) {
    return { kind: "reject", reason: "invalid_service_id" };
  }

  // Rules 4 and 5: timestamp parses, and carries a zone.
  const parsed = parseTimestamp(timestampRaw);
  if (!parsed.ok) return { kind: "reject", reason: parsed.reason };
  const checkedAt = parsed.date;

  if (Number.isNaN(checkedAt.getTime())) {
    return { kind: "reject", reason: "invalid_timestamp" };
  }

  // Rule 6: plausible range.
  const now = ctx.now ? ctx.now() : Date.now();
  if (checkedAt.getTime() < MIN_TIME || checkedAt.getTime() > now + ONE_DAY_MS) {
    return { kind: "reject", reason: "timestamp_out_of_bounds" };
  }

  // Rule 7: on the 15-minute grid. SPEC §7.1 rejects rather than snaps,
  // because snapping would invent a result for a slot never reported.
  const minutes = checkedAt.getUTCMinutes();
  if (
    (minutes !== 0 && minutes !== 15 && minutes !== 30 && minutes !== 45) ||
    checkedAt.getUTCSeconds() !== 0 ||
    checkedAt.getUTCMilliseconds() !== 0
  ) {
    return { kind: "reject", reason: "off_grid_timestamp" };
  }

  // Rule 8: a real HTTP status. This is what rejects the `999` row in every
  // fixture (SPEC §7.5).
  if (!/^-?\d+$/.test(statusRaw)) {
    return { kind: "reject", reason: "invalid_status_code" };
  }
  const statusCode = Number(statusRaw);
  if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
    return { kind: "reject", reason: "invalid_status_code" };
  }

  // ---- Soft rules: the row is kept, anything odd is recorded -------------
  const flags: CheckFlag[] = [];

  if (parsed.format === "epoch_s" || parsed.format === "epoch_ms") {
    flags.push("ts_epoch_converted");
  } else if (parsed.format === "iso_offset") {
    flags.push("ts_offset_converted");
  }

  const latencyMs = parseLatency(at("latency"), at("latency_unit"), flags);

  const regionRaw = at("region");
  const region = regionRaw === "" ? null : regionRaw;
  if (region === null) flags.push("region_missing");

  // Keep the first name seen for a service id; a later disagreement is
  // recorded but does not rename the service mid-file.
  const nameRaw = at("service_name");
  const known = ctx.serviceNames.get(serviceId);
  let serviceName: string;
  if (known === undefined) {
    serviceName = nameRaw === "" ? serviceId : nameRaw;
    ctx.serviceNames.set(serviceId, serviceName);
  } else {
    serviceName = known;
    if (nameRaw !== "" && nameRaw !== known) {
      flags.push("service_name_conflict");
    }
  }

  const check: CleanCheck = {
    serviceId,
    serviceName,
    checkedAt,
    agent,
    region,
    statusCode,
    latencyMs,
    tsFormat: parsed.format,
    rawTimestamp: timestampRaw,
    sourceLine: lineNumber,
    flags,
  };

  return { kind: "check", check };
}

/** SPEC §8.1: 200–399 is up; anything else stored counts against availability. */
export function isDown(statusCode: number): boolean {
  return statusCode < 200 || statusCode > 399;
}
