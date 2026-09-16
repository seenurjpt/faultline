import type { Tz } from "./types";

// DESIGN §7: numbers use en-IN grouping, dates use en-GB order (22 Apr 2025).
const IST_OFFSET_MINUTES = 330;

export function tzOffsetMinutes(tz: Tz): number {
  return tz === "ist" ? IST_OFFSET_MINUTES : 0;
}

/** Shifts an instant so that UTC getters read as the display zone. */
function shift(iso: string | Date, tz: Tz): Date {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Date(d.getTime() + tzOffsetMinutes(tz) * 60_000);
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-IN").format(n);
}

/** DESIGN §6.4: availability carries 3 decimals; other percentages are whole. */
export function formatPercent(n: number, decimals = 0): string {
  return `${n.toFixed(decimals)}%`;
}

export function formatAvailability(n: number): string {
  return `${n.toFixed(3)}%`;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "22 Apr 2025" */
export function formatDate(iso: string | Date, tz: Tz = "utc"): string {
  const d = shift(iso, tz);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "22 Apr" — year omitted; used when the dataset stays inside one year. */
export function formatDayMonth(iso: string | Date, tz: Tz = "utc"): string {
  const d = shift(iso, tz);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "Tue 22 Apr" */
export function formatWeekdayDate(iso: string | Date, tz: Tz = "utc"): string {
  const d = shift(iso, tz);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function formatTime(iso: string | Date, tz: Tz = "utc"): string {
  const d = shift(iso, tz);
  const h = String(d.getUTCHours()).padStart(2, "0");
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/** DESIGN §6.8: "14 Apr, 12:00"; year only when the dataset spans years. */
export function formatRowTime(
  iso: string,
  tz: Tz = "utc",
  withYear = false,
): string {
  const d = shift(iso, tz);
  const date = withYear
    ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
    : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return `${date}, ${formatTime(iso, tz)}`;
}

/** DESIGN §7: durations read "6h 15m" or "45m". */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function tzLabel(tz: Tz): string {
  return tz === "ist" ? "IST" : "UTC";
}

/** Dataset range for the switcher: "6 Apr–5 May 2025". */
export function formatRange(startIso: string, endIso: string): string {
  const s = new Date(startIso);
  const e = new Date(endIso);
  const sameYear = s.getUTCFullYear() === e.getUTCFullYear();
  const left = sameYear ? formatDayMonth(s) : formatDate(s);
  return `${left}–${formatDate(e)}`;
}

/** DESIGN §6.1: filenames are middle-truncated so the seed stays readable. */
export function middleTruncate(text: string, max = 28): string {
  if (text.length <= max) return text;
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  const tail = Math.floor(keep / 2);
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** `YYYY-MM-DD` for a UTC day — the shape the logs API expects. */
export function toUtcDayKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

export function parseUtcDayKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

// DESIGN §6.8: human labels for every flag the cleaner can attach.
export const FLAG_LABELS: Record<string, string> = {
  ts_epoch_converted: "from epoch",
  ts_offset_converted: "from IST",
  latency_unit_seconds: "from seconds",
  latency_missing: "no latency",
  latency_negative_dropped: "bad latency",
  latency_unparseable: "bad latency",
  merged_duplicate: "merged",
  status_conflict_same_agent: "conflicting status",
};

export const FLAG_EXPLANATIONS: Record<string, string> = {
  ts_epoch_converted: "Timestamp was Unix seconds; converted to UTC",
  ts_offset_converted: "Timestamp had a +05:30 offset; converted to UTC",
  latency_unit_seconds: "Latency was reported in seconds; converted to ms",
  latency_missing: "Latency was blank; excluded from latency stats",
  latency_negative_dropped: "Latency was negative; excluded from latency stats",
  latency_unparseable: "Latency wasn't a number; excluded from latency stats",
  merged_duplicate: "Another row reported the same check; combined into this one",
  status_conflict_same_agent: "Duplicate rows disagreed; the failure was kept",
};

// DESIGN §7: rejection reasons in human text.
export const REJECTION_REASONS: Record<string, string> = {
  invalid_status_code: "Status code isn't a valid HTTP status",
  invalid_timestamp: "Timestamp couldn't be read",
  timestamp_without_timezone: "Timestamp has no time zone",
  off_grid_timestamp: "Timestamp isn't on a 15-minute mark",
  timestamp_out_of_bounds: "Timestamp is outside a plausible range",
  invalid_service_id: "Service ID isn't in the expected format",
  missing_required_field: "A required value is empty",
  malformed_row: "Row has too few columns",
};

// DESIGN §6.6: receipt figures link to a logs outcome filter.
export const ISSUE_LABELS: Record<string, (n: number) => string> = {
  ts_epoch_converted: (n) => `${formatNumber(n)} epoch timestamps converted`,
  ts_offset_converted: (n) => `${formatNumber(n)} IST timestamps converted`,
  latency_unit_seconds: (n) => `${formatNumber(n)} latencies converted from seconds`,
  latency_missing: (n) => `${formatNumber(n)} latencies missing or invalid`,
  latency_negative_dropped: (n) => `${formatNumber(n)} negative latencies dropped`,
};
