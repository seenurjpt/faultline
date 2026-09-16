# Faultline

Faultline reads raw monitoring CSVs, cleans them in a deployed serverless
function, and answers one question quickly: which services missed 99.9% this
month, and when did they break. Every number on screen can be traced back to a
line in the file.

---

## Live URLs

<!-- TODO (you): fill these in after following DEPLOYMENT.md -->

| What | URL |
|---|---|
| Dashboard | `https://<vercel-url>/` |
| Upload | Modal on the dashboard — "Upload file" in the top bar |
| Processor health | `https://faultline-processor.<sub>.workers.dev/v1/health` |

**Last verified live:** _TODO_

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

**Worker CPU time per chunk:** _TODO — read from Cloudflare → Workers →
faultline-processor → Metrics after uploading the fixtures._

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

<!-- TODO (you): write this from what you saw in the fixtures.
     SPEC §7.5 lists what the data contains; say which of those you found,
     how many rows each affected, and what you decided to do about it. -->

_TODO_

---

## Assumptions

<!-- TODO (you): including which statistics you chose for the dashboard and
     why, and anything the spec left open that you had to decide. -->

_TODO_

---

## The strict-SLA observation

<!-- TODO (you): at 15-minute granularity a 30-day month has 2,880 slots, so
     99.9% allows only 2.88 down slots — three failed checks breach the month.
     Say what that means for this data and why incidents are shown separately. -->

_TODO_

---

## With more time

<!-- TODO (you) -->

_TODO_

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
