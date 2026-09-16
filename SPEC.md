# Faultline — SLA Monitoring Dashboard

**Engineering & Product Spec** · companion to `DESIGN.md` (visuals) and `BUILD_PROMPT.md` (build order)

Faultline turns raw multi-agent health-check logs into numbers a billing team can trust: per-service monthly availability against a 99.9% SLA, the incidents behind any breach, and a full record of what was cleaned and why.

This document owns **behaviour, data, and workflow**. Anything about how things look lives in `DESIGN.md`. If the two ever disagree about behaviour, this file wins.

---

## 1. Goals and non-goals

### Goals

1. **Trustworthy numbers.** The same CSV always produces the same availability figures, regardless of how the upload was chunked or how many times it was uploaded.
2. **Auditable cleaning.** Every input row ends up in exactly one of three places: stored as a check, merged into another check as a duplicate, or rejected with a reason code. The dashboard can show all three.
3. **A real pipeline.** Browser → deployed Cloudflare Worker → Neon Postgres → Next.js dashboard on Vercel. Every piece runs in the cloud on a free tier with no card on file.
4. **Useful at a glance.** On-call engineers see when things broke; billing sees which services are credit-eligible for which month.

### Non-goals (explicitly out of scope)

| Not building | Why |
|---|---|
| Authentication, user accounts | Excluded by the assignment |
| Multi-tenant support | Excluded by the assignment |
| CI pipelines | Excluded by the assignment (local tests only) |
| Credit amount calculation (tiers, currency) | The brief defines only the 99.9% threshold; we flag eligibility, not payout |
| Real-time ingestion / streaming | Input is a file upload |
| Editing or deleting stored data from the UI | Keeps the audit trail intact; noted as future work |

---

## 2. Users and stories

**On-call engineer**
- As an on-call engineer, I want to see when each service was failing across the whole file, so I can find the incident window quickly.
- As an on-call engineer, I want to open the exact check records behind a failure, so I can see status codes, latency and which agent reported them.

**Billing / support analyst**
- As a billing analyst, I want each service's availability for a calendar month next to the 99.9% target, so I know which customers are owed a credit.
- As a billing analyst, I want to know how much of the month the data actually covers, so I don't treat a 5-day sample as a full month without saying so.
- As a support analyst, I want to see what the pipeline rejected or merged, so I can answer "why doesn't your number match mine?"

**Uploader**
- As an uploader, I want clear progress while a file is processed, and a plain explanation if it fails, so I know whether to retry.
- As an uploader, I want to be told if I'm uploading a file that was already processed, so I don't create duplicate datasets by accident.

---

## 3. Architecture

```
 ┌──────────────────────────┐        PUT chunk (text/csv)       ┌─────────────────────────────┐
 │  Next.js app (Vercel)    │ ────────────────────────────────▶ │ Cloudflare Worker           │
 │  /upload  – upload UI    │ ◀──────── chunk report (JSON) ─── │ "processor"                 │
 │  /        – dashboard    │                                   │ parse → validate → clean    │
 │  /api/*   – read API     │                                   │ → bulk upsert (1 txn/chunk) │
 └────────────┬─────────────┘                                   └──────────────┬──────────────┘
              │ SQL over HTTPS (@neondatabase/serverless)                      │ SQL over HTTPS
              ▼                                                                ▼
        ┌──────────────────────────────────────────────────────────────────────────────┐
        │  Neon Postgres (free tier)                                                   │
        │  uploads · upload_chunks · services · checks · rejected_rows · slot_status   │
        └──────────────────────────────────────────────────────────────────────────────┘
```

| Piece | Runs on | Why this choice |
|---|---|---|
| Upload UI + dashboard | Next.js (App Router, TypeScript) on Vercel Hobby | Strongest existing skill; server components let the dashboard render from the URL state |
| Processor | Cloudflare Worker (TypeScript) on Workers Free | Real, deployed, stateless serverless function; no card needed. Free plan allows **10 ms CPU per request**, so uploads are chunked (see §5) |
| Database | Neon Postgres, free tier | Relational fits billing data; unique constraints make re-processing idempotent; HTTP driver works from both Workers and Vercel; compute resumes automatically after idling |
| Shared logic | `packages/core` (pure TypeScript, zero runtime deps) | The cleaning, merge, SLA and incident rules are written once, unit-tested once, and imported by both the Worker and the web app |

**Why the Worker does not read data back:** the brief says the function parses, validates and cleans. Keeping reads in Next.js keeps the Worker small, single-purpose and well under its CPU budget.

**Measured basis for chunking:** plain JavaScript parse-and-clean of the 30-day fixture (15,577 rows) took about 30 ms CPU in a Node sandbox. Chunks of 2,000 rows are therefore expected to take roughly 4 ms. The real number must be read from the Cloudflare dashboard (Workers → processor → Metrics → CPU time) after deploy and recorded in the README.

---

## 4. Repository layout

