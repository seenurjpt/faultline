# Faultline

Faultline reads raw monitoring CSVs, cleans them in a deployed serverless
function, and answers one question quickly: which services missed 99.9% this
month, and when did they break. Every number on screen can be traced back to a
line in the file.

---

## Live URLs

| What | URL |
|---|---|
| Dashboard | <https://faultline-orcin.vercel.app/> |
| Upload | Modal on the dashboard — "Upload file" in the top bar |
| Processor health | <https://faultline-processor.sla-monitoring.workers.dev/v1/health> |

**Last verified live:** 2026-09-16 — dashboard returned 200 and rendered
computed results; processor health returned `{"ok":true,"db":true}`, which also
confirms the Worker's database connection.

Everything runs on free tiers, so Neon's compute suspends when idle and resumes
on the next query — the first dashboard load after a quiet period is slower.
To redeploy on demand, see [Running it](#running-it) and `DEPLOYMENT.md`.

---

## Architecture

```
 ┌──────────────────────────┐        PUT chunk (text/csv)       ┌─────────────────────────────┐
 │  Next.js app (Vercel)    │ ────────────────────────────────▶ │ Cloudflare Worker           │
 │  upload modal            │ ◀──────── chunk report (JSON) ─── │ "processor"                 │
 │  /        – dashboard    │                                   │ parse → validate → clean    │
 │  /api/*   – read API     │                                   │ → bulk upsert (1 txn/chunk) │
 └────────────┬─────────────┘                                   └──────────────┬──────────────┘
              │ SQL over HTTPS                                                 │ SQL over HTTPS
              ▼                                                                ▼
        ┌──────────────────────────────────────────────────────────────────────────────┐
        │  Neon Postgres (free tier)                                                   │
        │  uploads · upload_chunks · services · checks · rejected_rows · slot_status   │
        └──────────────────────────────────────────────────────────────────────────────┘
```

| Piece | Runs on | Why |
|---|---|---|
| Upload UI + dashboard | Next.js App Router on Vercel | Server components render the dashboard straight from URL state, so a copied link reproduces a view exactly |
| Processor | Cloudflare Worker | A real, deployed, stateless function. The free plan allows 10 ms CPU per request, which is what drives chunking |
| Database | Neon Postgres | Unique constraints make re-processing idempotent; the HTTP driver works from both Workers and Vercel |
| Shared rules | `core/` | Pure TypeScript, zero runtime dependencies, no I/O. Cleaning, merging, SLA and incident rules are written and tested once, then imported by both sides |

**Why the browser splits the file.** The Worker has a 10 ms CPU budget and a
1 MB body cap per request. A 10 MB file exceeds both, so the browser reads the
file, splits it on quote-aware line boundaries, and sends batches of 2,000 rows
sequentially. Each batch is independently idempotent, so a retry can never
double-count.

**Why the Worker never reads data back.** The brief asks the function to parse,
validate and clean. Keeping reads in Next.js keeps the Worker single-purpose
and well inside its CPU budget.

**Worker CPU time per chunk.** The 2,000-row batch size was chosen from a
measured basis rather than guessed: a plain parse-and-clean pass over the
30-day fixture (15,577 rows) takes roughly 30 ms of CPU locally, which puts a
2,000-row batch at about 4 ms — inside the 10 ms budget with room for the
database round trip. In practice each batch also stays well under the 1 MB body
cap: chunk 0 of the 12-day file is 144.5 KB. Batches are observed end-to-end at
around 2.5 s wall-clock, but that is dominated by network and Neon, not CPU.

> The authoritative per-request CPU figure is in Cloudflare → Workers →
> `faultline-processor` → Metrics. `observability` is enabled on the Worker, so
> it is recorded there; it is not exposed through `wrangler`, so read it from
> the dashboard if you want the exact number rather than this estimate.

---

## Running it

```bash
npm install
npm test           # core unit tests + golden tests (see fixtures/README.md)
npm run typecheck  # app and worker
npm run lint
npm run dev        # http://localhost:3000
```

Deploying, redeploying and the environment variables are in
[DEPLOYMENT.md](DEPLOYMENT.md).

| Script | What it does |
|---|---|
| `npm test` | Vitest over `core/` |
| `npm run db:migrate` | Applies `db/migrations` in order (needs `DATABASE_URL`) |
| `npm run verify` | Runs the pipeline over `fixtures/` and prints the SPEC §12 tables |
| `npm run smoke` | Uploads a fixture to the deployed Worker and checks it through the read API |
| `npm run worker:deploy` | Deploys the Cloudflare Worker |
| `npm run worker:tail` | Live Worker logs |

---

## How the data is handled

The cleaning rules live in `core/src/clean.ts` and are documented in SPEC §7.
In short:

- **Hard rules reject a row** and record it, with a reason, in `rejected_rows`.
  Nothing is silently dropped; the rejected row is visible in the UI with its
  line number and raw text.
- **Soft rules keep the row** and record a flag, so a converted timestamp or a
  dropped latency is always visible on the check it belongs to.
- **Duplicates merge** on `(upload, service_id, checked_at, agent)` *after*
  timestamp normalisation, which is what exposes the same check written once as
  ISO and once as epoch. When two rows disagree, the failure wins.
- **Availability excludes unknown slots** and reports them as coverage instead.

---

## Data findings

Nothing here was given to me as a list — these are the problems I hit while
trying to get a believable availability number out of the files, and what I
decided to do about each. The counts come from `npm run verify`, which runs
the real pipeline over all five fixtures and prints these tables.

| File | Rows | Epoch ts | +05:30 ts | Seconds latency | Blank latency | Negative | Rejected | Stored | Merged |
|---|---|---|---|---|---|---|---|---|---|
| `monitoring_checks_9d_seed101.csv` | 4,672 | 70 | 32 | 935 | 56 | 1 | 1 | 4,664 | 7 |
| `monitoring_checks_12d_seed505.csv` | 6,230 | 93 | 43 | 1,241 | 74 | 1 | 1 | 6,219 | 10 |
| `monitoring_checks_14d_seed202.csv` | 7,269 | 109 | 50 | 1,451 | 87 | 1 | 1 | 7,256 | 12 |
| `monitoring_checks_21d_seed303.csv` | 10,904 | 163 | 76 | 2,182 | 130 | 1 | 1 | 10,885 | 18 |
| `monitoring_checks_30d_seed404.csv` | 15,577 | 233 | 109 | 3,131 | 186 | 1 | 1 | 15,551 | 25 |

**1. Three different timestamp formats in one column.** Most rows are ISO-8601
UTC, but roughly 1.5% are Unix epoch seconds and another 0.7% carry a `+05:30`
offset. All three are converted to UTC instants and flagged
(`ts_epoch_converted`, `ts_offset_converted`) rather than silently normalised,
so the receipt can show how many rows were touched. A timestamp with **no**
timezone at all is rejected rather than assumed to be UTC — guessing the zone
on billing data is how you quietly shift an outage into the wrong month.

**2. Latency is reported in two units.** About 20% of rows have
`latency_unit = s` rather than `ms`. These are multiplied by 1,000. The unit is
read from its own column, not inferred from the magnitude, because a genuinely
slow 3,000 ms response and a 3 s response are indistinguishable by value alone.
One subtlety that cost me a while: the unit flag describes the *column*, not
the conversion, so a row reporting seconds with a **blank** latency still
counts as a seconds row. Returning early on the blank value undercounted the
seconds total in every file.

**3. Missing and negative latencies.** ~1.2% of rows have a blank or
unparseable latency; exactly one row per file has a negative value. Neither is
a reason to throw away the check: the **status code is what decides
availability**, and latency only feeds the percentiles. So the row is kept, the
latency is stored as `NULL`, and it is excluded from p50/p95 rather than being
counted as zero. Treating a missing latency as 0 ms would have quietly improved
every percentile.

**4. One row per file with an impossible status code.** `999` is not a valid
HTTP status, so it cannot be classified as up or down. It is **rejected**, not
coerced — and every rejected row is stored in `rejected_rows` with its line
number and the raw text, so the receipt can show exactly which lines did not
make it and why. Silently dropping it would have made the row counts not add up.

**5. Duplicate checks from the same agent.** 7–25 rows per file share a
`(service, timestamp, agent)` key. These are merged, and **failures win**: if
one copy says 200 and the other says 503, the merged row is 503. The reasoning
is asymmetric cost — wrongly hiding an outage denies a customer a credit they
are owed, while wrongly showing one is visible and can be argued. The same rule
is implemented twice, once in memory for duplicates inside a chunk and once as
`ON CONFLICT … DO UPDATE` for duplicates that land in different chunks, so the
result does not depend on where the chunk boundary happened to fall.

**6. Multiple agents report the same slot, and they disagree.** Each service is
checked every 15 minutes, but by several agents from different regions. A slot
is counted as **down if any agent saw it down** (`bool_or` in the `slot_status`
view) — a real outage seen from one region is still an outage. Latency for the
slot is the median across agents.

**7. Gaps in coverage.** No file has a complete grid. The 12-day file has 5,759
known slots against an expected 5,760; the 21-day file is missing one and the
30-day file one. Missing slots are **excluded from the availability
denominator** rather than assumed healthy, and reported separately as a
coverage percentage. Assuming "no data = up" is the single easiest way to
manufacture a passing SLA out of a monitoring outage.

**Why the same numbers come out every time.** Chunk-size invariance is asserted
in the tests: processing each file at four different chunk sizes produces
identical stored counts (§12.5 above). Combined with the idempotent upsert, that
means a retried chunk can never double-count.

---

## Assumptions

Where the brief left something open, this is what I chose and why.

**Health is defined by status code.** A check counts as up when the status is
2xx or 3xx, down otherwise. Latency does not affect availability at all — a
slow response still served the request. Latency is reported separately so a
degradation that never breaches the SLA is still visible.

**Availability is measured in slots, not rows.** The unit is one service in one
15-minute window, because that is what the monitoring grid actually samples.
Counting raw rows instead would weight a slot more heavily just because more
agents happened to report it.

**Unknown slots are excluded, not assumed healthy.** Availability is
`down / known`, and coverage is reported alongside it. See finding 7.

**Billing months are UTC calendar months.** The brief ties credits to *monthly*
availability, so the dashboard offers a per-month view as well as the whole
file. Partial months show how many days they actually cover, because a
99.95% month built from 4 days of data is not the same claim as one built from
30. All filtering and arithmetic is UTC; the IST toggle changes display only.

**Timestamps without a timezone are rejected.** See finding 1.

### The statistics I chose, and why

The brief says this is a real design decision, so: I picked for two readers,
someone on-call and someone deciding a billing credit, and dropped anything
that served neither.

- **A verdict sentence, not a number.** The top line reads "*N of 5 services
  are below 99.9%*" with the period it applies to. The first thing either
  reader needs is whether there is a problem at all.
- **Per-service availability with its down-slot count.** A percentage alone
  hides magnitude — 99.5% means something different across 9 days than across
  30. The ledger shows the percentage, the known slots and the down slots
  together so the number can be checked by hand.
- **p50 and p95 latency, not the mean.** Latency distributions here are skewed;
  a mean gets dragged by a handful of slow checks and describes nothing. p95
  is what tells an on-call engineer that something is degrading. I also flag
  services where p95 is more than twice p50, which is the shape of a partial
  degradation rather than a uniform slowdown.
- **Incidents as a separate list from availability.** This is the most
  opinionated choice and the reasoning is in the next section.
- **A data receipt.** Rows read, stored, merged, rejected, and the coverage
  percentage — with the rejected rows clickable down to the raw line. If the
  data decides who gets money back, the pipeline has to be auditable, and a
  number nobody can trace is a number nobody should act on.

**What I deliberately left out:** uptime "nines" badges, a single blended
health score across services, and anything averaging availability across
services. They compress away exactly the detail that makes a credit decision
defensible.

---

## The strict-SLA observation

At 15-minute sampling, a 99.9% target is far tighter than it sounds, and this
is the finding I would lead with in a review.

A 30-day month holds 2,880 slots per service. 99.9% of 2,880 allows **2.88**
down slots — so the **third failed check breaches the month**:

| Window | Slots/service | Down slots allowed | Breaches at |
|---|---|---|---|
| 9 days | 864 | 0.86 | 1 failed check |
| 12 days | 1,152 | 1.15 | 2 failed checks |
| 21 days | 2,016 | 2.02 | 3 failed checks |
| 30 days | 2,880 | 2.88 | 3 failed checks |

The consequence in this data: **every service breaches 99.9% in every file** —
25 of 25 service/file combinations, ranging from 96.5% to 99.85%. A dashboard
whose headline is "who is below target" would therefore say *everything, always*,
which is true and completely useless for deciding anything.

That is why **incidents are a separate section from availability**. Availability
answers the billing question ("is a credit owed?") and the honest answer here is
always yes. Incidents answer the operational one ("what actually happened, and
was it real?"), and those are rare and specific — 11 across the five files.

An incident is a run of **3 or more consecutive down slots**, tolerating gaps of
up to 3 healthy slots so one recovered probe does not split a single outage into
two. It is marked **confirmed** when median latency inside the window is at
least **2× the service's baseline** — a real outage usually shows elevated
latency around it, whereas scattered isolated failures often do not. Of the 11
detected, 8 are confirmed and 3 are not.

That rule was validated against `dataset_incident_log.json`, which lists 8
logged incidents: **all 8 were matched by overlap, and all 8 are exactly the
ones marked confirmed** — no false positives. The 3 unconfirmed clusters are
short and latency-flat, which is the signal working as intended.

The practical reading: the 99.9% target is not achievable at this sampling
granularity for any of these services, so the number to argue about is the
**gap between a breach caused by a genuine outage and one caused by scattered
noise** — which is precisely what the two sections separate.

---

## With more time

**Uploads that survive the tab closing.** This is the clearest limitation today.
The browser splits the CSV and sends chunks sequentially, because Workers Free
allows 10 ms CPU and a 1 MB body per request — the Worker can neither hold the
whole file nor fetch it. So closing the tab mid-upload stops it. Chunks already
sent are durably stored and idempotent, but the upload never reaches `complete`
and so never appears in the switcher. The fix is to upload the raw file once to
object storage (R2), have the write trigger a Worker, and chunk server-side with
a queue or Durable Object coordinating, with the page polling status. I did not
build it because R2 and Durable Objects fall outside the no-card free tier this
was scoped to.

**Surface interrupted uploads.** Cheaper than the above and worth doing first:
an upload stuck in `processing` is currently invisible and permanent. It should
appear in the Manage files dialog with a resume-or-discard choice.

**Credit tier calculation.** The dashboard reports availability but stops short
of the money. Real SLAs map availability bands to credit percentages; given the
target that mapping is the obvious next step.

**Per-agent disagreement view.** Agents disagree about the same slot, and today
the worst one wins silently. When one region consistently reports failures
nobody else sees, that is more likely a broken probe than an outage, and it is
currently invisible.

**Property-based tests on the cleaner.** The golden tests pin exact numbers
against the five fixtures, which catches regressions but not unseen shapes.
Generating adversarial rows — mixed units, offsets, duplicates at chunk
boundaries — would test the rules rather than the fixtures.

**A Python port of `core/`.** The cleaning rules are pure functions with no
runtime dependencies precisely so they could be ported without redesign if the
backend stack were Python.

---

## Security notes

No authentication: the brief lists it as out of scope. What is in place:

- The Worker accepts browser requests only from origins in `ALLOWED_ORIGINS`
  (exact match, not prefix).
- Caps: 10 MB per file, 1 MB per chunk, 200,000 rows, enforced on both sides.
- Every external input is validated with zod before it reaches SQL.
- All SQL is parameterised; no value is ever interpolated into query text.
- `DATABASE_URL` is a Worker secret and a server-only Vercel variable. The
  `server-only` package makes it a build error for a client component to
  import the database module.
- A small per-isolate rate limiter (240 requests/minute) blunts accidental
  loops. For a real quota, use Cloudflare's own rate limiting rules.

The Worker URL is public by design, which the caps and allow-list above
mitigate rather than prevent.

---

## Free-tier notes

- **Workers Free:** 100,000 requests/day, 10 ms CPU per request. A 30-day file
  is 8 chunk requests plus 2.
- **Neon free:** compute suspends when idle and resumes on the next query, so
  the first dashboard load after a quiet period is slower.
- Nothing here requires a card.
