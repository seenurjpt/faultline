# Faultline — Design

**UI and visual spec** · behaviour lives in `SPEC.md`; build order lives in `BUILD_PROMPT.md`

---

## 1. Brief, in one paragraph

Faultline is where an on-call engineer or a billing analyst goes to see what happened to five services, and whether a customer is owed a credit. The company it's built for, EarthRe, is a reinsurer whose world is natural-catastrophe risk: seismic events, climate data, payouts triggered automatically by measurements. So the product borrows the instrument that turns ground movement into evidence, the **seismograph**. Outages read as tremors on a calm trace. The tone is a precise instrument, not a marketing dashboard: calm, legible, and exact about numbers that decide money.

**Primary job of the screen:** answer "which services missed 99.9% this month, and when did they break?" in under ten seconds, then let the user drill into the exact check records.

---

## 2. The one bold thing

**The fault ribbon.** Every other element stays quiet so this one can carry the page.

Each service gets a horizontal lane drawn like a seismograph trace. Healthy checks are small, even ticks around a baseline. Failures are tall, symmetric spikes whose height follows how slow the service was at that moment. Confirmed incidents sit on a soft band behind the spikes. At a glance, a 30-day file looks like a month of seismic readings, and the incidents are the earthquakes.

Everything else (ledger, incidents, receipt, logs) is plain, well-set tables and text.

---

## 3. Tokens

### 3.1 Colour

Light theme (default):

| Token | Hex | Use |
|---|---|---|
| `--fog` | `#E8EEEC` | Page background (cool lichen grey, not cream) |
| `--paper` | `#F6F8F7` | Panels, table body |
| `--basalt` | `#1E2B2E` | Primary text, ribbon baseline |
| `--shale` | `#5A6B6E` | Secondary text, axis labels |
| `--rule` | `#D3DDDA` | 1px borders and gridlines |
| `--tide` | `#0E5E6F` | Links, focus ring, selected states, primary button |
| `--fault` | `#B4236B` | Down slots, SLA breach, credit due |
| `--fault-wash` | `#B4236B1F` | Confirmed incident band (12% alpha) |
| `--ochre-ink` | `#8A5A00` | Warning text (slow, unconfirmed, low coverage) |
| `--ochre` | `#E4B64A` | Warning fills and unconfirmed-cluster underline |
| `--calm` | `#AFC0BB` | Healthy ribbon ticks |
| `--void` | `#9AA8AA` | Unknown-slot hatch |

Dark theme (`prefers-color-scheme: dark`, overridable with `data-theme`):

| Token | Hex |
|---|---|
| `--fog` | `#162426` |
| `--paper` | `#1D2F32` |
| `--basalt` | `#E3ECEA` |
| `--shale` | `#9FB2B3` |
| `--rule` | `#2F4649` |
| `--tide` | `#5FB7C4` |
| `--fault` | `#F06AA5` |
| `--fault-wash` | `#F06AA524` |
| `--ochre-ink` | `#E4B64A` |
| `--ochre` | `#E4B64A` |
| `--calm` | `#3F5B59` |
| `--void` | `#51686A` |

Contrast checks (light): basalt on paper ≈ 13:1; shale on paper ≈ 5.2:1; fault on paper ≈ 5.9:1; tide on paper ≈ 7:1; ochre-ink on paper ≈ 5.6:1. `--ochre` is a fill only, never text.

Colour never carries meaning alone: down slots are also taller, incidents also have a text label, breaches also say "Credit due".

### 3.2 Type

| Role | Family | Weights |
|---|---|---|
| Display (verdict sentence, section titles, big figures) | **Familjen Grotesk** | 600, 700 |
| Text (everything else, tables, controls) | **IBM Plex Sans** | 400, 500, 600 |

Load both with `next/font/google`. All numeric columns and figures use `font-variant-numeric: tabular-nums` so digits align. No monospace anywhere, including timestamps.

Scale (ratio 1.25 from a 15px body):