```
faultline/
├── apps/
│   ├── web/                    # Next.js app (Vercel root directory)
│   │   ├── app/
│   │   │   ├── page.tsx        # dashboard
│   │   │   ├── upload/page.tsx # upload screen
│   │   │   └── api/
│   │   │       ├── datasets/route.ts
│   │   │       ├── datasets/[id]/overview/route.ts
│   │   │       └── datasets/[id]/logs/route.ts
│   │   ├── components/         # see DESIGN.md for component inventory
│   │   ├── lib/db.ts           # neon() client, server-only
│   │   ├── lib/queries.ts      # all SQL for reads
│   │   └── lib/upload-client.ts# chunker + bounded-concurrency sender
│   └── processor/              # Cloudflare Worker
│       ├── src/index.ts        # router
│       ├── src/handlers/*.ts
│       ├── src/db.ts           # bulk upsert statements
│       └── wrangler.jsonc
├── packages/
│   └── core/
│       ├── src/csv.ts          # RFC 4180 line parser + quote-aware splitter
│       ├── src/clean.ts        # row → CleanCheck | Rejection
│       ├── src/merge.ts        # duplicate merge rule
│       ├── src/sla.ts          # health, slots, availability, error budget
│       ├── src/incidents.ts    # incident detection
│       ├── src/types.ts
│       └── test/               # vitest, including golden tests on fixtures
├── db/migrations/001_init.sql
├── fixtures/                   # the 5 provided CSVs + dataset_incident_log.json
├── scripts/
│   ├── migrate.ts              # applies db/migrations in order
│   ├── verify-fixtures.ts      # runs core on fixtures, prints golden table
│   └── smoke.ts                # uploads a fixture to the deployed Worker, checks results
├── README.md
├── SPEC.md
├── DESIGN.md
└── pnpm-workspace.yaml
```

Package manager: **pnpm** workspaces. Node **22 LTS**. Use the current stable versions of Next.js, Wrangler, Tailwind CSS v4, `@neondatabase/serverless`, `zod` and `vitest` at scaffold time, and pin them in lockfiles.

---

## 5. End-to-end workflow

### 5.1 Upload flow (happy path)

1. **Pick file.** User drops or selects a `.csv` on `/upload`.
2. **Pre-flight in the browser** (no network yet):
   - Reject if extension is not `.csv` or size > 10 MB.
   - Read text, strip UTF-8 BOM, split into lines **outside quotes** (`packages/core/csv.ts`).
   - Parse the header; it must contain all required columns: `service_id, service_name, timestamp, status_code, latency, latency_unit, agent, region` (order may differ, extra columns are ignored).
   - Count data lines, compute `sha256` of the file bytes with `crypto.subtle`, compute `chunkCount = ceil(dataLines / 2000)`.
   - Show the pre-flight summary (file name, size, rows, chunks) and the **Process file** button.
3. **Create upload.** `POST {PROCESSOR}/v1/uploads` with the pre-flight metadata.
   - If a *complete* upload with the same `sha256` exists and `force` is false → `409 already_uploaded`. UI offers **Open existing dataset** or **Process again** (re-sends with `force: true`).
4. **Send chunks, up to 4 in flight.** For every `i` the processor did not report as already received: `PUT {PROCESSOR}/v1/uploads/{id}/chunks/{i}` with body = header line + that chunk's data lines, and header `X-Line-Offset` = file line number of the chunk's first data line (header is line 1, first data line is line 2). Chunks are independent, and the cross-chunk merge rule (§7.4) is written so the stored result is the same whichever chunk lands first, so completion order does not matter.
   - On network error or a `5xx` with `retryable: true`: retry up to 3 times with 500 ms / 1.5 s / 4 s backoff. Chunks are idempotent (see §8), so a retry never double-counts.
   - On `4xx`: stop and show the error; do not continue with later chunks.
   - Progress UI updates after each chunk with that chunk's report.
5. **Complete.** `POST {PROCESSOR}/v1/uploads/{id}/complete`. Worker verifies every chunk index is present, computes totals and the data range, marks the upload `complete`, returns the summary.
6. **Receipt.** UI shows the processing receipt (§6.4 fields) and an **Open dashboard** action that navigates to `/?dataset={id}`.

### 5.2 Failure paths

| Situation | Behaviour |
|---|---|
| Header missing columns | Pre-flight blocks with the list of missing columns; nothing is sent |
| Worker unreachable | After 3 retries: "Couldn't reach the processor. Your file wasn't stored. Try again." Upload stays `processing`; choosing the same file again continues it |
| A chunk returns 422 | Stop and cancel the other chunks in flight; show the reason from the response |
| User closes the tab mid-upload | Upload stays `processing`; it never appears in the dataset switcher. Choosing the same file again **resumes** it: `POST /v1/uploads` finds the unfinished upload of the same bytes and shape, returns its id with the chunks already recorded, and the UI sends only the rest. Only *complete* uploads trigger the duplicate check |
| `complete` returns `missing_chunks` | UI re-sends only the missing indices once, then calls `complete` again |

### 5.3 Dashboard flow

1. `/` with no `dataset` param → redirect to the most recently completed dataset, or show the empty state with a link to `/upload`.
2. All dashboard state lives in the URL: `dataset`, `period`, `stats` (open/closed), `tz` (utc/ist), and the logs filters. A copied URL reproduces the exact view (useful for support tickets).
3. Server renders the overview for the selected dataset and period; the logs table fetches client-side with keyset pagination.
4. Clicking a day in the fault ribbon sets the logs filter to that UTC day and that service and scrolls to the logs section.

---

## 6. Processor (Cloudflare Worker) API

Base path `/v1`. All responses are JSON. CORS: allow only origins listed in `ALLOWED_ORIGINS`; handle `OPTIONS` preflight; allow headers `Content-Type, X-Line-Offset`.

Error body shape everywhere:
```json
{ "error": "snake_case_code", "message": "Plain sentence for the UI.", "retryable": false, "details": {} }
```

### 6.1 `GET /v1/health`
`200 { "ok": true, "db": true }` — runs `select 1`. `db: false` with `503` if Neon is unreachable.

