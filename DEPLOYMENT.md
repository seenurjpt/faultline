# Deployment runbook

Everything here needs your own accounts, so these are the steps for you to run.
All three services have free tiers and none asks for a card.

Total time: about 30 minutes.

---

## Before you start

```bash
npm install
npm test          # 52 unit tests pass, 12 golden tests skip until fixtures land
npm run typecheck
```

Add the fixtures (see `fixtures/README.md`) and re-run `npm test` — the 12
golden tests should then pass and assert every number in SPEC §12.

---

## 1. Neon (Postgres) — ~5 min

1. Sign up at <https://neon.tech> (GitHub login is fine).
2. **Create project.** Pick the region closest to you — Singapore
   (`ap-southeast-1`) or Mumbai if offered. Name it `faultline`.
3. On the project dashboard, copy the **Pooled connection** string. It looks
   like:
   ```
   postgresql://neondb_owner:PASSWORD@ep-xxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   ```
   Use the *pooled* one: serverless callers open many short connections.
4. Run the migrations from your machine:
   ```bash
   DATABASE_URL="postgresql://…" npm run db:migrate
   ```
   Expect `apply 001_init.sql`, `apply 002_read_indexes.sql`, `Applied 2 migration(s).`
5. Confirm in the Neon SQL editor:
   ```sql
   select table_name from information_schema.tables
   where table_schema = 'public' order by table_name;
   ```
   You should see: `checks`, `rejected_rows`, `schema_migrations`, `services`,
   `slot_status`, `upload_chunks`, `uploads`.

**Keep the connection string.** It is a credential: it goes in Cloudflare and
Vercel only, never in the repository.

---

## 2. Cloudflare Worker (the processor) — ~10 min

1. Sign up at <https://dash.cloudflare.com>.
2. Log wrangler in (opens a browser):
   ```bash
   npx wrangler login
   ```
3. Store the database URL as a **secret**, not a var, so it is never printed
   in config or logs:
   ```bash
   npx wrangler secret put DATABASE_URL --config worker/wrangler.jsonc
   # paste the Neon pooled connection string when prompted
   ```
4. Deploy:
   ```bash
   npm run worker:deploy
   ```
   Note the URL it prints, e.g.
   `https://faultline-processor.your-subdomain.workers.dev`.
5. Check health:
   ```bash
   curl https://faultline-processor.your-subdomain.workers.dev/v1/health
   # {"ok":true,"db":true}
   ```
   `"db":false` means the secret is wrong or Neon is unreachable.

---

## 3. Vercel (the web app) — ~10 min

1. Push this repository to GitHub.
2. At <https://vercel.com>, **Add New → Project**, import the repo. Leave the
   root directory as the repository root (this is a single-app repo).
3. Add two environment variables (Settings → Environment Variables), for
   Production, Preview and Development:

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | the Neon pooled connection string |
   | `NEXT_PUBLIC_PROCESSOR_URL` | your Worker URL, no trailing slash |

   `NEXT_PUBLIC_` is deliberate: the upload page calls the Worker from the
   browser. `DATABASE_URL` has no such prefix and stays server-side.
4. Deploy. Note the URL, e.g. `https://faultline.vercel.app`.

---

## 4. Close the CORS loop — ~2 min

The Worker only accepts browser requests from origins you list.

1. Edit `worker/wrangler.jsonc`:
   ```jsonc
   "vars": {
     "ALLOWED_ORIGINS": "https://faultline.vercel.app,http://localhost:3000"
   }
   ```
   Use your real Vercel URL. Keep `http://localhost:3000` for local work.
2. Redeploy the Worker:
   ```bash
   npm run worker:deploy
   ```

Without this step the upload page fails with a CORS error in the browser
console, which is the allow-list doing its job.

---

## 5. Verify the live system — ~5 min

1. Open `https://<your-vercel-url>/upload` and upload a fixture. Watch the
   batch track advance and the receipt appear.
2. Click **Open dashboard**. The ribbon, ledger, incidents and logs should
   all be populated.
3. Run the smoke test against production:
   ```bash
   PROCESSOR_URL=https://faultline-processor.<sub>.workers.dev \
   WEB_URL=https://<your-vercel-url> \
   npm run smoke
   ```
   It uploads the 9d fixture, checks the per-chunk invariant, re-sends a chunk
   to prove idempotency, completes the upload and reads it back through the
   API.
4. Upload the remaining fixtures through the UI.

---

## 6. Record the CPU measurement

The README asks for a real number, not an estimate.

1. Cloudflare dashboard → **Workers & Pages** → `faultline-processor` →
   **Metrics**.
2. Read **CPU time per request** (median and p99) after the uploads.
3. Put it in `README.md` under Architecture, with the date.

The free plan allows 10 ms CPU per request. If p99 is near that, lower
`CHUNK_ROWS` in `lib/upload-client.ts` (and `LIMITS.chunkRows` in
`worker/src/http.ts`, which validates it) and re-measure.

---

## Local development

```bash
cp .env.example .env.local     # fill in both values
npm run dev                    # http://localhost:3000
```

To run the Worker locally instead of the deployed one:

```bash
npm run worker:dev             # http://localhost:8787
# then set NEXT_PUBLIC_PROCESSOR_URL=http://localhost:8787 in .env.local
```

`.env.local` is gitignored. Never commit a connection string.

---

## If something breaks

| Symptom | Likely cause |
|---|---|
| `{"ok":true,"db":false}` | Worker secret missing or wrong: re-run `wrangler secret put DATABASE_URL` |
| CORS error on upload | Vercel URL not in `ALLOWED_ORIGINS`, or Worker not redeployed after editing it |
| Dashboard says "database isn't configured" | `DATABASE_URL` missing on Vercel, or the deploy predates adding it |
| Upload stalls on batch 1 | `NEXT_PUBLIC_PROCESSOR_URL` wrong, or the Worker is not deployed |
| First load after a quiet period is slow | Neon free compute suspends when idle and resumes on the next query. Expected. |
| `429 rate_limited` | The Worker's per-isolate limiter (240 requests/minute). Wait a minute. |

Logs: `npm run worker:tail` for the Worker, the Vercel dashboard for the app.