| Token | Size / line-height | Use |
|---|---|---|
| `--t-xs` | 12 / 16 | Axis ticks, flag chips |
| `--t-sm` | 13 / 18 | Table cells, secondary text |
| `--t-md` | 15 / 22 | Body, controls |
| `--t-lg` | 19 / 26 | Panel titles |
| `--t-xl` | 23 / 30 | Section titles |
| `--t-2xl` | 29 / 36 | Verdict sentence |
| `--t-3xl` | 37 / 42 | Upload screen heading |

Rules:
- Sentence case everywhere. No all-caps labels, no tracked-out eyebrows.
- No single word in a headline picked out in colour or italics.
- Line length ≤ 72 characters for prose.
- Display type tracking −0.01em; text type default tracking.

### 3.3 Space, radius, borders

- Spacing scale: 4, 8, 12, 16, 24, 32, 48, 64 px.
- Radius by role (not one radius everywhere):
  - `--r-field` 6px — inputs, selects, buttons
  - `--r-chip` 999px — flag chips, status pills
  - `--r-panel` 14px — findings and logs panels
  - `0` — ribbon lanes and table rows (instrument surfaces are square)
- No drop shadows. Depth comes from `--fog` vs `--paper` and 1px `--rule` borders.
- No gradients.

### 3.4 Motion

- **One orchestrated moment:** the first time a dataset's ribbon renders, each lane draws left to right over 900 ms (`cubic-bezier(.2,.7,.2,1)`), staggered 60 ms per lane, like a pen crossing paper. It runs once per dataset per session.
- User-triggered motion only otherwise: findings collapse/expand (200 ms height), incident band highlight on hover (120 ms opacity), logs row expand (160 ms).
- `prefers-reduced-motion: reduce` → all of the above are instant.
- No hover animation on table rows or panels, no fade-up entrances.

---

## 4. Libraries (chosen to avoid the stock look)

| Need | Library | Notes |
|---|---|---|
| Accessible primitives | **Radix Primitives** (`@radix-ui/react-*`: Collapsible, Select, Popover, ToggleGroup, Tooltip, Checkbox) | Unstyled; all visuals come from our tokens. Do **not** use shadcn/ui |
| Styling | **Tailwind CSS v4** with the tokens above declared in `@theme` | No default Tailwind palette classes in components |
| Date inputs | **react-day-picker** (unstyled mode, custom `classNames`) | Days outside the dataset range disabled |
| Logs table | **TanStack Table** (headless) | Server-side pagination |
| Data fetching | **TanStack Query** | For logs only; overview is server-rendered |
| URL state | **nuqs** | All dashboard state in the URL |
| Ribbon | **Canvas 2D** + `d3-scale` + `d3-time` | No chart library |
| Icons | **Phosphor Icons** (`@phosphor-icons/react`), regular weight | Used sparingly |

No Recharts, no MUI, no Chakra, no shadcn.

---

## 5. Layout

Grid: 12 columns, 24px gutters, max content width 1360px, 32px page padding (16px under 720px). Everything is **left-aligned**; numbers in tables are right-aligned.

### 5.1 Dashboard (`/`)

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│ Faultline   [monitoring_checks_30d…  6 Apr–5 May 2025 ▾] [April 2025 ▾]  UTC│IST   Upload file │
└───────────────────────────────────────────────────────────────────────────────────┘

  5 of 5 services missed 99.9% in April 2025.                         Hide findings
  2 confirmed incidents. Data covers 25 of 30 days.

