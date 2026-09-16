// SPEC §7.4: two rows are duplicates when they share
// (upload, service_id, checked_at, agent) *after* timestamp normalisation —
// which is exactly what exposes the same check written once as ISO and once
// as epoch or +05:30.
import { isDown } from "./clean";
import type { CheckFlag, CleanCheck } from "./types";

/** The duplicate key for one upload. Time is the normalised UTC instant. */
export function mergeKey(check: CleanCheck): string {
  return `${check.serviceId}\u0000${check.checkedAt.getTime()}\u0000${check.agent}`;
}

function unionFlags(a: CheckFlag[], b: CheckFlag[], extra: CheckFlag[]): CheckFlag[] {
  return [...new Set([...a, ...b, ...extra])];
}

/**
 * Merges two checks that share a key. `a` is the one seen first.
 *
 * Failures win: the cost of wrongly hiding an outage (a customer denied a
 * credit) is higher than the cost of wrongly showing one, and either way the
 * disagreement is recorded as a flag.
 */
export function mergeChecks(a: CleanCheck, b: CleanCheck): CleanCheck {
  const aDown = isDown(a.statusCode);
  const bDown = isDown(b.statusCode);

  let statusCode: number;
  if (aDown === bDown) {
    // Both failures or both healthy: keep the first seen.
    statusCode = a.statusCode;
  } else {
    statusCode = aDown ? a.statusCode : b.statusCode;
  }

  const extra: CheckFlag[] = ["merged_duplicate"];
  if (a.statusCode !== b.statusCode) extra.push("status_conflict_same_agent");

  return {
    ...a,
    statusCode,
    // First non-null latency survives, so a blank duplicate never erases a
    // measured value (SPEC §7.5, the 14d file).
    latencyMs: a.latencyMs ?? b.latencyMs,
    sourceLine: Math.min(a.sourceLine, b.sourceLine),
    flags: unionFlags(a.flags, b.flags, extra),
  };
}

/**
 * Collapses duplicates inside one chunk. The bulk upsert requires unique keys
 * within a single statement, so this must run before the database sees them.
 */
export function mergeWithinChunk(checks: CleanCheck[]): {
  merged: CleanCheck[];
  mergedInChunk: number;
} {
  const byKey = new Map<string, CleanCheck>();
  let mergedInChunk = 0;

  for (const check of checks) {
    const key = mergeKey(check);
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, check);
      continue;
    }
    byKey.set(key, mergeChecks(existing, check));
    mergedInChunk++;
  }

  return { merged: [...byKey.values()], mergedInChunk };
}
