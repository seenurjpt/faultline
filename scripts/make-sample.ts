// Generates a small sample CSV carrying every data problem from SPEC §7.5,
// for local testing when the real fixtures aren't to hand. This is NOT a
// substitute for them: the golden tests in core/test/golden.test.ts assert
// the real numbers and only run against fixtures/.
import { writeFileSync } from "node:fs";

const SERVICES = [
  { id: "svc-auth", name: "auth-api", baseline: 142, unit: "ms" },
  { id: "svc-notify", name: "notify-worker", baseline: 88, unit: "ms" },
  { id: "svc-payments", name: "payments-api", baseline: 196, unit: "ms" },
  { id: "svc-reports", name: "reports-api", baseline: 240, unit: "ms" },
  // SPEC §7.5: search reports latency in seconds.
  { id: "svc-search", name: "search-api", baseline: 310, unit: "s" },
];

const REGIONS = ["ap-south-1", "eu-west-1", "us-east-1"];
const SLOT_MS = 15 * 60_000;
const DAYS = Number(process.argv[3] ?? 3);
const OUT = process.argv[2] ?? "sample.csv";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(404);
const start = Date.UTC(2025, 3, 6);
const slots = DAYS * 96;

const rows: string[] = [];
const header =
  "service_id,service_name,timestamp,status_code,latency,latency_unit,agent,region";

// One incident per file: a run of failures with a latency spike, so incident
// detection has something real to confirm.
const incidentService = "svc-reports";
const incidentStart = 40;
const incidentEnd = 48;

for (const service of SERVICES) {
  for (let i = 0; i < slots; i++) {
    const at = start + i * SLOT_MS;
    const inIncident =
      service.id === incidentService && i >= incidentStart && i <= incidentEnd;
    const scattered = !inIncident && rand() < 0.004;
    const down = inIncident || scattered;

    const ratio = inIncident ? 3.2 : 1 + rand() * 0.3;
    const latencyMs = Math.round(service.baseline * ratio);
    const latency =
      service.unit === "s" ? (latencyMs / 1000).toFixed(3) : String(latencyMs);

    // Three timestamp formats, matching the proportions in SPEC §7.5.
    const roll = rand();
    let timestamp: string;
    if (roll < 0.015) {
      timestamp = String(Math.floor(at / 1000));
    } else if (roll < 0.022) {
      const shifted = new Date(at + 330 * 60_000).toISOString().slice(0, 19);
      timestamp = `${shifted}+05:30`;
    } else {
      timestamp = new Date(at).toISOString().replace(".000Z", "Z");
    }

    const status = down
      ? [500, 502, 503, 504][Math.floor(rand() * 4)]
      : 200;
    const region = REGIONS[i % REGIONS.length];

    // ~1.2% blank latency, mostly on healthy checks.
    const blank = !down && rand() < 0.012;

    rows.push(
      [
        service.id, service.name, timestamp, status,
        blank ? "" : latency, service.unit, "agent-1", region,
      ].join(","),
    );

    // A second agent reports about 7% of slots.
    if (rand() < 0.07) {
      rows.push(
        [
          service.id, service.name, new Date(at).toISOString().replace(".000Z", "Z"),
          status, latency, service.unit, "agent-2", region,
        ].join(","),
      );
    }
  }
}

// One exact duplicate, one same-check-different-format duplicate, one
// negative latency and one invalid status, as every fixture has.
rows.push(rows[0]);
const firstAt = new Date(start).toISOString().replace(".000Z", "Z");
rows.push(
  `svc-auth,auth-api,${Math.floor(start / 1000)},200,142,ms,agent-1,ap-south-1`,
);
rows.push(
  `svc-auth,auth-api,${new Date(start + SLOT_MS).toISOString().replace(".000Z", "Z")},200,-5,ms,agent-2,ap-south-1`,
);
rows.push(
  `svc-reports,reports-api,${new Date(start + 2 * SLOT_MS).toISOString().replace(".000Z", "Z")},999,240,ms,agent-2,ap-south-1`,
);

writeFileSync(OUT, `${header}\n${rows.join("\n")}\n`, "utf8");
console.log(
  `Wrote ${OUT}: ${rows.length} rows, ${DAYS} days, ${SERVICES.length} services (first slot ${firstAt}).`,
);
