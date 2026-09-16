# fixtures/

Put the five provided CSVs and `dataset_incident_log.json` here:

```
fixtures/
├── monitoring_checks_9d_seed101.csv
├── monitoring_checks_12d_seed505.csv
├── monitoring_checks_14d_seed202.csv
├── monitoring_checks_21d_seed303.csv
├── monitoring_checks_30d_seed404.csv
└── dataset_incident_log.json
```

These files are not in the repository. Until they are present:

- `npm test` runs 52 unit tests and **skips** the 12 golden tests, reporting
  them as skipped rather than passing.
- `npm run verify` exits with a message asking for the fixtures.

Once they are in place, `npm test` asserts every number in SPEC §12.1–§12.4
and `npm run verify` prints those tables from the code.

For a quick local file with the same data problems (but not the golden
numbers), run `npx tsx scripts/make-sample.ts sample.csv 3`.