### 6.2 `POST /v1/uploads`
Request:
```json
{
  "filename": "monitoring_checks_30d_seed404.csv",
  "sizeBytes": 1167719,
  "sha256": "hex…",
  "totalRows": 15577,
  "chunkCount": 8,
  "header": ["service_id","service_name","timestamp","status_code","latency","latency_unit","agent","region"],
  "force": false
}
```
Validation (zod): filename ≤ 200 chars; `sizeBytes` ≤ 10 MB; `sha256` 64 hex; `totalRows` 1–200,000; `chunkCount` = `ceil(totalRows/2000)`; header contains all required columns.

Responses:
- `201 { "uploadId": "uuid" }`
- `200 { "uploadId": "uuid", "resumed": true, "receivedChunks": [ <chunk reports, §6.3> ] }` — an unfinished upload of the same bytes, `totalRows` and `chunkCount` already exists; the client sends only the chunks not listed
- `409 { "error": "already_uploaded", "details": { "uploadId": "uuid", "completedAt": "iso" } }`
- `422 { "error": "missing_columns", "details": { "columns": ["latency_unit"] } }`

### 6.3 `PUT /v1/uploads/:uploadId/chunks/:index`
Headers: `Content-Type: text/csv`, `X-Line-Offset: <int ≥ 2>`. Body ≤ 1 MB (else `413 chunk_too_large`).

Processing (all inside one Worker invocation):
1. Load upload row; `404 upload_not_found` if missing; `409 upload_complete` if already complete; `422 chunk_index_out_of_range` if index ≥ `chunk_count`.
2. Parse header + rows; for each row run `clean()` (§7).
3. Merge duplicates **within the chunk** using `merge()` (§7.4).
4. In **one** Neon HTTP transaction:
   - bulk upsert `services`
   - bulk upsert `checks` with `ON CONFLICT … DO UPDATE` implementing the same merge rule, `RETURNING (xmax = 0) AS inserted` to count cross-chunk merges
   - delete then insert this chunk's `rejected_rows` (keeps retries idempotent)
   - upsert the `upload_chunks` row with counts
5. Respond:
```json
{
  "chunkIndex": 3,
  "rowsIn": 2000,
  "stored": 1994,
  "mergedInChunk": 3,
  "mergedAcrossChunks": 2,
  "rejected": 1,
  "issues": { "ts_epoch_converted": 31, "latency_unit_seconds": 402, "latency_missing": 24 }
}
```
`stored` = rows that created a new check. Invariant per chunk: `rowsIn = stored + mergedInChunk + mergedAcrossChunks + rejected`.

DB errors → `500 { "error": "db_unavailable", "retryable": true }`.

