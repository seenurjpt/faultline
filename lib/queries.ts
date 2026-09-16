import "server-only";
// SPEC §11: every read query lives here, and every one is parameterised.
// No caller ever builds SQL text from user input.
import { db } from "./db";
import type { DatasetSummary, LogRow, RejectedRow } from "./types";

export type SlotRow = {
  service_id: string;
  slot: string;
  is_down: boolean;
  median_latency_ms: number | null;
};

export async function listDatasets(): Promise<DatasetSummary[]> {
  const rows = (await db()`
    select id, filename, range_start, range_end, completed_at, summary, total_rows
    from uploads
    where status = 'complete'
    order by completed_at desc
    limit 50
  `) as {
    id: string;
    filename: string;
    range_start: string;
    range_end: string;
    completed_at: string;
    summary: { stored?: number; merged?: number; rejected?: number } | null;
    total_rows: number;
  }[];

  return rows.map((row) => ({
    id: row.id,
    filename: row.filename,
    rangeStart: new Date(row.range_start).toISOString(),
    rangeEnd: new Date(row.range_end).toISOString(),
    completedAt: new Date(row.completed_at).toISOString(),
    totals: {
      rows: row.total_rows,
      stored: row.summary?.stored ?? 0,
      merged: row.summary?.merged ?? 0,
      rejected: row.summary?.rejected ?? 0,
    },
  }));
}

export type DatasetRow = {
  id: string;
  filename: string;
  range_start: string;
  range_end: string;
  total_rows: number;
  summary: Record<string, unknown> | null;
};

export async function getDataset(id: string): Promise<DatasetRow | null> {
  const rows = (await db()`
    select id, filename, range_start, range_end, total_rows, summary
    from uploads
    where id = ${id}::uuid and status = 'complete'
  `) as DatasetRow[];
  return rows[0] ?? null;
}

/** SPEC §8.2: slot health for the whole dataset, from the slot_status view. */
export async function getSlots(uploadId: string): Promise<SlotRow[]> {
  return (await db()`
    select service_id, slot, is_down, median_latency_ms
    from slot_status
    where upload_id = ${uploadId}::uuid
    order by service_id, slot
  `) as SlotRow[];
}

export async function getServices(
  uploadId: string,
): Promise<{ id: string; name: string }[]> {
  return (await db()`
    select s.id, s.name
    from services s
    where exists (
      select 1 from checks c
      where c.upload_id = ${uploadId}::uuid and c.service_id = s.id
    )
    order by s.name
  `) as { id: string; name: string }[];
}

export async function getAgents(uploadId: string): Promise<string[]> {
  const rows = (await db()`
    select distinct agent from checks
    where upload_id = ${uploadId}::uuid
    order by agent
  `) as { agent: string }[];
  return rows.map((r) => r.agent);
}

/** Non-null latencies per service inside a period, for p50/p95. */
export async function getLatencies(
  uploadId: string,
  from: Date,
  to: Date,
): Promise<{ service_id: string; p50: number | null; p95: number | null }[]> {
  return (await db()`
    select service_id,
           percentile_cont(0.5) within group (order by latency_ms) as p50,
           percentile_cont(0.95) within group (order by latency_ms) as p95
    from checks
    where upload_id = ${uploadId}::uuid
      and latency_ms is not null
      and checked_at >= ${from.toISOString()}::timestamptz
      and checked_at <  ${to.toISOString()}::timestamptz
    group by service_id
  `) as { service_id: string; p50: number | null; p95: number | null }[];
}