┌─ paper panel ─────────────────────────────────────────────────────────────────────┐
│  FAULT RIBBON (full width, 5 lanes × 44px)                                        │
│  auth-api       ─┬┬─┬─────────────────────────────────╫▌█▐█▌█▐────────────────     │
│  notify-worker  ───────┬───────────────────────────────────────────────────────    │
│  payments-api   ──┬────────┬────────┬──────────────────────────────────┬──────    │
│  reports-api    ┬──┬─╫█▌█▐─┬──┬─────┬──┬──────┬─────┬────┬──────┬───────┬───     │
│  search-api     ───┬──────────┬──────────────┬─────────────────┬──────────────     │
│                 6 Apr   9    12    15    18    21    24    27    30 │ 1 May        │
│  legend: healthy · failed · incident · unconfirmed cluster · no data              │
│                                                                                   │
│  ┌─ Service ledger (cols 1–8) ──────────────────┐  ┌─ Incidents (cols 9–12) ──────┐│
│  │ Service   Availability   Nines  Downtime …  │  │ ▌auth-api                     ││
│  │ reports   97.083%        ▕━━━╸  │    1,050m │  │  Tue 22 Apr, 04:00–10:15      ││
│  │ search    99.000%        ▕━━━━━━╸ │   360m  │  │  6h 15m, 18 failed checks     ││
│  │ …                                            │  │ ▌reports-api                  ││
│  └──────────────────────────────────────────────┘  │  Wed 9 Apr, 11:45–14:00       ││
│                                                    └───────────────────────────────┘│
│  ┌─ Data receipt (full width, one row) ──────────────────────────────────────────┐ │
│  │ 15,577 rows read  ███████████████████████████████████████████████▏▏           │ │
│  │ 15,551 stored · 25 merged duplicates · 1 rejected   Converted: 233 epoch, …   │ │
│  └────────────────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────────┘

  Check records                                              42 records
  [One day │ Date range]  [14 Apr 2025]  [Services ▾]  [Outcome: Failures ▾]  [Agent ▾]
┌─ paper panel ─────────────────────────────────────────────────────────────────────┐
│ Time (UTC)          Service       Agent     Status   Latency    Flags             │
│▌14 Apr, 12:00       search-api    agent-1   500      2,193 ms   from seconds      │
│▌14 Apr, 12:30       search-api    agent-1   503      2,356 ms   from seconds      │
│ …                                                                                 │
├───────────────────────────────────────────────────────────────────────────────────┤
│ 1–20 of 15,551   [20 per page ▾]      [<] [1] 2  3  4 … 778 [>]                   │
└───────────────────────────────────────────────────────────────────────────────────┘
```

(The middle dot in the receipt sketch is shorthand for separate inline items; in the build, render them as separate spans with spacing, not joined with `·`.)

Decisions:
- The verdict **sentence** is the hero, set in display type, not a row of big-number tiles. It changes with the period: for "Whole file" it reads "Across the whole file, 5 of 5 services are below 99.9%. Billing is monthly, so pick a month for credit decisions."
- The ribbon sits directly under the verdict because it answers "when".
- Ledger and incidents share a row (8 + 4 columns) because incidents explain ledger numbers.
- The receipt is last in the findings: it matters for trust, but it's the least urgent.

### 5.2 Findings collapsed

```
  5 of 5 services missed 99.9% in April 2025. 2 confirmed incidents.   Show findings
  ─────────────────────────────────────────────────────────────────────────────────
  Check records …
```
The sentence stays; the panel collapses. The toggle is a text button with a caret icon that rotates 180°.

### 5.3 Upload screen (`/upload`)

```
┌ top bar (same as dashboard, without dataset/period controls) ───────────────────┐

  Process a monitoring file                                           (cols 1–5)
  Faultline reads your CSV in batches, cleans each      ┌ intake tray (cols 6–12) ─────────┐
  batch in the cloud, and stores every check it         │                                   │
  keeps, merges or rejects, so the numbers can be       │   Drop a .csv here                │
  traced back to the file.                              │   or  [Choose file]               │
                                                        │                                   │
  What gets checked                                     │   Up to 10 MB. Required columns:  │
  Timestamps in any zone, units, duplicates,            │   service_id, service_name, …     │
  impossible values. Nothing is silently dropped.       └───────────────────────────────────┘
```

After a file is chosen, the tray becomes the pre-flight card:

```
  monitoring_checks_30d_seed404.csv
  1.17 MB, 15,577 rows, sent in 8 batches of up to 2,000 rows
  [Process file]   Choose a different file
