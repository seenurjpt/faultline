// All writes live here. Every statement is parameterised — no value is ever
// interpolated into SQL text.
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { CleanCheck, IssueCounts, Rejection } from "../../core/src/types";

export type Sql = NeonQueryFunction<false, false>;

export function client(databaseUrl: string): Sql {
  return neon(databaseUrl);
}

export type UploadRow = {
  id: string;
  filename: string;
  total_rows: number;
  chunk_count: number;
  status: "processing" | "complete";
};

export async function pingDb(sql: Sql): Promise<boolean> {
  try {
    await sql`select 1`;
    return true;
  } catch {
    return false;
  }
}

/** SPEC §6.2: only a *complete* upload of the same bytes is a duplicate. */
export async function findCompletedBySha(
  sql: Sql,
  sha256: string,
): Promise<{ id: string; completed_at: string } | null> {
  const rows = (await sql`
    select id, completed_at
    from uploads
    where sha256 = ${sha256} and status = 'complete'
    order by completed_at desc
    limit 1
  `) as { id: string; completed_at: string }[];
  return rows[0] ?? null;
}

export async function createUpload(
  sql: Sql,
  input: {
    filename: string;
    sizeBytes: number;
    sha256: string;
    totalRows: number;
    chunkCount: number;
  },
): Promise<string> {
  const rows = (await sql`
    insert into uploads (filename, size_bytes, sha256, total_rows, chunk_count)
    values (${input.filename}, ${input.sizeBytes}, ${input.sha256},
            ${input.totalRows}, ${input.chunkCount})
    returning id
  `) as { id: string }[];
  return rows[0].id;
}

export async function getUpload(
  sql: Sql,
  uploadId: string,
): Promise<UploadRow | null> {
  const rows = (await sql`
    select id, filename, total_rows, chunk_count, status
    from uploads
    where id = ${uploadId}
  `) as UploadRow[];
  return rows[0] ?? null;
}

export type ChunkWriteResult = {
  stored: number;
  mergedAcrossChunks: number;
};

/**
 * SPEC §6.3 step 4 and §10.1. Writes one chunk in a single transaction:
 * services, checks, rejected rows and the chunk record either all land or
 * none do, so a failed chunk never leaves partial counts behind.
 */
export async function writeChunk(
  sql: Sql,
  params: {
    uploadId: string;
    chunkIndex: number;
    checks: CleanCheck[];
    rejections: Rejection[];
    rowsIn: number;
    mergedInChunk: number;
    issues: IssueCounts;
  },
): Promise<ChunkWriteResult> {
  const { uploadId, chunkIndex, checks, rejections } = params;

  // Services first: checks.service_id references them.
  const serviceIds = [...new Set(checks.map((c) => c.serviceId))];
  const serviceNames = serviceIds.map(
    (id) => checks.find((c) => c.serviceId === id)!.serviceName,
  );

  // Column-wise arrays for the unnest upsert (§10.1).
  const sIds = checks.map((c) => c.serviceId);
  const times = checks.map((c) => c.checkedAt.toISOString());
  const agents = checks.map((c) => c.agent);
  const regions = checks.map((c) => c.region);
  const statuses = checks.map((c) => c.statusCode);
  const latencies = checks.map((c) => c.latencyMs);
  const formats = checks.map((c) => c.tsFormat);
  const rawTimes = checks.map((c) => c.rawTimestamp);
  const lines = checks.map((c) => c.sourceLine);
  // Postgres text[] literals are awkward through the HTTP driver, so flags
  // travel as a pipe-joined string and are split server-side.
  const flags = checks.map((c) => c.flags.join("|"));

  const statements = [];

  if (serviceIds.length > 0) {
    statements.push(sql`
      insert into services (id, name)
      select s, n from unnest(${serviceIds}::text[], ${serviceNames}::text[]) as u(s, n)
      on conflict (id) do nothing
    `);
  }

  if (checks.length > 0) {
    statements.push(sql`
      insert into checks (upload_id, service_id, checked_at, agent, region,
                          status_code, latency_ms, ts_format, raw_timestamp,
                          source_line, flags)
      select ${uploadId}::uuid, s, t::timestamptz, a, r, sc, l, f, rt, sl,
             case when fl = '' then '{}'::text[] else string_to_array(fl, '|') end
      from unnest(${sIds}::text[], ${times}::text[], ${agents}::text[],
                  ${regions}::text[], ${statuses}::smallint[], ${latencies}::int[],
                  ${formats}::text[], ${rawTimes}::text[], ${lines}::int[],
                  ${flags}::text[])
           as u(s, t, a, r, sc, l, f, rt, sl, fl)
      on conflict (upload_id, service_id, checked_at, agent) do update set
        status_code = case
          when excluded.status_code not between 200 and 399
           and checks.status_code between 200 and 399 then excluded.status_code
          else checks.status_code end,
        latency_ms  = coalesce(checks.latency_ms, excluded.latency_ms),
        source_line = least(checks.source_line, excluded.source_line),
        flags = (select array_agg(distinct x) from unnest(
                   checks.flags || excluded.flags || array['merged_duplicate'] ||
                   case when checks.status_code <> excluded.status_code
                        then array['status_conflict_same_agent']
                        else '{}'::text[] end) as x)
      -- A retry of the same chunk must not mark its own rows as merged
      -- duplicates, so a row that matches itself is skipped entirely.
      where checks.source_line <> excluded.source_line
      returning (xmax = 0) as inserted
    `);
  }

  // Delete-then-insert keeps a retried chunk from doubling its rejections.
  statements.push(sql`
    delete from rejected_rows
    where upload_id = ${uploadId}::uuid and chunk_index = ${chunkIndex}
  `);

  if (rejections.length > 0) {
    const rLines = rejections.map((r) => r.lineNumber);
    const rReasons = rejections.map((r) => r.reason);
    // A pathological row could be enormous; the raw line is for display only.
    const rRaw = rejections.map((r) => r.rawLine.slice(0, 2000));
    statements.push(sql`
      insert into rejected_rows (upload_id, chunk_index, line_number, reason, raw_line)
      select ${uploadId}::uuid, ${chunkIndex}, ln, rs, rw
      from unnest(${rLines}::int[], ${rReasons}::text[], ${rRaw}::text[]) as u(ln, rs, rw)
    `);
  }

  statements.push(sql`
    insert into upload_chunks (upload_id, chunk_index, rows_in, stored,
                               merged_in_chunk, merged_across_chunks, rejected,
                               issue_counts)
    values (${uploadId}::uuid, ${chunkIndex}, ${params.rowsIn}, ${checks.length},
            ${params.mergedInChunk}, 0, ${rejections.length},
            ${JSON.stringify(params.issues)}::jsonb)
    on conflict (upload_id, chunk_index) do update set
      rows_in = excluded.rows_in,
      stored = excluded.stored,
      merged_in_chunk = excluded.merged_in_chunk,
      rejected = excluded.rejected,
      issue_counts = excluded.issue_counts,
      processed_at = now()
  `);

  const results = await sql.transaction(statements);

  // The checks upsert is the only statement that returns rows; xmax = 0 marks
  // a genuine insert, anything else was merged into an existing row.
  let stored = 0;
  let mergedAcrossChunks = 0;
  if (checks.length > 0) {
    const insertIndex = serviceIds.length > 0 ? 1 : 0;
    const returned = (results[insertIndex] ?? []) as { inserted: boolean }[];
    for (const row of returned) {
      if (row.inserted) stored++;
      else mergedAcrossChunks++;
    }
  }

  return { stored, mergedAcrossChunks };
}