export async function getQuality(uploadId: string): Promise<{
  rejectedByReason: Record<string, number>;
  issues: Record<string, number>;
}> {
  const [reasonRows, issueRows] = await Promise.all([
    db()`
      select reason, count(*)::int as n
      from rejected_rows where upload_id = ${uploadId}::uuid
      group by reason
    `,
    db()`
      select key, sum(value::int)::int as n
      from upload_chunks, jsonb_each_text(issue_counts)
      where upload_id = ${uploadId}::uuid
      group by key
    `,
  ]);

  const rejectedByReason: Record<string, number> = {};
  for (const row of reasonRows as { reason: string; n: number }[]) {
    rejectedByReason[row.reason] = row.n;
  }
  const issues: Record<string, number> = {};
  for (const row of issueRows as { key: string; n: number }[]) {
    issues[row.key] = row.n;
  }
  return { rejectedByReason, issues };
}

// ---------------------------------------------------------------------------
// Logs — SPEC §11.3
// ---------------------------------------------------------------------------

export type LogsQuery = {
  uploadId: string;
  from: Date | null;
  to: Date | null;
  services: string[];
  outcome: "all" | "failures" | "slow" | "flagged";
  agent: string | null;
  cursor: { checkedAt: string; serviceId: string; agent: string } | null;
  /**
   * Rows to skip, for jumping straight to a page number. Mutually exclusive
   * with `cursor` — a jump has no cursor to start from.
   */
  offset?: number;
  limit: number;
  /** Per-service 2× baseline thresholds, for outcome=slow. */
  slowThresholds: Record<string, number>;
};

/**
 * Keyset pagination on (checked_at, service_id, agent). Offset pagination
 * would re-scan every earlier row for each page and can skip or repeat rows
 * when data changes between requests; a keyset cannot. Stepping through pages
 * therefore uses the cursor.
 *
 * `offset` exists only for jumping directly to a page number, which a keyset
 * cannot express — there is no cursor for a page nobody has visited. It is
 * the same trade-off every "go to page N" control makes. It is safe here
 * because an upload is immutable once complete, so no row can shift between
 * requests, and because the row count is bounded by the 200,000-row upload
 * limit: measured on the 15,551-row fixture, the deepest jump plans at ~8 ms.
 *
 * Conditions are assembled as SQL text with numbered placeholders, and every
 * value goes through the parameter array — nothing is interpolated. Building
 * the WHERE clause this way (rather than `$1::boolean or <column> ...`) keeps
 * the column comparisons plain, so Postgres can still use
 * checks_upload_keyset instead of falling back to a sequential scan.
 */
