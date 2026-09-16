# Faultline — Build Prompt for Cursor

This file drives the end-to-end build. It never adds requirements of its own: **`SPEC.md` decides behaviour, `DESIGN.md` decides visuals.** It only sets the order, the guardrails, and the checks.

## How to use this file

1. Create the repo, put `SPEC.md`, `DESIGN.md` and this file in the root, and put the five CSVs and `dataset_incident_log.json` in `fixtures/`. Make the first commit.
2. Create `.cursor/rules/faultline.mdc` with the content in §1.
3. Run the phases **one at a time** in Cursor Agent: paste the phase block, let it finish, run the checks yourself, read the diff, then commit.
4. Before moving on, answer the phase's "Can you explain" questions out loud. If you can't, ask Cursor to walk you through that code before continuing. You'll be asked to defend every line.
5. Don't let the agent write the README's findings, assumptions or "with more time" prose. Write those yourself from `SPEC.md` §15.

Steps marked **(you)** need your accounts or secrets; the agent can't do them.

---

## 1. Project rules (`.cursor/rules/faultline.mdc`)

```md
---
description: Faultline project rules
alwaysApply: true
---
- Read SPEC.md and DESIGN.md before any change. SPEC.md owns behaviour, data and APIs. DESIGN.md owns visuals and copy. If they conflict on behaviour, SPEC.md wins.
- Do not add features, endpoints, columns, dependencies or screens that the specs don't list. If something is ambiguous, stop and ask instead of guessing.
- Out of scope, never build: authentication, user accounts, multi-tenancy, CI pipelines.
- TypeScript strict mode everywhere. No `any`. Validate every external input with zod.
- packages/core is pure TypeScript with zero runtime dependencies and no I/O. All cleaning, merging, SLA and incident rules live there and nowhere else.
- All SQL is parameterised. Reads live in apps/web/lib/queries.ts; writes live in apps/processor/src/db.ts.
- All times are UTC internally. IST is a display option only.
- UI: Radix Primitives + Tailwind v4 tokens from DESIGN.md §3 only. Do not use shadcn/ui, Recharts, MUI, Chakra, or Tailwind's default palette classes. No monospace fonts. No all-caps labels. No arrows at the end of button text. No drop shadows or gradients.
- Keep functions small. Add a one-line comment above any rule that exists because of a data finding, citing the SPEC section (e.g. `// SPEC §7.4: failure wins`).
- Every task ends with tests or a manual check listed in BUILD_PROMPT.md, then a commit with a message explaining what changed and why.
```

---

## Phase 0 — Scaffold and deploy empty pieces (≈45 min)

**(you)** Create free accounts: Cloudflare, Neon, Vercel (GitHub login is fine). Create a Neon project and keep the connection string handy.

**Prompt:**
> Read SPEC.md §3, §4 and §14. Scaffold the monorepo exactly as in SPEC §4 with pnpm workspaces and Node 22:
> - `packages/core`: TypeScript library with vitest, exporting nothing yet except `types.ts` from SPEC §7.3 and §9.
> - `apps/processor`: Cloudflare Worker (TypeScript, `wrangler.jsonc`, name `faultline-processor`) with only `GET /v1/health` returning `{ ok: true, db: false }` for now, plus CORS handling driven by an `ALLOWED_ORIGINS` var (SPEC §6).
> - `apps/web`: Next.js App Router + TypeScript + Tailwind v4. Add the DESIGN §3 tokens (both themes) in `@theme`, load Familjen Grotesk and IBM Plex Sans with `next/font/google`, and render a placeholder `/` and `/upload` using those tokens.
> - `db/migrations/001_init.sql` exactly as SPEC §10, and `scripts/migrate.ts` that applies migrations in order using `@neondatabase/serverless` and records applied files in a `schema_migrations` table.
> - Root scripts: `dev`, `test`, `db:migrate`, `deploy:processor`, `verify`, `smoke`.
> Do not build any feature yet.

**(you)**
1. `DATABASE_URL=… pnpm db:migrate`
2. `cd apps/processor && npx wrangler login && npx wrangler secret put DATABASE_URL && npx wrangler deploy`
3. Import the repo in Vercel, root directory `apps/web`, add env vars from SPEC §14.1, deploy.
4. Add the Vercel URL to `ALLOWED_ORIGINS`, redeploy the Worker.

**Checks:** Worker `/v1/health` responds; Vercel URL loads with the right fonts and colours; tables exist in Neon.

**Commits:** `chore: scaffold monorepo (web, processor, core)`, `feat(db): initial schema and migration runner`, `chore: deploy skeleton to Vercel and Cloudflare`

**Can you explain:** why three packages instead of one app? why the Worker needs CORS?

---

## Phase 1 — Cleaning and merging in core (≈90 min)

**Prompt:**
> Implement SPEC §7 in `packages/core`:
> - `csv.ts`: RFC 4180 field parser and a quote-aware line splitter; strips a UTF-8 BOM; handles `\r\n`.
> - `clean.ts`: `clean(fields, headerIndex, lineNumber)` returning a `CleanCheck` or a rejection. Implement the hard rules in the exact order of §7.1 and the soft rules of §7.2. Use the ISO regex from §7.1 before `Date.parse`.
> - `merge.ts`: `mergeChecks(a, b)` implementing §7.4, and `mergeWithinChunk(checks)` keyed by service, UTC time and agent.
> - `pipeline.ts`: `processChunk(csvText, lineOffset)` returning `{ checks, rejections, counts, issues }` with the per-chunk invariant from §6.3.
> Tests in `packages/core/test`:
> - one test per hard and soft rule
> - `+05:30` conversion example from §12.5
> - merge rules from §12.5
> - quoted newline test
> - `golden.test.ts`: run the fixtures in chunks of 2,000 and simulate the database merge across chunks in memory; assert every column of SPEC §12.1
> - chunk-size invariance (1,000 / 2,000 / 5,000 / whole file)
> Add `scripts/verify-fixtures.ts` that prints the §12.1 table from the code.

**Checks:** `pnpm test` green; `pnpm verify` prints a table identical to SPEC §12.1.

**Commits:** `feat(core): CSV parsing with quote-aware splitting`, `feat(core): row cleaning rules with reason codes`, `feat(core): duplicate merge rule`, `test(core): golden cleaning totals for all fixtures`

**Can you explain:** why duplicates are only visible after timestamp conversion? why failures win in a merge? why off-grid timestamps are rejected, not snapped? what happens to the `999` row in the 14d file?

---

## Phase 2 — SLA and incidents in core (≈60 min)

**Prompt:**
> Implement SPEC §8 and §9 in `packages/core`:
> - `sla.ts`: slot health (worst agent wins), period list (whole file + clipped UTC months with measured/month days), and every metric in the §8.4 table.
> - `incidents.ts`: clustering (gap > 3 slots starts a new cluster), minimum 3 down slots, latency confirmation (window median ≥ 2× service baseline), output shape from §9.
> Tests: assert SPEC §12.2, §12.3 and §12.4 exactly for all fixtures, plus unit tests for: unknown slots excluded from availability, error budget formula, `creditEligible` false for the whole-file period, a cluster of 2 not reported, a gap of 3 healthy slots splitting a cluster.
> Extend `scripts/verify-fixtures.ts` to print availability and incidents, and compare incidents against `fixtures/dataset_incident_log.json` by overlap (log days are 0-based from the file's start date).

**Checks:** tests green; verify script reports 8 of 8 logged incidents matched and 0 unconfirmed matches counted as incidents.

**Commits:** `feat(core): slot health and monthly SLA metrics`, `feat(core): incident detection with latency confirmation`, `test(core): golden availability and incidents`

**Can you explain:** why three failed checks breach a month? why unknown slots are excluded rather than counted? why the latency check exists? what the nines gauge position is for 97%?

---

## Phase 3 — Processor endpoints (≈75 min)

**Prompt:**
> Implement SPEC §6 in `apps/processor` using `packages/core`:
> - Router for `POST /v1/uploads`, `PUT /v1/uploads/:id/chunks/:index`, `POST /v1/uploads/:id/complete`, `GET /v1/health` (now pinging the DB).
> - zod request validation and the error body shape from §6.
> - `db.ts`: Neon HTTP client; the `unnest` bulk upsert from §10.1 including the retry guard (`where checks.source_line <> excluded.source_line`); services upsert; rejected rows delete + insert; chunk upsert; all four inside `sql.transaction([...])`.
> - `complete` computes totals from the tables as in §6.4.
> - Enforce the size and row limits from §6.5.
> Add `scripts/upload-fixture.ts <file> <processorUrl>` that uses the same chunker the web app will use and prints each chunk report and the final summary.

**(you)** `pnpm deploy:processor`, then run the script against the deployed Worker for the 9d and 30d fixtures. Open Cloudflare → Workers → faultline-processor → Metrics and note the CPU time per request.

**Checks:**
- Final summaries match SPEC §12.1.
- Running the same chunk twice leaves `checks` unchanged (verify with a `count(*)` and a sample of `flags`).
- Uploading the same file again returns `409 already_uploaded`; `force: true` creates a new upload.
- CPU time per chunk is under 10 ms. If not, reduce the chunk size in one constant and re-measure.

**Commits:** `feat(processor): upload lifecycle endpoints`, `feat(processor): idempotent bulk upsert per chunk`, `chore(scripts): fixture upload script`

**Can you explain:** what `xmax = 0` tells you? why the transaction wraps all four statements? why totals come from the tables and not the chunk reports?

---

## Phase 4 — Upload screen (≈45 min)

**Prompt:**
> Build `/upload` per SPEC §5.1–5.2 and DESIGN §5.3, §6.9, §7:
> - `lib/upload-client.ts`: pre-flight (extension, size, header, row count, sha256), chunking with `X-Line-Offset`, sequential sending with the retry policy from §5.1, missing-chunk resend, duplicate (409) handling.
> - UI states: empty tray, pre-flight card, batch track with `aria-live` announcements, receipt, duplicate prompt, and every error message in DESIGN §7.
> - The receipt's "Open dashboard" goes to `/?dataset={id}`.
> Use only the DESIGN tokens and Radix where a primitive is needed.

**Checks:** upload the 12d fixture from the live Vercel URL; batch track advances; receipt numbers match §12.1; re-uploading shows the duplicate prompt; a CSV with a column removed is blocked before any request; keyboard-only upload works.

**Commits:** `feat(web): upload client with chunking and retries`, `feat(web): upload screen states`

**Can you explain:** why the browser splits the file and not the Worker? what happens if the tab closes mid-upload?

---

## Phase 5 — Overview API and findings section (≈75 min)

**Prompt:**
> Implement `GET /api/datasets` and `GET /api/datasets/:id/overview` exactly as SPEC §11.1–11.2, using `slot_status` and `packages/core` for metrics and incidents. Then build the dashboard top half per DESIGN §5.1–5.2 and §6.1–6.6:
> - nuqs URL state for `dataset`, `period`, `stats`, `tz`
> - top bar, verdict sentence, collapsible findings (Radix Collapsible)
> - fault ribbon on Canvas 2D with SVG overlays, tooltip, click-to-filter, keyboard model, hidden data table, and the one-time pen-draw animation (disabled under reduced motion)
> - service ledger with the nines gauge and sorting
> - incidents list linked to the ribbon
> - data receipt with links that set the logs outcome filter
> - skeletons and inline errors per DESIGN §6.10
> Server-render the overview from search params.

**Checks:** for the 30d dataset and period April 2025, the ledger matches SPEC §12.3 (for example `svc-reports` 70 down slots, 97.083%); the ribbon shows two incident bands (auth 22 Apr, reports 9 Apr); "Whole file" shows "Pick a month"; collapsing keeps the verdict line; dark mode and 375px width look right.

**Commits:** `feat(web): overview read API`, `feat(web): verdict and findings layout`, `feat(web): fault ribbon`, `feat(web): service ledger with nines gauge`, `feat(web): incidents list and data receipt`

**Can you explain:** how the nines scale is calculated? why the whole-file period has no billing verdict? why incidents are computed over the whole dataset before filtering?

---

## Phase 6 — Logs API and logs section (≈60 min)

**Prompt:**
> Implement `GET /api/datasets/:id/logs` exactly as SPEC §11.3 (zod params, mutually exclusive date modes, range validation, keyset cursor, total count, `rejected` variant). Then build the logs section per DESIGN §6.7–6.8 and §7 with TanStack Table and TanStack Query: filter bar, flag chips, row expansion, rejected view, load more, empty state, IST display toggle. Wire the ribbon, incidents, ledger and receipt interactions from Phase 5 to these filters.

**Checks:** "One day" 14 Apr 2025 + search-api + Failures on the 12d dataset returns the incident rows; a range spanning the month boundary on the 30d dataset works; a date outside the dataset returns the out-of-range message; "Rejected rows" shows the `999` line; paging never repeats or skips a row (compare against a SQL count).

**Commits:** `feat(web): logs read API with keyset pagination`, `feat(web): logs filters and table`, `feat(web): connect findings to logs filters`

**Can you explain:** why keyset pagination instead of offset? why date filters use UTC days even when IST is shown?

---

## Phase 7 — Polish, smoke test, submission (≈45 min)

**Prompt:**
> Implement `scripts/smoke.ts` per SPEC §12.5. Run an accessibility pass against DESIGN §8 and fix issues. Review every component against DESIGN §9 and list any place that drifted. Create `README.md` with the headings from SPEC §15 and the commands from §14, leaving the findings, assumptions, strict-SLA observation and "with more time" sections as TODO markers for the author.

**(you)**
1. Upload all five fixtures through the live UI.
2. `pnpm smoke` against production.
3. Write the README TODO sections in your own words. Add the Worker CPU measurement and "Last verified live: <date>".
4. Final commit and push. Send the GitHub link and the live URLs.

**Commits:** `test: production smoke test`, `fix(web): accessibility pass`, `docs: README`

---

## Final checklist

- [ ] Upload UI, Worker, database and dashboard all reachable at live URLs
- [ ] Worker is a separate Cloudflare deployment, not a Next.js route
- [ ] Data persists and is queryable after the upload finishes
- [ ] Stats section collapses and expands; state survives reload via URL
- [ ] Logs filter by one date and by a date range
- [ ] Golden tests pass; smoke test passes against production
- [ ] README covers architecture, every data finding, assumptions (including the stats chosen), live URL, run/redeploy steps, and "with more time"
- [ ] No auth, tenancy or CI added
- [ ] Commit history shows the phases in order with meaningful messages
- [ ] You can explain every "Can you explain" question above without notes