### 6.4 `POST /v1/uploads/:uploadId/complete`
- If any chunk index is missing → `409 missing_chunks` with `details.missing: number[]`.
- Otherwise compute from the database (not by summing chunk reports, so retries can't skew it):
  - `storedChecks` = `count(*)` from `checks` for the upload
  - `rejected` = `count(*)` from `rejected_rows`
  - `merged` = `totalRows − storedChecks − rejected`
  - `issues` = sum of `upload_chunks.issue_counts` per key
  - `rangeStart` = min `checked_at` floored to UTC midnight; `rangeEnd` = max `checked_at` floored to UTC midnight + 1 day (exclusive)
  - `services` = distinct service ids
- Update the upload row: `status='complete'`, `completed_at`, range, `summary` (jsonb of the above).
- `200` with the summary.

### 6.5 Limits and abuse
No auth (out of scope). Mitigations: origin allow-list, 10 MB file cap, 1 MB chunk cap, 200,000 row cap, parameterised SQL only. Document in README that the Worker URL is public.

---

## 7. Cleaning pipeline (`packages/core`)

`clean(row, lineNumber) → { kind: 'check', check } | { kind: 'reject', reason }`

Fields are trimmed first. Rules run in this order; the first failing hard rule rejects the row.

### 7.1 Hard rules (reject the row)

| Order | Rule | Reason code |
|---|---|---|
| 1 | Row has fewer fields than the header | `malformed_row` |
| 2 | `service_id`, `timestamp`, `status_code` or `agent` is empty | `missing_required_field` |
| 3 | `service_id` (lower-cased) doesn't match `^svc-[a-z0-9-]+$` | `invalid_service_id` |
| 4 | `timestamp` is neither ISO-8601 with zone nor epoch seconds/milliseconds | `invalid_timestamp` |
| 5 | ISO timestamp has no zone (`Z` or `±HH:MM`) | `timestamp_without_timezone` |
| 6 | Parsed time is before 2000-01-01 or more than 1 day in the future | `timestamp_out_of_bounds` |
| 7 | UTC minute is not 0/15/30/45 or seconds ≠ 0 | `off_grid_timestamp` |
| 8 | `status_code` is not an integer in 100–599 | `invalid_status_code` |

Timestamp parsing details:
- ISO regex: `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$`, then `Date.parse`. Never pass unvalidated strings to `Date.parse`.
- Epoch: `^\d{10}$` → seconds; `^\d{13}$` → milliseconds.
- Everything is stored as UTC `timestamptz`.
- Off-grid timestamps are rejected rather than snapped: snapping would invent a result for a slot the agent never reported, and this data decides payouts.

### 7.2 Soft rules (keep the row, record a flag)

| Condition | Action | Flag |
|---|---|---|
| Timestamp was epoch | Convert to UTC | `ts_epoch_converted` |
| Timestamp had a non-`Z` offset (e.g. `+05:30`) | Convert to UTC | `ts_offset_converted` |
| `latency_unit` is `s` (case-insensitive) | `latency_ms = round(latency × 1000)` | `latency_unit_seconds` |
| `latency` empty | `latency_ms = null` | `latency_missing` |
| `latency` not a finite number | `latency_ms = null` | `latency_unparseable` |
| `latency` negative | `latency_ms = null` | `latency_negative_dropped` |
| `latency_unit` not `ms`/`s` | `latency_ms = null` | `latency_unit_unknown` |
| `region` empty | store `null` | `region_missing` |
| Same `service_id` seen with a different `service_name` | keep the first name | `service_name_conflict` |

A null latency never affects availability; it only drops out of latency statistics.

### 7.3 Stored check shape
```ts
type CleanCheck = {
  serviceId: string;        // "svc-auth"
  serviceName: string;      // "auth-api"
  checkedAt: Date;          // UTC, on a 15-minute grid
  agent: string;
  region: string | null;
  statusCode: number;
  latencyMs: number | null;
  tsFormat: 'iso_utc' | 'iso_offset' | 'epoch_s' | 'epoch_ms';
  rawTimestamp: string;     // exactly as received, for the logs view
  sourceLine: number;       // file line number
  flags: string[];
};
```

### 7.4 Duplicate merge rule
Duplicate key: **(upload, service_id, checked_at, agent)** — evaluated *after* timestamp normalisation, which is what exposes the same check written as ISO in one row and epoch or `+05:30` in another.

When two rows share a key, the surviving check is:
- `statusCode`: if exactly one is a failure (not 2xx/3xx), keep the failure; if both are failures or both healthy but different, keep the first seen. Add `status_conflict_same_agent` when the codes differ.
- `latencyMs`: first non-null value.
- `sourceLine`: the earliest line.
- `flags`: union of both, plus `merged_duplicate`.

Failures win because the cost of wrongly hiding an outage (a customer denied a credit) is higher than the cost of wrongly showing one, and the event is logged either way.

Different agents reporting the same slot are **not** duplicates; they're stored separately and combined at read time (§8).

### 7.5 What the provided data contains (drives the rules above)

Measured on all five fixtures:

| Problem | Where / how often | Handling |
|---|---|---|
| Three timestamp formats: ISO `Z`, ISO `+05:30` (IST), epoch seconds | ~1.5% epoch, ~0.7% `+05:30`, every file | Convert to UTC. Ignoring the offset puts 32–109 checks per file in the wrong slot |
| Same check repeated in a different timestamp format (same agent, same values) | a few per file | Visible only after normalisation; merged |
| Exact duplicate rows | 6–24 per file | Merged |
| Duplicate where one copy has latency and the other is blank | 14d file | Merged; non-null latency kept |
| Second agent (`agent-2`) reporting ~7% of slots, always alongside `agent-1` | every file | Stored separately; combined per slot at read time. Counting rows would double-count failures |
| `search-api` latency in seconds, others in ms | every file | Converted to ms |
| Blank latency (mostly on 200s) | ~1.2% of rows | Kept for availability, null latency |
| One negative latency per file (on a 200) | every file | Kept, latency nulled |
| One status `999` per file | every file; in the 14d file it contradicts agent-2's `200` for the same slot | Rejected (`invalid_status_code`) |
| Rows not in time order | every file | Irrelevant after keyed storage |
| Files span two calendar months (14d: May→Jun, 30d: Apr→May) | 2 files | Availability reported per calendar month |
| Scattered single-check failures | ~90% of failure runs are one check long; reports-api fails 2–3% of checks at random | Counted in billing availability; excluded from incidents unless clustered (§9) |
| Latency 3–4× normal during real incidents | every logged incident | Used to confirm incidents |

After cleaning, every file has a check for every 15-minute slot of every service, except slots whose only report was the rejected `999` row (§12).

---

## 8. Health and SLA model (`packages/core/sla.ts` + SQL)

### 8.1 Check health
- **Up:** status 200–399
- **Down:** anything else stored (4xx and 5xx). A health endpoint returning 4xx means the service isn't serving its check correctly, so it counts against availability.
- **Slow** (display only, never affects availability): `latency_ms > 2 × service baseline`, where baseline = median latency of that service over the whole dataset.

### 8.2 Slot health
One slot = one service × one 15-minute UTC window.
- **Down** if any stored check in the slot is down ("worst agent wins", same reasoning as §7.4).
- **Up** if it has at least one check and none are down.
- **Unknown** if it has no stored check (missing data, or only a rejected row).

Agents never disagreed in the fixtures except in the rejected `999` case, so this rule changes no numbers today; it's stated so the behaviour is defined for other data.

### 8.3 Periods
- `all` — the dataset range `[rangeStart, rangeEnd)`.
- One entry per UTC calendar month touched by the data, clipped to the dataset range. Each carries `measuredDays` and `monthDays`.
- Billing verdicts are only shown for month periods. For `all`, the ledger shows availability but the verdict column reads "Pick a month".

### 8.4 Metrics per service per period

| Metric | Formula |
|---|---|
| `expectedSlots` | `(periodEnd − periodStart) / 15 min` |
| `knownSlots` | slots with at least one stored check |
| `downSlots` | slots that are down |
| `coveragePct` | `knownSlots / expectedSlots × 100` |
| `availabilityPct` | `(knownSlots − downSlots) / knownSlots × 100`, rounded to 3 decimals for display, full precision for comparison |
| `downtimeMinutes` | `downSlots × 15` |
| `errorBudgetMinutes` | `0.001 × knownSlots × 15` |
| `budgetUsedPct` | `downtimeMinutes / errorBudgetMinutes × 100` (can exceed 100) |
| `meetsSla` | `availabilityPct ≥ 99.9` |
| `creditEligible` | month period **and** `!meetsSla` |
| `p50LatencyMs`, `p95LatencyMs` | `percentile_cont` over non-null latencies of stored checks in the period |
| `incidentCount` | confirmed incidents (§9) starting in the period |

Unknown slots are excluded from availability and reported through coverage instead: treating missing data as "up" would hide outages, and treating it as "down" would pay credits for monitoring gaps. The UI shows a coverage warning below 99%.

Context worth showing in the README: at 15-minute granularity a full 30-day month has 2,880 slots, so 99.9% allows only 2.88 down slots. **Three failed checks in a month breach the SLA.** With the scattered failures in this data, every service breaches in every file under the strict rule. That's the correct billing result for the data as given, and it's why incidents are shown separately.

---

## 9. Incident detection (`packages/core/incidents.ts`)

Input: ordered slot states for one service, per-slot median latency, service baseline latency.

1. **Cluster** down slots: walk down slots in time order; start a new cluster when the gap to the previous down slot is more than 3 slots (i.e. more than 2 healthy or unknown slots between failures).
2. **Keep** clusters with **≥ 3 down slots**.
3. **Confirm** a cluster when the median latency of all checks in `[start, end + 15 min)` is **≥ 2× the service baseline**.
4. Output:
```ts
type Incident = {
  serviceId: string;
  start: Date;            // first down slot
  end: Date;              // last down slot + 15 min
  durationMinutes: number;
  downSlots: number;
  healthySlotsInside: number; // flapping indicator
  latencyRatio: number;   // window median / baseline, 2 decimals
  confirmed: boolean;
};
```
Confirmed incidents appear in the incidents list and ribbon. Unconfirmed clusters appear only in the ribbon, in the "unconfirmed" style.

**Validation against `dataset_incident_log.json`:** this rule detects all 8 logged incidents with no false confirmations; 3 small failure clusters are found but correctly left unconfirmed (latency ratio ≈ 1.0–1.1). Tested alternatives: ≥ 2 failures with any gap gives 12–15 false positives; ≥ 4 failures misses the 3-slot `svc-search` incident on 2025-04-18. The log uses 0-based day numbers and approximate times, and its windows include healthy flapping checks at the edges, so matching is by overlap, not exact boundaries.

---

## 10. Database schema (`db/migrations/001_init.sql`)

```sql
create extension if not exists pgcrypto;

create table uploads (
  id            uuid primary key default gen_random_uuid(),
  filename      text not null,
  size_bytes    integer not null,
  sha256        char(64) not null,
  total_rows    integer not null,
  chunk_count   integer not null,
  status        text not null default 'processing'
                check (status in ('processing','complete')),
  range_start   timestamptz,
  range_end     timestamptz,
  summary       jsonb,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);
create index uploads_sha_complete on uploads (sha256) where status = 'complete';

create table upload_chunks (
  upload_id            uuid not null references uploads(id) on delete cascade,
  chunk_index          integer not null,
  rows_in              integer not null,
  stored               integer not null,
  merged_in_chunk      integer not null,
  merged_across_chunks integer not null,
  rejected             integer not null,
  issue_counts         jsonb not null default '{}',
  processed_at         timestamptz not null default now(),
  primary key (upload_id, chunk_index)
);

create table services (
  id   text primary key,
  name text not null
);

create table checks (
  upload_id     uuid not null references uploads(id) on delete cascade,
  service_id    text not null references services(id),
  checked_at    timestamptz not null,
  agent         text not null,
  region        text,
  status_code   smallint not null,
  latency_ms    integer,
  ts_format     text not null,
  raw_timestamp text not null,
  source_line   integer not null,
  flags         text[] not null default '{}',
  primary key (upload_id, service_id, checked_at, agent)
);
create index checks_upload_time on checks (upload_id, checked_at);

create table rejected_rows (
  id          bigserial primary key,
  upload_id   uuid not null references uploads(id) on delete cascade,
  chunk_index integer not null,
  line_number integer not null,
  reason      text not null,
  raw_line    text not null
);
create index rejected_upload on rejected_rows (upload_id, line_number);

create view slot_status as
select upload_id,
       service_id,
       checked_at as slot,
       bool_or(status_code not between 200 and 399) as is_down,
       count(*)                                      as agent_reports,
       percentile_cont(0.5) within group (order by latency_ms)
         filter (where latency_ms is not null)       as median_latency_ms
from checks
group by upload_id, service_id, checked_at;
```

### 10.1 Bulk upsert (Worker)
One statement per chunk using `unnest` over typed arrays (one HTTP round-trip, well within the 50-subrequest limit):

```sql
insert into checks (upload_id, service_id, checked_at, agent, region, status_code,
                    latency_ms, ts_format, raw_timestamp, source_line, flags)
select $1::uuid, s, t, a, r, sc, l, f, rt, sl, string_to_array(fl, '|')
from unnest($2::text[], $3::timestamptz[], $4::text[], $5::text[], $6::smallint[],
            $7::int[], $8::text[], $9::text[], $10::int[], $11::text[])
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
                  then array['status_conflict_same_agent'] else '{}'::text[] end) as x)
returning (xmax = 0) as inserted;
```

A **retry of the same chunk** must not add `merged_duplicate` to rows it originally inserted. Handle this by skipping the update when `excluded.source_line = checks.source_line` (add `where checks.source_line <> excluded.source_line` to the `do update`), and count those rows as neither stored nor merged; the `complete` step computes final totals from the table anyway.

Wrap the service upsert, checks upsert, rejected-rows delete/insert and chunk upsert in `sql.transaction([...])`.

---

## 11. Read API (Next.js route handlers)

All handlers: `runtime = 'nodejs'`, zod-validated params, parameterised SQL in `lib/queries.ts`, `Cache-Control: no-store`.

### 11.1 `GET /api/datasets`
Completed uploads, newest first:
```json
[{ "id": "uuid", "filename": "…", "rangeStart": "iso", "rangeEnd": "iso",
   "completedAt": "iso", "totals": { "rows": 15577, "stored": 15551, "merged": 25, "rejected": 1 } }]
```

### 11.2 `GET /api/datasets/:id/overview?period=all|YYYY-MM`
One call powers the whole stats section:
```json
{
  "dataset": { "id": "…", "filename": "…", "rangeStart": "…", "rangeEnd": "…" },
  "periods": [{ "key": "all", "label": "Whole file", "from": "…", "to": "…" },
              { "key": "2025-04", "label": "April 2025", "from": "…", "to": "…",
                "measuredDays": 25, "monthDays": 30 }],
  "period": { "key": "2025-04", "…": "…" },
  "ledger": [{ "serviceId": "svc-auth", "serviceName": "auth-api",
               "availabilityPct": 98.833, "knownSlots": 2399, "expectedSlots": 2400,
               "coveragePct": 99.958, "downSlots": 28, "downtimeMinutes": 420,
               "errorBudgetMinutes": 35.985, "budgetUsedPct": 1167.1,
               "meetsSla": false, "creditEligible": true,
               "p50LatencyMs": 143, "p95LatencyMs": 181, "incidentCount": 1 }],
  "headline": { "servicesBelowTarget": 5, "servicesTotal": 5, "confirmedIncidents": 2,
                "worstService": "svc-reports" },
  "ribbon": { "start": "…", "slotMinutes": 15,
              "services": [{ "serviceId": "svc-auth", "states": "uuud.u…",
                             "latencyRatio": [1.0, 0.9, …] }] },
  "incidents": [ /* Incident[] incl. unconfirmed, sorted by start */ ],
  "quality": { "rows": 15577, "stored": 15551, "merged": 25, "rejected": 1,
               "rejectedByReason": { "invalid_status_code": 1 },
               "issues": { "ts_epoch_converted": 233, "ts_offset_converted": 109,
                           "latency_unit_seconds": 3131, "latency_missing": 186,
                           "latency_negative_dropped": 1 },
               "coveragePct": 99.993 }
}
```
- Ledger values above are the real April 2025 figures for `svc-auth` in the 30d fixture, except the two latency numbers, which are illustrative.
- The `checks` upsert requires unique keys inside one statement; the in-chunk merge (§7.4) guarantees that.
- `states`: one character per slot in the period — `u` up, `d` down, `.` unknown.
- `latencyRatio`: slot median latency ÷ service baseline, 1 decimal, `null` when unknown.
- Incidents are computed on the server by `packages/core/incidents.ts` from the ribbon data and baselines, always over the whole dataset, then filtered to those overlapping the period.

### 11.3 `GET /api/datasets/:id/logs`
Query params:

| Param | Rule |
|---|---|
| `date` | `YYYY-MM-DD` (UTC day). Mutually exclusive with `from`/`to` |
| `from`, `to` | `YYYY-MM-DD`, inclusive, `from ≤ to` |
| `services` | comma-separated service ids, optional |
| `outcome` | `all` (default) · `failures` · `slow` · `flagged` · `rejected` |
| `agent` | optional exact match |
| `cursor` | opaque base64 of `(checked_at, service_id, agent)`. Mutually exclusive with `offset` |
| `offset` | rows to skip, for jumping to a page number. Mutually exclusive with `cursor` |
| `limit` | default 100, max 200. The UI offers 10/20/50/100 |

Dates outside the dataset range → `422 date_out_of_range` with the valid range in `details`. Neither `date` nor `from/to` → the whole dataset.

Response:
```json
{
  "rows": [{ "checkedAt": "iso", "serviceId": "svc-search", "serviceName": "search-api",
             "agent": "agent-1", "region": "ap-south-1", "statusCode": 502,
             "outcome": "down", "latencyMs": 1975, "slow": true,
             "flags": ["latency_unit_seconds"], "rawTimestamp": "2025-04-14T15:45:00Z",
             "sourceLine": 3812 }],
  "nextCursor": "…",
  "total": 42
}
```
For `outcome=rejected` rows are `{ lineNumber, reason, rawLine }` and the date filter is ignored (a rejected row may not have a valid date); the UI says so.

Ordering: `checked_at asc, service_id asc, agent asc`. Keyset pagination with `(checked_at, service_id, agent) > ($cursor)`.

---

## 12. Golden values (acceptance tests)

`packages/core/test/golden.test.ts` runs the full pipeline in memory on each fixture (chunk size 2,000) and must reproduce these exactly.

### 12.1 Cleaning totals

| File | Rows | Epoch | +05:30 | Seconds unit | Blank latency | Negative latency | Rejected | Stored checks | Merged | Known slots | Expected slots |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 9d_seed101 | 4672 | 70 | 32 | 935 | 56 | 1 | 1 | 4664 | 7 | 4319 | 4320 |
| 12d_seed505 | 6230 | 93 | 43 | 1242 | 74 | 1 | 1 | 6219 | 10 | 5759 | 5760 |
| 14d_seed202 | 7269 | 109 | 50 | 1452 | 87 | 1 | 1 | 7256 | 12 | 6720 | 6720 |
| 21d_seed303 | 10904 | 163 | 76 | 2184 | 130 | 1 | 1 | 10885 | 18 | 10079 | 10080 |
| 30d_seed404 | 15577 | 233 | 109 | 3131 | 186 | 1 | 1 | 15551 | 25 | 14399 | 14400 |

(Blank-latency counts are raw rows before merging; one 14d blank sits on a duplicate whose twin has a value.)

### 12.2 Availability, whole file (known slots / down slots / %)

| File | auth | notify | payments | reports | search |
|---|---|---|---|---|---|
| 9d | 864 / 4 / 99.537 | 864 / 3 / 99.653 | 863 / 4 / 99.537 | 864 / 21 / 97.569 | 864 / 9 / 98.958 |
| 12d | 1151 / 6 / 99.479 | 1152 / 3 / 99.740 | 1152 / 13 / 98.872 | 1152 / 27 / 97.656 | 1152 / 28 / 97.569 |
| 14d | 1344 / 5 / 99.628 | 1344 / 32 / 97.619 | 1344 / 14 / 98.958 | 1344 / 47 / 96.503 | 1344 / 7 / 99.479 |
| 21d | 2016 / 4 / 99.802 | 2016 / 3 / 99.851 | 2016 / 46 / 97.718 | 2016 / 54 / 97.321 | 2015 / 17 / 99.156 |
| 30d | 2879 / 29 / 98.993 | 2880 / 8 / 99.722 | 2880 / 34 / 98.819 | 2880 / 82 / 97.153 | 2880 / 29 / 98.993 |

### 12.3 Month split (known / down)

| File | Month | auth | notify | payments | reports | search |
|---|---|---|---|---|---|---|
| 14d | 2025-05 | 1248 / 4 | 1248 / 31 | 1248 / 13 | 1248 / 41 | 1248 / 6 |
| 14d | 2025-06 | 96 / 1 | 96 / 1 | 96 / 1 | 96 / 6 | 96 / 1 |
| 30d | 2025-04 | 2399 / 28 | 2400 / 7 | 2400 / 29 | 2400 / 70 | 2400 / 24 |
| 30d | 2025-05 | 480 / 1 | 480 / 1 | 480 / 5 | 480 / 12 | 480 / 5 |

### 12.4 Incidents (UTC, 2025)

| File | Service | Start | Last down slot | Down slots | Confirmed |
|---|---|---|---|---|---|
| 9d | svc-reports | 05-13 16:00 | 18:00 | 6 | yes |
| 9d | svc-search | 05-16 10:15 | 10:45 | 3 | no |
| 12d | svc-reports | 04-12 08:30 | 09:45 | 3 | no |
| 12d | svc-search | 04-14 12:00 | 16:45 | 16 | yes |
| 12d | svc-search | 04-18 12:30 | 13:30 | 3 | yes |
| 14d | svc-notify | 05-19 14:45 | 19:00 | 16 | yes |
| 14d | svc-notify | 05-25 07:30 | 09:45 | 8 | yes |
| 21d | svc-payments | 04-05 09:30 | 14:30 | 16 | yes |
| 21d | svc-reports | 04-05 16:00 | 17:30 | 3 | no |
| 30d | svc-auth | 04-22 04:00 | 10:00 | 18 | yes |
| 30d | svc-reports | 04-09 11:45 | 13:45 | 7 | yes |

### 12.5 Other required tests
- Chunking invariance: chunk sizes 1,000 / 2,000 / 5,000 / whole file give identical stored checks.
- Idempotency: processing the same chunk twice changes nothing.
- Each hard rule and soft rule in §7 has at least one unit test.
- `+05:30` handling: `2025-04-12T14:15:00+05:30` → `2025-04-12T08:45:00Z`.
- Merge: failure beats success; non-null latency beats null.
- CSV splitter keeps quoted newlines inside one row.
- `scripts/smoke.ts` uploads the 9d fixture to the deployed Worker and asserts the §12.1 row for it via `/api/datasets/:id/overview`.

---

## 13. Dashboard behaviour (visual rules in DESIGN.md)

### 13.1 Top bar
Dataset switcher (completed uploads), period switcher (from `periods`), time zone toggle (UTC / IST — **display only**; filters and all calculations are UTC), link to `/upload`.

### 13.2 Findings section (collapsible)
- Default open. Collapsed state persists in the URL (`stats=closed`).
- When collapsed, a one-line summary stays visible: "5 of 5 services below 99.9% in April 2025. 2 incidents."
- Contents, in order:
  1. **Service ledger** — one row per service with every §8.4 metric; sortable by availability (default ascending, worst first).
  2. **Fault ribbon** — per-service slot strip for the period (§11.2). Hover shows slot time, state, agents, latency ratio. Click selects that UTC day + service in the logs filter.
  3. **Incidents** — confirmed incidents with service, start, end, duration, down slots, flapping count, latency ratio. Selecting one sets the logs filter to its day(s) and service with `outcome=all`.
  4. **Data receipt** — rows in, stored, merged, rejected by reason, conversions, coverage. Each count links to the logs view with the matching `outcome` filter.

### 13.3 Logs section
- Filter bar: date mode (One day / Date range), date input(s) limited to the dataset range, services multi-select, outcome, agent.
- Changing any filter resets the cursor.
- Changing the dataset or the period clears the logs filters. A service or agent may not exist in the other file at all, and a chosen day is almost certainly outside its range, so carrying them over would silently show an empty table. The timezone toggle is a display preference, not a filter, and survives. Both writes land in one URL update.
- Table columns: time, service, agent, status, latency, flags. Row expands to show raw timestamp, source line, region and a plain explanation of each flag.
- Paging: 10/20/50/100 rows a page (default 20), with the row range, total count, Previous/Next and numbered page buttons. Only the current page is in the DOM.
- Stepping uses the keyset cursor: it points forward only, so the client keeps the cursor that produced each page it has visited and re-uses it to go back. Changing any filter or the page size discards that trail.
- Jumping to a page number uses `offset`, because no cursor exists for a page nobody has visited. `cursor` and `offset` together are rejected with 422. Offset is safe here — a completed upload is immutable, so rows cannot shift between requests, and the row count is bounded by the 200,000-row upload limit.
- Empty result: explain which filter excluded everything and offer "Clear filters".

### 13.4 Loading and errors
- Neon may need a moment to resume after idling: show skeletons, never a blank screen.
- Read API failures: inline message naming what failed ("Couldn't load logs for 14 Apr 2025") with a Retry action.

---

## 14. Configuration and deployment

### 14.1 Environment

| Where | Name | Value |
|---|---|---|
| Worker (secret) | `DATABASE_URL` | Neon connection string |
| Worker (var) | `ALLOWED_ORIGINS` | `https://<vercel-app>.vercel.app,http://localhost:3000` |
| Vercel (server) | `DATABASE_URL` | Neon connection string |
| Vercel (public) | `NEXT_PUBLIC_PROCESSOR_URL` | `https://faultline-processor.<subdomain>.workers.dev` |

### 14.2 Steps
1. **Neon:** create a project (closest Asia region offered), copy the connection string, run `pnpm db:migrate`.
2. **Worker:** `pnpm --filter processor exec wrangler login`, `wrangler secret put DATABASE_URL`, set `ALLOWED_ORIGINS` in `wrangler.jsonc`, `wrangler deploy`. Check `GET /v1/health`.
3. **Vercel:** import the repo, root directory `apps/web`, set env vars, deploy. Add the Vercel URL to `ALLOWED_ORIGINS` and redeploy the Worker.
4. Upload all five fixtures through the live UI. Run `pnpm smoke`.
5. Record Worker CPU time per chunk from Cloudflare metrics and the "last verified live" date in the README.

### 14.3 Free-tier notes for the README
- Workers Free: 100,000 requests/day, 10 ms CPU per request. A 30-day file is 8 chunk requests + 2.
- Neon free compute suspends when idle and resumes on the next query; the first dashboard load after a quiet period is slower.
- Nothing requires a card.

---

## 15. README outline (write the prose yourself)

1. **What it is** — two sentences.
2. **Live URLs** — dashboard, upload page, Worker health URL. "Last verified live: <date>."
3. **Architecture** — diagram from §3, table of what runs where and why, the CPU-limit measurement and the chunking decision.
4. **Data findings** — table from §7.5 in your own words, with counts.
5. **Assumptions** — health definition (§8.1), worst-agent rule, unknown slots excluded, monthly UTC billing, failures win on merge, off-grid rejected not snapped, `999` rejected, incident rule and its validation, stats chosen and why (on-call vs billing).
6. **The strict-SLA observation** — three failed checks breach a month; every service breaches in every file; why incidents are shown separately.
7. **Run locally / redeploy** — commands from §14.
8. **Tests** — how to run; golden table.
9. **With more time** — direct-to-storage uploads (R2) with an event-triggered Worker; Durable Object or queue to coordinate chunks; credit tier calculation; per-agent disagreement view; dataset deletion with audit log; Python port of `packages/core` to match EarthRe's backend stack; property-based tests on the cleaner.

---

## 16. Build plan (6–8 hours)

| Phase | Time | Output |
|---|---|---|
| 0. Scaffold + deploy "hello" Worker, Neon, Vercel | 45 min | All three URLs live |
| 1. `packages/core` cleaning, merge, tests | 90 min | Golden §12.1 passing |
| 2. SLA + incidents in core, tests | 60 min | Golden §12.2–12.4 passing |
| 3. Worker endpoints + DB migration + upsert | 75 min | Fixture uploads via curl/script |
| 4. Upload screen | 45 min | Live upload works end to end |
| 5. Overview API + findings section | 75 min | Ledger, ribbon, incidents, receipt |
| 6. Logs API + logs section | 60 min | Filters, pagination, rejected view |
| 7. Polish, smoke test, README | 45 min | Submission ready |

Commit at the end of every task, with messages that say what changed and why.

---

## 17. Decisions log

| # | Decision | Alternatives considered |
|---|---|---|
| D1 | Cloudflare Worker, chunked uploads | AWS Lambda (rejected: account and card risk); Vercel function (kept as fallback) |
| D2 | Each upload is its own dataset | One merged store (rejected: fixtures overlap in time with different values) |
| D3 | Unknown slots excluded from availability, shown as coverage | Count as up / count as down |
| D4 | Worst agent wins per slot | Majority vote (ties with two agents) |
| D5 | Failure wins when merging same-agent duplicates | Keep first / keep latest |
| D6 | Strict per-check billing availability + separate incident detection | Only count consecutive failures (hides flapping incidents) |
| D7 | Incident = ≥3 failures, ≤2 healthy gap, latency ≥2× baseline | Validated against the incident log (§9) |
| D8 | UTC for all calculations, IST display toggle | Local-time billing (ambiguous) |
