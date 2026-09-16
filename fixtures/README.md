# fixtures/

The five CSVs provided with the assignment and the incident log that came
with them, committed as-is so the tests and the numbers in the README can be
reproduced from a fresh clone:

```
fixtures/
├── monitoring_checks_9d_seed101.csv      4,672 rows,  8–16 May 2025
├── monitoring_checks_12d_seed505.csv     6,230 rows, 10–21 Apr 2025
├── monitoring_checks_14d_seed202.csv     7,269 rows, 19 May–1 Jun 2025
├── monitoring_checks_21d_seed303.csv    10,904 rows,  3–23 Apr 2025
├── monitoring_checks_30d_seed404.csv    15,577 rows,  6 Apr–5 May 2025
└── dataset_incident_log.json             the 8 logged incidents, by file
```

Each file has 5 services, one check every 15 minutes per service, from one or
two agents. What is wrong with the data is written up in the README under
"Data findings" and in SPEC §7.5.

What uses them:

- `npm test` — the 12 golden tests in `core/test/golden.test.ts` run the full
  pipeline over every file and assert the SPEC §12 numbers (cleaning totals,
  per-service availability, chunk-size invariance, and that the incident rule
  finds all 8 logged incidents with no false confirmations). If the files are
  missing the golden tests are reported as skipped, not passed.
- `npm run verify` — prints the same tables from the code, which is where the
  README's data-findings table comes from.
- `npm run smoke` — uploads the 9-day file to the deployed Worker.

For a quick throwaway file with the same data problems (but not the golden
numbers), run `npx tsx scripts/make-sample.ts sample.csv 3`.
