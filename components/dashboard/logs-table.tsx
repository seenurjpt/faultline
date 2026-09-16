"use client";

import { Fragment, useState } from "react";
import { CaretDown } from "@phosphor-icons/react";
import type { LogRow, RejectedRow, Tz } from "@/lib/types";
import {
  FLAG_EXPLANATIONS,
  FLAG_LABELS,
  REJECTION_REASONS,
  formatNumber,
  formatRowTime,
} from "@/lib/format";
import { Button, Chip, Skeleton, cx } from "../ui/primitives";

function FlagChips({ flags }: { flags: string[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {flags.map((flag) => (
        <Chip
          key={flag}
          title={FLAG_EXPLANATIONS[flag]}
          tone={flag === "status_conflict_same_agent" ? "warn" : "neutral"}
        >
          {FLAG_LABELS[flag] ?? flag}
        </Chip>
      ))}
    </span>
  );
}

export function LogsTable({
  rows,
  tz,
  withYear,
  loading,
  total,
  hasMore,
  loadingMore,
  onLoadMore,
  onClearFilters,
  emptyMessage,
}: {
  rows: LogRow[];
  tz: Tz;
  withYear: boolean;
  loading: boolean;
  total: number;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onClearFilters: () => void;
  emptyMessage: string;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (loading) return <TableSkeleton />;

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 py-8">
        <p className="text-[15px] leading-[22px]">{emptyMessage}</p>
        <Button kind="secondary" onClick={onClearFilters}>
          Clear filters
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Desktop: the full table. */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full border-collapse text-[13px] leading-[18px]">
          <thead className="sticky top-0 z-10 bg-[var(--paper)]">
            <tr className="border-b border-[var(--rule)]">
              <th scope="col" className="py-2 text-left font-medium text-[var(--shale)]">
                Time ({tz === "ist" ? "IST" : "UTC"})
              </th>
              <th scope="col" className="py-2 text-left font-medium text-[var(--shale)]">
                Service
              </th>
              <th scope="col" className="py-2 text-left font-medium text-[var(--shale)]">
                Agent
              </th>
              <th scope="col" className="py-2 text-right font-medium text-[var(--shale)]">
                Status
              </th>
              <th scope="col" className="py-2 text-right font-medium text-[var(--shale)]">
                Latency
              </th>
              <th scope="col" className="py-2 text-left font-medium text-[var(--shale)]">
                Flags
              </th>
              <th scope="col" className="w-10 py-2">
                <span className="sr-only-table">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const key = `${row.checkedAt}-${row.serviceId}-${row.agent}`;
              const open = expanded === key;
              const down = row.outcome === "down";
              return (
                <Fragment key={key}>
                  <tr className="border-b border-[var(--rule)]">
                    <td
                      className={cx(
                        "py-2 pr-3 tnum whitespace-nowrap",
                        // DESIGN §6.8: down rows carry a 3px fault left rule.
                        down && "border-l-[3px] border-[var(--fault)] pl-2",
                      )}
                    >
                      {formatRowTime(row.checkedAt, tz, withYear)}
                    </td>
                    <td className="py-2 pr-3">{row.serviceName}</td>
                    <td className="py-2 pr-3 text-[var(--shale)]">{row.agent}</td>
                    <td
                      className={cx(
                        "py-2 pr-3 text-right tnum",
                        down && "font-semibold text-[var(--fault)]",
                      )}
                    >
                      {row.statusCode}
                    </td>
                    <td
                      className={cx(
                        "py-2 pr-3 text-right tnum whitespace-nowrap",
                        row.slow && "text-[var(--ochre-ink)]",
                      )}
                    >
                      {row.latencyMs === null
                        ? "—"
                        : `${formatNumber(row.latencyMs)} ms`}
                    </td>
                    <td className="py-2 pr-3">
                      <FlagChips flags={row.flags} />
                    </td>
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => setExpanded(open ? null : key)}
                        aria-expanded={open}
                        aria-label={`Details for ${row.serviceName} at ${formatRowTime(row.checkedAt, tz, withYear)}`}
                        className="inline-flex h-10 w-10 items-center justify-center text-[var(--shale)] hover:text-[var(--basalt)]"
                      >
                        <CaretDown
                          size={13}
                          weight="bold"
                          className={cx(
                            "transition-transform",
                            open && "rotate-180",
                          )}
                        />
                      </button>
                    </td>
                  </tr>
                  {open && (
                    <tr className="border-b border-[var(--rule)] bg-[var(--fog)]">
                      <td colSpan={7} className="px-2 py-3">
                        <RowDetail row={row} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Under 720px: stacked rows — time + status, then service + latency. */}
      <ul className="sm:hidden">
        {rows.map((row) => {
          const key = `${row.checkedAt}-${row.serviceId}-${row.agent}`;
          const open = expanded === key;
          const down = row.outcome === "down";
          return (
            <li
              key={key}
              className={cx(
                "border-b border-[var(--rule)] py-3 pl-2",
                down && "border-l-[3px] border-l-[var(--fault)]",
              )}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="tnum text-[15px] leading-[22px]">
                  {formatRowTime(row.checkedAt, tz, withYear)}
                </span>
                <span
                  className={cx(
                    "tnum text-[15px] leading-[22px]",
                    down && "font-semibold text-[var(--fault)]",
                  )}
                >
                  {row.statusCode}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3 text-[13px] leading-[18px] text-[var(--shale)]">
                <span>
                  {row.serviceName} · {row.agent}
                </span>
                <span className={cx("tnum", row.slow && "text-[var(--ochre-ink)]")}>
                  {row.latencyMs === null
                    ? "—"
                    : `${formatNumber(row.latencyMs)} ms`}
                </span>
              </div>
              {row.flags.length > 0 && (
                <div className="mt-2">
                  <FlagChips flags={row.flags} />
                </div>
              )}
              <button
                type="button"
                onClick={() => setExpanded(open ? null : key)}
                aria-expanded={open}
                className="mt-1 inline-flex min-h-10 items-center gap-1 text-[13px] leading-[18px] text-[var(--tide)]"
              >
                {open ? "Hide details" : "Details"}
                <CaretDown
                  size={10}
                  weight="bold"
                  className={cx("transition-transform", open && "rotate-180")}
                />
              </button>
              {open && (
                <div className="mt-2">
                  <RowDetail row={row} />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col items-center gap-3 pt-2">
        <p className="text-[13px] leading-[18px] text-[var(--shale)] tnum">
          Showing {formatNumber(rows.length)} of {formatNumber(total)}
        </p>
        {hasMore && (
          <Button kind="secondary" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Load more records"}
          </Button>
        )}
      </div>
    </div>
  );
}

function RowDetail({ row }: { row: LogRow }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px] leading-[18px]">
      <dt className="text-[var(--shale)]">Raw timestamp</dt>
      <dd className="tnum">{row.rawTimestamp}</dd>
      <dt className="text-[var(--shale)]">Source</dt>
      <dd className="tnum">Line {formatNumber(row.sourceLine)} in the file</dd>
      <dt className="text-[var(--shale)]">Region</dt>
      <dd>{row.region ?? "—"}</dd>
      {row.flags.length > 0 && (
        <>
          <dt className="text-[var(--shale)]">Notes</dt>
          <dd>
            <ul className="flex flex-col gap-1">
              {row.flags.map((flag) => (
                <li key={flag}>{FLAG_EXPLANATIONS[flag] ?? flag}</li>
              ))}
            </ul>
          </dd>
        </>
      )}
    </dl>
  );
}

/** DESIGN §6.8: the rejected view swaps in its own three columns. */
export function RejectedTable({
  rows,
  loading,
}: {
  rows: RejectedRow[];
  loading: boolean;
}) {
  if (loading) return <TableSkeleton />;

  if (rows.length === 0) {
    return (
      <p className="py-8 text-[15px] leading-[22px]">
        No rows were rejected in this file.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px] leading-[18px]">
        <thead>
          <tr className="border-b border-[var(--rule)]">
            <th scope="col" className="py-2 text-left font-medium text-[var(--shale)]">
              Line
            </th>
            <th scope="col" className="py-2 text-left font-medium text-[var(--shale)]">
              Reason
            </th>
            <th scope="col" className="py-2 text-left font-medium text-[var(--shale)]">
              Raw row
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.lineNumber} className="border-b border-[var(--rule)]">
              <td className="py-2 pr-3 tnum align-top whitespace-nowrap">
                {formatNumber(row.lineNumber)}
              </td>
              <td className="py-2 pr-3 align-top">
                {REJECTION_REASONS[row.reason] ?? row.reason}
              </td>
              <td className="py-2 align-top text-[var(--shale)] [word-break:break-all]">
                {row.rawLine}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="flex flex-col gap-3 py-2" aria-hidden="true">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-3 w-full" />
      ))}
    </div>
  );
}
