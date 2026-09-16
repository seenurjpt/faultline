"use client";

import { Fragment, useState } from "react";
import * as Select from "@radix-ui/react-select";
import { CaretDown, CaretLeft, CaretRight, Check } from "@phosphor-icons/react";
import type { LogRow, RejectedRow, Tz } from "@/lib/types";
import { PAGE_SIZES, type PageSize } from "@/lib/use-logs";
import { pageItems } from "@/lib/page-items";
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

type LogsTableProps = {
  rows: LogRow[];
  tz: Tz;
  withYear: boolean;
  loading: boolean;
  total: number;
  page: number;
  pageCount: number;
  pageSize: PageSize;
  onPageSize: (size: PageSize) => void;
  onGoToPage: (page: number) => void;
  firstRowNumber: number;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  /** A page change is in flight; the previous page stays on screen. */
  paging: boolean;
  onClearFilters: () => void;
  emptyMessage: string;
};

export function LogsTable(props: LogsTableProps) {
  // A new page is a new set of rows, so a detail row left open on the
  // previous page must not stay open against unrelated data. Keying the inner
  // component to the page discards that state on a page change, which is what
  // an effect would otherwise have to do after the fact.
  return <LogsTableRows key={props.page} {...props} />;
}

function LogsTableRows({
  rows,
  tz,
  withYear,
  loading,
  total,
  page,
  pageCount,
  pageSize,
  onPageSize,
  onGoToPage,
  firstRowNumber,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  paging,
  onClearFilters,
  emptyMessage,
}: LogsTableProps) {
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
          <thead className="sticky top-[var(--top-bar-h,0px)] z-10 bg-[var(--paper)]">
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

      <Pager
        rangeStart={firstRowNumber}
        rangeEnd={firstRowNumber + rows.length - 1}
        total={total}
        page={page}
        pageCount={pageCount}
        pageSize={pageSize}
        onPageSize={onPageSize}
        onGoToPage={onGoToPage}
        hasPrev={hasPrev}
        hasNext={hasNext}
        onPrev={onPrev}
        onNext={onNext}
        busy={paging}
      />
    </div>
  );
}

/**
 * DESIGN §6.8: one page at a time, so the row count in the DOM stays bounded
 * however many records match. The counts name the actual rows on screen
 * rather than a running total, because "1–20 of 15,551" is what tells someone
 * where they are.
 */
function Pager({
  rangeStart,
  rangeEnd,
  total,
  page,
  pageCount,
  pageSize,
  onPageSize,
  onGoToPage,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  busy,
}: {
  rangeStart: number;
  rangeEnd: number;
  total: number;
  page: number;
  pageCount: number;
  pageSize: PageSize;
  onPageSize: (size: PageSize) => void;
  onGoToPage: (page: number) => void;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  busy: boolean;
}) {
  const items = pageItems(page, pageCount);

  return (
    <nav
      aria-label="Check record pages"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-[var(--rule)] pt-4"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-[13px] leading-[18px] text-[var(--shale)] tnum">
          {formatNumber(rangeStart)}–{formatNumber(rangeEnd)} of{" "}
          {formatNumber(total)}
        </p>
        <PageSizeSelect value={pageSize} onChange={onPageSize} disabled={busy} />
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <Button
          kind="secondary"
          onClick={onPrev}
          disabled={!hasPrev || busy}
          aria-label="Previous page"
          className="px-2"
        >
          <CaretLeft size={13} weight="bold" />
          <span className="hidden sm:inline">Previous</span>
        </Button>

        {items.map((item, i) =>
          item === null ? (
            <span
              key={`gap-${i}`}
              aria-hidden="true"
              className="px-1 text-[13px] leading-[18px] text-[var(--shale)]"
            >
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              onClick={() => onGoToPage(item)}
              disabled={busy}
              aria-label={`Page ${item}`}
              aria-current={item === page ? "page" : undefined}
              className={cx(
                "inline-flex h-10 min-w-10 items-center justify-center rounded-[var(--radius-field)] px-2",
                "text-[13px] leading-[18px] tnum transition-colors",
                "disabled:opacity-50 disabled:pointer-events-none",
                item === page
                  ? "bg-[var(--tide)] font-medium text-[var(--paper)]"
                  : "text-[var(--shale)] hover:bg-[var(--fog)] hover:text-[var(--basalt)]",
              )}
            >
              {item}
            </button>
          ),
        )}

        <Button
          kind="secondary"
          onClick={onNext}
          disabled={!hasNext || busy}
          aria-label="Next page"
          className="px-2"
        >
          <span className="hidden sm:inline">Next</span>
          <CaretRight size={13} weight="bold" />
        </Button>
      </div>

      {/* Screen readers get the page change announced; the visual cue is the
          buttons going disabled while the request is in flight. */}
      <p aria-live="polite" className="sr-only-table">
        {busy ? "Loading page…" : `Page ${page} of ${pageCount}.`}
      </p>
    </nav>
  );
}

function PageSizeSelect({
  value,
  onChange,
  disabled,
}: {
  value: PageSize;
  onChange: (size: PageSize) => void;
  disabled: boolean;
}) {
  return (
    <Select.Root
      value={String(value)}
      onValueChange={(v) => onChange(Number(v) as PageSize)}
      disabled={disabled}
    >
      <Select.Trigger
        aria-label="Records per page"
        className={cx(
          "inline-flex min-h-10 items-center gap-2 rounded-[var(--radius-field)]",
          "border border-[var(--rule)] bg-[var(--paper)] px-3",
          "text-[13px] leading-[18px] hover:border-[var(--shale)] transition-colors",
          "disabled:opacity-50 disabled:pointer-events-none",
        )}
      >
        <Select.Value />
        <span className="text-[var(--shale)]">per page</span>
        <Select.Icon className="text-[var(--shale)]">
          <CaretDown size={13} weight="bold" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          className="z-50 overflow-hidden rounded-[var(--radius-field)] border border-[var(--rule)] bg-[var(--paper)] p-1"
          position="popper"
          sideOffset={4}
        >
          <Select.Viewport>
            {PAGE_SIZES.map((size) => (
              <Select.Item
                key={size}
                value={String(size)}
                className="relative flex cursor-default select-none items-center rounded-[4px] py-2 pl-8 pr-3 text-[15px] leading-[22px] tnum outline-none data-[highlighted]:bg-[var(--fog)]"
              >
                <Select.ItemIndicator className="absolute left-2">
                  <Check size={14} weight="bold" />
                </Select.ItemIndicator>
                <Select.ItemText>{size}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
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
  total,
  page,
  pageCount,
  pageSize,
  onPageSize,
  onGoToPage,
  firstRowNumber,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  paging,
}: {
  rows: RejectedRow[];
  loading: boolean;
  total: number;
  page: number;
  pageCount: number;
  pageSize: PageSize;
  onPageSize: (size: PageSize) => void;
  onGoToPage: (page: number) => void;
  firstRowNumber: number;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  paging: boolean;
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
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px] leading-[18px]">
        <thead className="sticky top-[var(--top-bar-h,0px)] z-10 bg-[var(--paper)]">
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

      <Pager
        rangeStart={firstRowNumber}
        rangeEnd={firstRowNumber + rows.length - 1}
        total={total}
        page={page}
        pageCount={pageCount}
        pageSize={pageSize}
        onPageSize={onPageSize}
        onGoToPage={onGoToPage}
        hasPrev={hasPrev}
        hasNext={hasNext}
        onPrev={onPrev}
        onNext={onNext}
        busy={paging}
      />
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