export async function getLogs(
  q: LogsQuery,
): Promise<{ rows: LogRow[]; total: number }> {
  const where: string[] = ["c.upload_id = $1::uuid"];
  const values: unknown[] = [q.uploadId];
  const add = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };

  if (q.from) where.push(`c.checked_at >= ${add(q.from.toISOString())}::timestamptz`);
  if (q.to) where.push(`c.checked_at < ${add(q.to.toISOString())}::timestamptz`);
  if (q.services.length > 0) {
    where.push(`c.service_id = any(${add(q.services)}::text[])`);
  }
  if (q.agent) where.push(`c.agent = ${add(q.agent)}`);

  if (q.outcome === "failures") {
    where.push("c.status_code not between 200 and 399");
  } else if (q.outcome === "flagged") {
    where.push("array_length(c.flags, 1) > 0");
  } else if (q.outcome === "slow") {
    // Per-service thresholds arrive as a small (service_id, threshold) list.
    // With no thresholds nothing can be slow, so short-circuit to no rows.
    const ids = Object.keys(q.slowThresholds);
    if (ids.length === 0) {
      where.push("false");
    } else {
      const idsParam = add(ids);
      const valuesParam = add(ids.map((id) => q.slowThresholds[id]));
      where.push(
        `c.latency_ms is not null and c.latency_ms > (
           select t.threshold from unnest(${idsParam}::text[], ${valuesParam}::float8[])
             as t(service_id, threshold)
           where t.service_id = c.service_id
         )`,
      );
    }
  }

  const countSql = `
    select count(*)::int as n
    from checks c
    where ${where.join(" and ")}
  `;
  const countValues = [...values];

  // The cursor applies only to the page, never to the total.
  if (q.cursor) {
    where.push(
      `(c.checked_at, c.service_id, c.agent) > (${add(q.cursor.checkedAt)}::timestamptz, ${add(
        q.cursor.serviceId,
      )}::text, ${add(q.cursor.agent)}::text)`,
    );
  }

  const pageSql = `
    select c.checked_at, c.service_id, s.name as service_name, c.agent,
           c.region, c.status_code, c.latency_ms, c.flags,
           c.raw_timestamp, c.source_line
    from checks c
    join services s on s.id = c.service_id
    where ${where.join(" and ")}
    order by c.checked_at asc, c.service_id asc, c.agent asc
    limit ${add(q.limit)}${q.offset ? ` offset ${add(q.offset)}` : ""}
  `;

  const sql = db();
  const [rows, totalRows] = await Promise.all([
    sql.query(pageSql, values),
    sql.query(countSql, countValues),
  ]);

  type Row = {
    checked_at: string;
    service_id: string;
    service_name: string;
    agent: string;
    region: string | null;
    status_code: number;
    latency_ms: number | null;
    flags: string[];
    raw_timestamp: string;
    source_line: number;
  };

  const mapped: LogRow[] = (rows as Row[]).map((r) => {
    const threshold = q.slowThresholds[r.service_id];
    return {
      checkedAt: new Date(r.checked_at).toISOString(),
      serviceId: r.service_id,
      serviceName: r.service_name,
      agent: r.agent,
      region: r.region,
      statusCode: r.status_code,
      outcome: r.status_code < 200 || r.status_code > 399 ? "down" : "up",
      latencyMs: r.latency_ms,
      slow:
        r.latency_ms !== null &&
        threshold !== undefined &&
        r.latency_ms > threshold,
      flags: r.flags ?? [],
      rawTimestamp: r.raw_timestamp,
      sourceLine: r.source_line,
    };
  });

  return {
    rows: mapped,
    total: ((totalRows as { n: number }[])[0]?.n ?? 0),
  };
}

export async function getRejectedRows(
  uploadId: string,
  limit: number,
  afterId: number | null,
  offset = 0,
): Promise<{ rows: RejectedRow[]; total: number; nextId: number | null }> {
  const [rows, totalRows] = await Promise.all([
    db()`
      select id, line_number, reason, raw_line
      from rejected_rows
      where upload_id = ${uploadId}::uuid
        and (${afterId === null}::boolean or id > ${afterId ?? 0})
      order by id asc
      limit ${limit}
      offset ${offset}
    `,
    db()`
      select count(*)::int as n from rejected_rows
      where upload_id = ${uploadId}::uuid
    `,
  ]);

  type Row = { id: number; line_number: number; reason: string; raw_line: string };
  const list = rows as Row[];

  return {
    rows: list.map((r) => ({
      lineNumber: r.line_number,
      reason: r.reason,
      rawLine: r.raw_line,
    })),
    total: ((totalRows as { n: number }[])[0]?.n ?? 0),
    nextId: list.length === limit ? (list[list.length - 1]?.id ?? null) : null,
  };
}

/**
 * Deletes one upload and everything derived from it. `checks`,
 * `upload_chunks` and `rejected_rows` all reference `uploads(id)` with
 * `on delete cascade` (001_init.sql), so this one statement clears them too.
 *
 * `services` is deliberately left alone: it has no `upload_id` and is shared
 * across uploads, and getServices() only returns services that still have
 * checks, so a row left behind is invisible and gets reused on the next
 * upload rather than duplicated.
 *
 * Returns the filename when a row was deleted, or null when the id matched
 * nothing — which lets the caller answer 404 instead of a silent success.
 */
export async function deleteDataset(id: string): Promise<string | null> {
  const rows = (await db()`
    delete from uploads
    where id = ${id}::uuid
    returning filename
  `) as { filename: string }[];
  return rows[0]?.filename ?? null;
}
