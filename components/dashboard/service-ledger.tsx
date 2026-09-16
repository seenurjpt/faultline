"use client";

import { useMemo, useState } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { CaretDown, CaretUp } from "@phosphor-icons/react";
import type { LedgerRow } from "@/lib/types";
import { formatAvailability, formatNumber, formatPercent } from "@/lib/format";
import { cx } from "../ui/primitives";

/**
 * DESIGN §6.4: the gauge runs on a nines scale, position = −log10(1 − availability),
 * clamped 1 to 4, so 97% and 99.8% are visibly different.
 */
function ninesPosition(availabilityPct: number): number {
  if (availabilityPct >= 99.99) return 1;
  if (availabilityPct <= 90) return 0;
  const nines = -Math.log10(1 - availabilityPct / 100);
  return Math.min(1, Math.max(0, (nines - 1) / 3));
}

const TARGET_POSITION = (3 - 1) / 3; // 99.9% sits at three nines.

function NinesGauge({ availabilityPct }: { availabilityPct: number }) {
  const fill = ninesPosition(availabilityPct);
  const meets = availabilityPct >= 99.9;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <span
          className="relative block h-[10px] w-[120px] max-w-full border border-[var(--rule)]"
          role="img"
          aria-label={`${formatAvailability(availabilityPct)}, target 99.9%`}
        >
          <span
            className="absolute inset-y-0 left-0"
            style={{
              width: `${fill * 100}%`,
              background: meets ? "var(--tide)" : "var(--fault)",
            }}
          />
          {/* The 99.9% target tick. */}
          <span
            className="absolute inset-y-0 w-px bg-[var(--basalt)]"
            style={{ left: `${TARGET_POSITION * 100}%` }}
          />
        </span>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          sideOffset={6}
          className="z-50 max-w-[240px] rounded-[var(--radius-field)] border border-[var(--rule)] bg-[var(--paper)] px-3 py-2 text-[13px] leading-[18px]"
        >
          Each step to the right is one more nine. The tick marks 99.9%.
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

type SortKey =
  | "serviceName"
  | "availabilityPct"
  | "downtimeMinutes"
  | "budgetUsedPct"
  | "incidentCount"
  | "p95LatencyMs";

const COLUMNS: {
  key: SortKey;
  label: string;
  numeric: boolean;
  hideBelow?: string;
}[] = [
  { key: "serviceName", label: "Service", numeric: false },
  { key: "availabilityPct", label: "Availability", numeric: true },
  // DESIGN §5.4: Nines and p50 drop out between 720 and 899px.
  { key: "downtimeMinutes", label: "Downtime", numeric: true },
  { key: "budgetUsedPct", label: "Error budget used", numeric: true },
  { key: "incidentCount", label: "Incidents", numeric: true },
  { key: "p95LatencyMs", label: "p95 latency", numeric: true },
];

export function ServiceLedger({
  rows,
  isWholeFile,
  baselineRatioAbove,
  onServiceClick,
}: {
  rows: LedgerRow[];
  isWholeFile: boolean;
  baselineRatioAbove: Record<string, boolean>;
  onServiceClick: (serviceId: string) => void;
}) {
  // DESIGN §6.4: default sort is availability ascending — worst first.
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "availabilityPct",
    dir: "asc",
  });
  const [expanded, setExpanded] = useState<string | null>(null);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      const cmp =
        typeof av === "string" && typeof bv === "string"
          ? av.localeCompare(bv)
          : Number(av) - Number(bv);
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sort]);

  const toggleSort = (key: SortKey) => {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "serviceName" ? "asc" : "desc" },
    );
  };

  const ariaSort = (key: SortKey) =>
    sort.key === key
      ? sort.dir === "asc"
        ? ("ascending" as const)
        : ("descending" as const)
      : ("none" as const);

  return (
    <Tooltip.Provider delayDuration={200}>
      {/* Desktop and tablet: a real table. */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full border-collapse text-[13px] leading-[18px]">
          <thead>
            <tr className="border-b border-[var(--rule)]">
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={ariaSort(col.key)}
                  className={cx(
                    "py-2 pr-3 font-medium text-[var(--shale)]",
                    col.numeric ? "text-right" : "text-left",
                    col.key === "p95LatencyMs" && "hidden lg:table-cell",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(col.key)}
                    className={cx(
                      "inline-flex items-center gap-1 hover:text-[var(--basalt)]",
                      col.numeric && "flex-row-reverse",
                    )}
                  >
                    {col.label}
                    {sort.key === col.key &&
                      (sort.dir === "asc" ? (
                        <CaretUp size={10} weight="bold" />
                      ) : (
                        <CaretDown size={10} weight="bold" />
                      ))}
                  </button>
                </th>
              ))}
              <th
                scope="col"
                className="hidden py-2 pr-3 text-left font-medium text-[var(--shale)] md:table-cell"
              >
                Nines
              </th>
              <th
                scope="col"
                className="py-2 text-left font-medium text-[var(--shale)]"
              >
                Verdict
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const coverageGap = row.expectedSlots - row.knownSlots;
              return (
                <tr
                  key={row.serviceId}
                  className="border-b border-[var(--rule)] hover:bg-[var(--fog)]"
                >
                  <td className="py-2 pr-3">
                    <button
                      type="button"
                      onClick={() => onServiceClick(row.serviceId)}
                      className="text-left font-medium hover:text-[var(--tide)] hover:underline underline-offset-4"
                    >
                      {row.serviceName}
                    </button>
                    {/* DESIGN §6.4: incomplete coverage is stated, not implied. */}
                    {coverageGap > 0 && (
                      <span className="block text-[12px] leading-[16px] text-[var(--ochre-ink)]">
                        {formatNumber(coverageGap)}{" "}
                        {coverageGap === 1 ? "slot" : "slots"} without data
                      </span>
                    )}
                  </td>
                  <td
                    className={cx(
                      "py-2 pr-3 text-right tnum",
                      !row.meetsSla && "text-[var(--fault)]",
                    )}
                  >
                    {formatAvailability(row.availabilityPct)}
                  </td>
                  <td className="py-2 pr-3 text-right tnum whitespace-nowrap">
                    {formatNumber(row.downtimeMinutes)} min
                  </td>
                  <td
                    className={cx(
                      "py-2 pr-3 text-right tnum whitespace-nowrap",
                      row.budgetUsedPct > 100 && "text-[var(--fault)]",
                    )}
                  >
                    {formatPercent(Math.round(row.budgetUsedPct))} of{" "}
                    {Math.round(row.errorBudgetMinutes)} min
                  </td>
                  <td
                    className={cx(
                      "py-2 pr-3 text-right tnum",
                      row.incidentCount === 0 && "text-[var(--shale)]",
                    )}
                  >
                    {row.incidentCount}
                  </td>
                  <td
                    className={cx(
                      "hidden py-2 pr-3 text-right tnum whitespace-nowrap lg:table-cell",
                      baselineRatioAbove[row.serviceId] && "text-[var(--ochre-ink)]",
                    )}
                  >
                    {row.p95LatencyMs === null
                      ? "—"
                      : `${formatNumber(row.p95LatencyMs)} ms`}
                  </td>
                  <td className="hidden py-2 pr-3 md:table-cell">
                    <NinesGauge availabilityPct={row.availabilityPct} />
                  </td>
                  <td className="py-2 whitespace-nowrap">
                    <Verdict row={row} isWholeFile={isWholeFile} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Under 720px: stacked two-line rows (§5.4). */}
      <ul className="sm:hidden">
        {sorted.map((row) => {
          const open = expanded === row.serviceId;
          return (
            <li
              key={row.serviceId}
              className="border-b border-[var(--rule)] py-3"
            >
              <div className="flex items-baseline justify-between gap-3">
                <button
                  type="button"
                  onClick={() => onServiceClick(row.serviceId)}
                  className="text-[15px] leading-[22px] font-medium"
                >
                  {row.serviceName}
                </button>
                <span
                  className={cx(
                    "tnum text-[15px] leading-[22px]",
                    !row.meetsSla && "text-[var(--fault)]",
                  )}
                >
                  {formatAvailability(row.availabilityPct)}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] leading-[18px] text-[var(--shale)]">
                <span className="tnum">
                  {formatNumber(row.downtimeMinutes)} min down
                </span>
                <span className="tnum">{row.incidentCount} incidents</span>
                <Verdict row={row} isWholeFile={isWholeFile} />
              </div>
              <div className="mt-2 flex items-center gap-3">
                <NinesGauge availabilityPct={row.availabilityPct} />
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : row.serviceId)}
                  aria-expanded={open}
                  className="inline-flex min-h-10 items-center gap-1 text-[13px] leading-[18px] text-[var(--tide)]"
                >
                  {open ? "Less" : "More"}
                  <CaretDown
                    size={10}
                    weight="bold"
                    className={cx("transition-transform", open && "rotate-180")}
                  />
                </button>
              </div>
              {open && (
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px] leading-[18px]">
                  <dt className="text-[var(--shale)]">Error budget used</dt>
                  <dd
                    className={cx(
                      "text-right tnum",
                      row.budgetUsedPct > 100 && "text-[var(--fault)]",
                    )}
                  >
                    {formatPercent(Math.round(row.budgetUsedPct))} of{" "}
                    {Math.round(row.errorBudgetMinutes)} min
                  </dd>
                  <dt className="text-[var(--shale)]">p50 latency</dt>
                  <dd className="text-right tnum">
                    {row.p50LatencyMs === null
                      ? "—"
                      : `${formatNumber(row.p50LatencyMs)} ms`}
                  </dd>
                  <dt className="text-[var(--shale)]">p95 latency</dt>
                  <dd
                    className={cx(
                      "text-right tnum",
                      baselineRatioAbove[row.serviceId] && "text-[var(--ochre-ink)]",
                    )}
                  >
                    {row.p95LatencyMs === null
                      ? "—"
                      : `${formatNumber(row.p95LatencyMs)} ms`}
                  </dd>
                  <dt className="text-[var(--shale)]">Coverage</dt>
                  <dd className="text-right tnum">
                    {row.coveragePct.toFixed(3)}%
                  </dd>
                </dl>
              )}
            </li>
          );
        })}
      </ul>
    </Tooltip.Provider>
  );
}

function Verdict({
  row,
  isWholeFile,
}: {
  row: LedgerRow;
  isWholeFile: boolean;
}) {
  // SPEC §8.3: billing verdicts only make sense for a month.
  if (isWholeFile) {
    return <span className="text-[var(--shale)]">Pick a month</span>;
  }
  if (row.creditEligible) {
    return (
      <span className="inline-flex items-center gap-2 text-[var(--fault)]">
        <span
          aria-hidden="true"
          className="inline-block h-[6px] w-[6px] bg-[var(--fault)]"
        />
        Credit due
      </span>
    );
  }
  return <span className="text-[var(--shale)]">Meets target</span>;
}