```

While processing, the tray shows the **batch track**. Batches are numbered in file order, but up to four travel at once, so the heading counts what has landed rather than pointing at a single current batch:

```
  2 of 8 batches processed, 4 in flight
  [1 ■■■■][2 ■■■■][3 ▒▒▒▒][4 ▒▒▒▒][5 ▒▒▒▒][6 ▒▒▒▒][7    ][8    ]
  So far: 3,996 stored, 4 merged, 0 rejected
```
- Done batches fill with `--tide`; batches in flight pulse in `--tide` outline; a failed batch outlines in `--fault` with the error below, and the batches that were cancelled because of it return to waiting rather than being marked.
- A polite `aria-live` region announces each landing: "Batch 3 of 8 processed." When the processor continues an earlier unfinished upload, the batches it already held show as done from the start and the region says so: "2 of 8 batches were already stored by an earlier attempt. Sending the rest."

On completion, the tray becomes the **receipt**:

```
  Processed 15,577 rows
  15,551 checks stored
  25 duplicates merged
  1 row rejected: status code 999 isn't a valid HTTP status (line {n})
  Converted 233 epoch timestamps and 109 IST timestamps to UTC
  Converted 3,131 latency values from seconds
  [Open dashboard]   Process another file
```

Duplicate file (409): the tray shows "This file was already processed on 15 Sep 2026." with **Open existing dataset** (primary) and **Process again** (secondary).

### 5.4 Responsive

| Width | Changes |
|---|---|
| ≥ 1200 | Layout as drawn |
| 900–1199 | Incidents move below the ledger (full width) |
| 720–899 | Ledger drops the Nines and p50 columns; they appear in a row expansion |
| < 720 | Top bar controls collapse into a "Dataset and period" disclosure; ribbon lanes scroll horizontally with the service label sticky on the left; ledger becomes stacked two-line rows; filter bar collapses into a "Filters" disclosure; logs table becomes stacked rows (time + status on line 1, service + latency on line 2) |

Minimum touch target 40×40px.

---

## 6. Components

### 6.1 Top bar
- Height 56px, `--paper` background, bottom 1px `--rule`.
- **Sticks to the top of the viewport.** The dataset and period controls decide what every number on the page means, and the logs table is long enough to scroll them away; keeping them in view means the reader never has to scroll back up to check which file or month they are looking at. The bar publishes its measured height as `--top-bar-h` on `<html>`, and the table headers stick at that offset so the two never overlap — measured rather than hardcoded, because the bar wraps at narrow widths and grows when the mobile disclosure opens.
- Wordmark "Faultline" in Familjen Grotesk 600, 19px, with a small 3-spike glyph drawn in SVG (three vertical strokes of 4/12/6px in `--fault`). No logo image.
- Dataset select: shows filename (middle-truncated) and date range in `--shale`.
- Period select: "Whole file", then months; months with partial data show "25 of 30 days" in `--shale` inside the option.
- UTC/IST: Radix ToggleGroup, two segments, 6px radius. Tooltip: "Changes how times are shown. Filters and calculations always use UTC."
- "Upload file": secondary button (tide text, tide 1px border).

### 6.2 Verdict
- `--t-2xl` Familjen 600, `--basalt`. Second line `--t-md` `--shale`.
- If coverage < 99% in the period, the second line adds, in `--ochre-ink`: "Some slots have no data; see the receipt."

### 6.3 Fault ribbon

Geometry:
- Lane height 44px; 8px gap between lanes; service label column 128px (text, `--t-sm`, 500).
- Plot width = panel width − label column. Slot width = plot width ÷ slot count (may be < 1px for 30 days; draw at device pixel resolution and let ticks merge).
- Baseline: 1px `--rule` at the lane's vertical centre.

Marks (all drawn symmetrically above and below the baseline):

| Slot state | Mark |
|---|---|
| Up | 6px tall tick in `--calm` |
| Up and slow (ratio > 2) | 10px tick in `--ochre` |
| Down | tick height = `clamp(16px, 8px × latencyRatio, 40px)` in `--fault`, minimum 2 device pixels wide so single failures stay visible |
| Unknown | 4px diagonal hatch block in `--void` |

Overlays (SVG on top of the canvas):
- Confirmed incident: `--fault-wash` rectangle spanning the incident, full lane height; a label above the lane at `--t-xs`: "6h 15m" (duration only).
- Unconfirmed cluster: 2px dotted `--ochre` underline beneath the lane for the cluster span.
- Day gridlines: 1px `--rule` at 40% opacity; month boundary: 1px solid `--shale` with the month name.
- Axis labels below the last lane: day numbers, thinned to fit (every day ≤ 14 days, every 3 days ≤ 31 days); first label in each month includes the month name ("6 Apr").

Interaction:
- Hover: vertical crosshair (1px `--basalt` at 30%) and a tooltip:
  ```
  search-api
  14 Apr 2025, 15:45 UTC
  Failed (502), 2 agents reported
  Latency 3.7× normal
  ```
- Click a lane position → set logs filter `date` to that UTC day and `services` to that service; smooth-scroll to logs (instant if reduced motion). A brief 2px `--tide` outline pulses once on the logs panel.
- Click an incident band → same, with the incident's day(s).
- Keyboard: each lane is a focusable group (`role="group"`, `aria-label="search-api: 28 failed slots, 2 incidents"`). Left/Right move a day cursor; Enter applies the filter; Escape clears the cursor.
- A visually hidden table with per-day counts per service is rendered next to the canvas for screen readers.

Legend: single row under the axis, each item a mini mark + label: "Healthy", "Failed", "Incident", "Failure cluster without latency spike", "No data".

### 6.4 Service ledger

Columns: Service · Availability · Nines · Downtime · Error budget used · Incidents · p95 latency · Verdict.

- **Availability:** `97.083%`, tabular, right-aligned, 3 decimals. Under 99.9 → `--fault`.
- **Nines gauge** (distinctive, and easy to defend): a 120×10px track on a *nines* scale where position = `−log10(1 − availability)`, clamped 1 to 4. So 90% sits at 1, 99% at 2, **99.9% at 3 (a 1px `--basalt` target tick)**, 99.99% at 4. The filled bar is `--fault` below target and `--tide` at or above. This makes 97% vs 99.8% visibly different, which a linear 0–100 bar can't.
  Tooltip: "Each step to the right is one more nine. The tick marks 99.9%."
- **Downtime:** `1,050 min` (en-IN grouping).
- **Error budget used:** `2,917% of 36 min`. Over 100% shows in `--fault`.
- **Incidents:** count; `0` in `--shale`.
- **p95 latency:** `612 ms`; if above 2× the service baseline, `--ochre-ink`.
- **Verdict:**
  - Month period, breach → "Credit due" in `--fault` with a 6px filled square before it.
  - Month period, met → "Meets target" in `--shale`.
  - Whole file → "Pick a month" in `--shale`.
- Coverage < 100% shows a small `--ochre-ink` note under the service name: "1 slot without data".
- Sorting: column headers are buttons; default sort availability ascending.
- Row hover: `--fog` background, no animation. Clicking a service name filters the logs to that service.

### 6.5 Incidents list

- Panel title "Incidents" with the count.
- Each item: 3px left rule in `--fault`; service name `--t-md` 600; line 2 `--t-sm`: "Tue 22 Apr, 04:00–10:15 UTC" (IST when toggled); line 3 `--t-sm` `--shale`: "6h 15m, 18 failed checks, 7 recoveries in between, latency 3.2× normal".
- Whole item is a button; hover highlights the matching band in the ribbon.
- Empty: "No incidents in April 2025. Scattered single failures still count toward availability."

### 6.6 Data receipt

- One horizontal proportion bar (8px, square ends): stored (`--tide`), merged (`--shale`), rejected (`--fault`). Tiny segments get a minimum width of 3px.
- Beneath, inline figures as separate spans: "15,551 stored", "25 merged duplicates", "1 rejected".
- Right side, a short list: "233 epoch timestamps converted", "109 IST timestamps converted", "3,131 latencies converted from seconds", "187 latencies missing or invalid", "Coverage 99.993%".
- Every figure is a link that sets the logs `outcome` filter (`flagged`, `rejected`, …).

### 6.7 Filter bar (logs)

- Date mode: ToggleGroup "One day" / "Date range".
- Date input(s): text field showing `14 Apr 2025` that opens a react-day-picker popover. Days outside the dataset range are disabled with a tooltip "No data on this day". Range mode shows one calendar with range selection.
- Helper text under the date field: "Dates are UTC days."
- Services: Popover with checkboxes and "All services".
- Outcome: Select — "All checks", "Failures", "Slow checks", "Checks with notes", "Rejected rows".
- Agent: Select — "All agents", then agents found.
- "Clear filters" text button appears only when a filter is set.

### 6.8 Logs table

- Sticky header, `--t-sm`, header text `--shale` 500, 1px bottom `--rule`.
- Row height 40px; zebra: none; separators: 1px `--rule`.
- Down rows: 3px left rule in `--fault` and status in `--fault` 600. Slow rows: latency in `--ochre-ink`.
- Time column shows `14 Apr, 12:00`; year shown only when the dataset spans years.
- Flags render as pill chips (`--r-chip`, 1px `--rule`, `--t-xs`) with human labels:

| Flag | Chip text | Expanded explanation |
|---|---|---|
| `ts_epoch_converted` | from epoch | Timestamp was Unix seconds; converted to UTC |
| `ts_offset_converted` | from IST | Timestamp had a +05:30 offset; converted to UTC |
| `latency_unit_seconds` | from seconds | Latency was reported in seconds; converted to ms |
| `latency_missing` | no latency | Latency was blank; excluded from latency stats |
| `latency_negative_dropped` | bad latency | Latency was negative; excluded from latency stats |
| `latency_unparseable` | bad latency | Latency wasn't a number; excluded from latency stats |
| `merged_duplicate` | merged | Another row reported the same check; combined into this one |
| `status_conflict_same_agent` | conflicting status | Duplicate rows disagreed; the failure was kept |

- Row expand (chevron button at row end): raw timestamp, source line ("Line 3,812 in the file"), region, and the flag explanations.
- Rejected view columns: Line, Reason (human text), Raw row (wrapped, `--t-sm`, `--shale`, `word-break: break-all`).
- Footer: one page at a time — "1–20 of 15,551" and a records-per-page select (10/20/50/100, default 20) on the left; Previous, numbered page buttons and Next on the right, above a `--rule` top border. Rows accumulated across pages would put thousands of nodes in the DOM and bury the pager below them, so only the current page is rendered.
- Page numbers: first and last always shown, a one-page window around the current page, `…` for the gaps. A gap that would hide exactly one page shows that page instead, since the ellipsis costs the same width. The control keeps a steady width so the buttons do not move under the pointer while paging.
- Changing the page size returns to page 1, because "page 3" means a different set of rows at a different size.
- Changing page: the buttons disable while the request is in flight and the page already on screen stays put, so the table never collapses to a skeleton mid-read. A polite `aria-live` region announces the new page.
- An expanded row detail closes on a page change, because the row it belonged to is gone.

### 6.9 Buttons and fields

| Kind | Style |
|---|---|
| Primary | `--tide` fill, `--paper` text, 6px radius, 40px height, 16px horizontal padding |
| Secondary | transparent, `--tide` text, 1px `--tide` border |
| Text | `--tide` text, underline on hover |
| Field | `--paper` fill, 1px `--rule`, 6px radius, 40px height; focus: 2px `--tide` ring, 2px offset |

Button text says exactly what happens and never ends with an arrow.

### 6.10 Skeletons and errors

- Skeletons match final geometry: ribbon lanes as flat `--rule` baselines; ledger rows as 12px `--rule` bars. No shimmer; a slow opacity pulse (1.6 s) that stops under reduced motion.
- Inline error block: 1px `--fault` left rule, text in `--basalt`, a "Try again" text button.

---

## 7. Copy

Voice: plain, exact, calm. Sentence case. No exclamation marks. Errors say what happened and what to do; they don't apologise.

| Place | Text |
|---|---|
| Empty dashboard | "No datasets yet. Upload a monitoring CSV to see availability and incidents." + **Upload a file** |
| Missing columns | "This file is missing: latency_unit. Add the column and choose the file again." |
| Too large | "This file is 14.2 MB. The limit is 10 MB." |
| Not CSV | "Choose a .csv file." |
| Processor unreachable | "Couldn't reach the processor, so nothing was stored. Try again." |
| Batch rejected | "Batch 4 was refused: {message from API}." |
| Logs empty | "No check records match: 3 May 2025, payments-api, failures only." + **Clear filters** |
| Date out of range | "This dataset covers 6 Apr – 5 May 2025." |
| Whole-file verdict | "Across the whole file, 5 of 5 services are below 99.9%. Billing is monthly, so pick a month for credit decisions." |
| Coverage warning | "Some slots have no data; see the receipt." |

Dates: `22 Apr 2025` (en-GB order). Numbers: `en-IN` grouping. Durations: `6h 15m`, `45m`. Percentages: 3 decimals for availability, whole numbers elsewhere.

Rejection reasons in human text:

| Code | Text |
|---|---|
| `invalid_status_code` | Status code isn't a valid HTTP status |
| `invalid_timestamp` | Timestamp couldn't be read |
| `timestamp_without_timezone` | Timestamp has no time zone |
| `off_grid_timestamp` | Timestamp isn't on a 15-minute mark |
| `timestamp_out_of_bounds` | Timestamp is outside a plausible range |
| `invalid_service_id` | Service ID isn't in the expected format |
| `missing_required_field` | A required value is empty |
| `malformed_row` | Row has too few columns |

---

## 8. Accessibility checklist

- All interactive elements reachable by keyboard in visual order; visible 2px `--tide` focus ring.
- Ribbon has a keyboard model (§6.3) and a hidden data table.
- Tooltips also open on focus; nothing is hover-only.
- Status is never colour-only (height, text, left rule).
- Tables use `<table>`, `<th scope>`, and `aria-sort` on sortable headers.
- Upload progress uses an `aria-live="polite"` region.
- `prefers-reduced-motion` and `prefers-color-scheme` respected.
- Text contrast ≥ 4.5:1 in both themes (§3.1).

---

## 9. Self-review against generic defaults

| Common default | What Faultline does instead |
|---|---|
| Warm cream background + serif + terracotta accent | Cool lichen-grey background, grotesk type, magenta fault colour tied to "failure" |
| Near-black page with one neon accent | Light by default; dark theme uses deep sea-slate, not tinted black |
| Newspaper hairlines, zero radius everywhere | Radius varies by role; only instrument surfaces (ribbon, rows) are square |
| Identical rounded stat cards with soft shadows | A verdict sentence, a real table, and a single visual (the ribbon); no shadows |
| Big number + small label KPI tiles | Replaced by the verdict sentence and the ledger |
| All-caps eyebrows, monospace data labels, `→` buttons, `A · B · C` meta strings | Sentence case, tabular sans figures, plain button labels, separate spans |
| Generic line/bar chart library look | Custom seismograph canvas grounded in EarthRe's field |
| Linear 0–100% availability bars | Nines-scale gauge with the 99.9% tick |
| Fade-up on every section | One pen-draw moment on the ribbon, nothing else unprompted |

Revision made during review: the first plan used a big "5 / 5 breached" figure as the hero. It read like a stock KPI tile, so it became the verdict sentence, and the ribbon took over as the visual centre.
