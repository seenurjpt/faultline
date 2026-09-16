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
  const { uploadId, chunkIndex, rejections } = params;

  // Batches upload in parallel, so two transactions can upsert overlapping
  // keys at the same time. Postgres takes row locks in statement order, and
  // two statements that lock the same rows in different orders can deadlock.
  // Sorting every batch by the conflict key gives them all one order, which
  // makes a deadlock impossible rather than merely unlikely.
  const checks = [...params.checks].sort(
    (a, b) =>
      cmp(a.serviceId, b.serviceId) ||
      a.checkedAt.getTime() - b.checkedAt.getTime() ||
      cmp(a.agent, b.agent),
  );

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
      -- The same rule as mergeChecks() in core: a failure beats a success,
      -- and on a tie the copy seen first wins. "Seen first" is expressed as
      -- the lower source line rather than the row already in the table, so
      -- the result is the same whichever batch happens to land first — that
      -- is what lets batches be sent in parallel without changing a number.
      on conflict (upload_id, service_id, checked_at, agent) do update set
        status_code = case
          when excluded.status_code not between 200 and 399
           and checks.status_code between 200 and 399 then excluded.status_code
          when checks.status_code not between 200 and 399
           and excluded.status_code between 200 and 399 then checks.status_code
          when excluded.source_line < checks.source_line then excluded.status_code
          else checks.status_code end,
        latency_ms = case
          when excluded.source_line < checks.source_line
            then coalesce(excluded.latency_ms, checks.latency_ms)
          else coalesce(checks.latency_ms, excluded.latency_ms) end,
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
    -- stored and merged_across_chunks are deliberately not overwritten here:
    -- the first attempt corrects them below once the upsert result is known,
    -- and a retry must not replace that with the rows it merely attempted.
    on conflict (upload_id, chunk_index) do update set
      rows_in = excluded.rows_in,
      merged_in_chunk = excluded.merged_in_chunk,
      rejected = excluded.rejected,
      issue_counts = excluded.issue_counts,
      processed_at = now()
  `);

  const results = await sql.transaction(statements);

  if (checks.length === 0) return { stored: 0, mergedAcrossChunks: 0 };

  // The checks upsert is the only statement that returns rows; xmax = 0 marks
  // a genuine insert, anything else was merged into an existing row.
  const insertIndex = serviceIds.length > 0 ? 1 : 0;
  const returned = (results[insertIndex] ?? []) as { inserted: boolean }[];

  // A retried batch matches its own rows, which the upsert's WHERE skips, so
  // nothing comes back. The first attempt recorded the real numbers, and
  // those are what the retry reports rather than a misleading zero.
  if (returned.length === 0) {
    const rows = (await sql`
      select stored, merged_across_chunks
      from upload_chunks
      where upload_id = ${uploadId}::uuid and chunk_index = ${chunkIndex}
    `) as { stored: number; merged_across_chunks: number }[];
    return {
      stored: rows[0]?.stored ?? 0,
      mergedAcrossChunks: rows[0]?.merged_across_chunks ?? 0,
    };
  }

  let stored = 0;
  let mergedAcrossChunks = 0;
  for (const row of returned) {
    if (row.inserted) stored++;
    else mergedAcrossChunks++;
  }

  // The chunk record was written inside the transaction, before the upsert
  // result existed, so it held the rows attempted rather than the rows
  // inserted. Recording the real split is what lets a resumed upload report
  // exact numbers for the batches it skips.
  await sql`
    update upload_chunks
    set stored = ${stored}, merged_across_chunks = ${mergedAcrossChunks}
    where upload_id = ${uploadId}::uuid and chunk_index = ${chunkIndex}
  `;

  return { stored, mergedAcrossChunks };
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * An unfinished upload of the same bytes, so a second attempt continues it
 * instead of starting over and leaving the first one orphaned. The shape has
 * to match as well: a batch size change between deploys would make the
 * recorded indexes mean something else.
 */
export async function findResumableBySha(
  sql: Sql,
  sha256: string,
  totalRows: number,
  chunkCount: number,
): Promise<{ id: string } | null> {
  const rows = (await sql`
    select id
    from uploads
    where sha256 = ${sha256}
      and status = 'processing'
      and total_rows = ${totalRows}
      and chunk_count = ${chunkCount}
    order by created_at desc
    limit 1
  `) as { id: string }[];
  return rows[0] ?? null;
}

export type ReceivedChunk = {
  chunkIndex: number;
  rowsIn: number;
  stored: number;
  mergedInChunk: number;
  mergedAcrossChunks: number;
  rejected: number;
  issues: Record<string, number>;
};

/**
 * The batches an upload already holds, in the same shape as the report each
 * one produced when it was first written, so the client can treat them
 * exactly like batches it just sent.
 */
export async function receivedChunkReports(
  sql: Sql,
  uploadId: string,
): Promise<ReceivedChunk[]> {
  const rows = (await sql`
    select chunk_index, rows_in, stored, merged_in_chunk,
           merged_across_chunks, rejected, issue_counts
    from upload_chunks
    where upload_id = ${uploadId}::uuid
    order by chunk_index
  `) as {
    chunk_index: number;
    rows_in: number;
    stored: number;
    merged_in_chunk: number;
    merged_across_chunks: number;
    rejected: number;
    issue_counts: Record<string, number> | null;
  }[];
  return rows.map((r) => ({
    chunkIndex: r.chunk_index,
    rowsIn: r.rows_in,
    stored: r.stored,
    mergedInChunk: r.merged_in_chunk,
    mergedAcrossChunks: r.merged_across_chunks,
    rejected: r.rejected,
    issues: r.issue_counts ?? {},
  }));
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