/** SPEC §6.4: which chunk indexes have not been recorded yet. */
export async function missingChunks(
  sql: Sql,
  uploadId: string,
  chunkCount: number,
): Promise<number[]> {
  const rows = (await sql`
    select chunk_index from upload_chunks where upload_id = ${uploadId}::uuid
  `) as { chunk_index: number }[];
  const present = new Set(rows.map((r) => r.chunk_index));
  const missing: number[] = [];
  for (let i = 0; i < chunkCount; i++) {
    if (!present.has(i)) missing.push(i);
  }
  return missing;
}

export type CompleteSummary = {
  rows: number;
  stored: number;
  merged: number;
  rejected: number;
  issues: Record<string, number>;
  rangeStart: string | null;
  rangeEnd: string | null;
  services: string[];
};

/**
 * SPEC §6.4: totals come from the tables, never from summing chunk reports,
 * so a retried chunk cannot skew the final numbers.
 */
export async function completeUpload(
  sql: Sql,
  upload: UploadRow,
): Promise<CompleteSummary> {
  const uploadId = upload.id;

  const [storedRows, rejectedRows, rangeRows, serviceRows, issueRows] =
    await Promise.all([
      sql`select count(*)::int as n from checks where upload_id = ${uploadId}::uuid`,
      sql`select count(*)::int as n from rejected_rows where upload_id = ${uploadId}::uuid`,
      sql`
        select date_trunc('day', min(checked_at)) as range_start,
               date_trunc('day', max(checked_at)) + interval '1 day' as range_end
        from checks where upload_id = ${uploadId}::uuid
      `,
      sql`
        select distinct service_id from checks
        where upload_id = ${uploadId}::uuid order by service_id
      `,
      sql`
        select key, sum(value::int)::int as n
        from upload_chunks, jsonb_each_text(issue_counts)
        where upload_id = ${uploadId}::uuid
        group by key
      `,
    ]);

  const stored = ((storedRows as { n: number }[])[0]?.n ?? 0);
  const rejected = ((rejectedRows as { n: number }[])[0]?.n ?? 0);
  const range = (rangeRows as { range_start: string | null; range_end: string | null }[])[0];
  const services = (serviceRows as { service_id: string }[]).map((r) => r.service_id);

  const issues: Record<string, number> = {};
  for (const row of issueRows as { key: string; n: number }[]) {
    issues[row.key] = row.n;
  }

  const summary: CompleteSummary = {
    rows: upload.total_rows,
    stored,
    // Whatever was read but neither stored nor rejected was merged into an
    // existing row.
    merged: upload.total_rows - stored - rejected,
    rejected,
    issues,
    rangeStart: range?.range_start ?? null,
    rangeEnd: range?.range_end ?? null,
    services,
  };

  await sql`
    update uploads set
      status = 'complete',
      completed_at = now(),
      range_start = ${summary.rangeStart},
      range_end = ${summary.rangeEnd},
      summary = ${JSON.stringify(summary)}::jsonb
    where id = ${uploadId}::uuid
  `;

  return summary;
}
