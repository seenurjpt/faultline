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
  if (flags.length === 0) {
    return (
      <span className="text-[var(--shale)]" aria-label="No notes">
        —
      </span>
    );
  }
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

  if (loading) return <TableSkeleton rows={pageSize} />;

  if (rows.length === 0) {
    // An empty page with records behind it means the user is past the end —
    // filtering down while on a deep page does that. Offering only "clear
    // filters" would strand them, so the way back to page 1 is offered too.
    const strandedPastEnd = total > 0 && page > 1;
    return (
      <div className="flex flex-col items-start gap-3 py-8">
        <p className="text-[15px] leading-[22px]">
          {strandedPastEnd
            ? `Page ${formatNumber(page)} is past the end of these ${formatNumber(total)} records.`
            : emptyMessage}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {strandedPastEnd ? (
            <Button kind="secondary" onClick={() => onGoToPage(1)}>
              Back to page 1
            </Button>
          ) : (
            <Button kind="secondary" onClick={onClearFilters}>
              Clear filters
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* While a page is in flight the rows already on screen stay put and
          dim slightly, rather than vanishing. Replacing them with a skeleton
          on every click made paging feel like a reload; leaving them with no
          signal at all made it feel like nothing had happened. */}
      <div
        className={cx(
          "flex flex-col gap-4 transition-opacity duration-150",
          paging && "pointer-events-none opacity-60",
        )}
        aria-busy={paging}
      >
      {/* Desktop: the full table. */}
      <div className="hidden sm:block">
        <table className="w-full table-fixed border-collapse text-[13px] leading-[18px]">
          <thead className="sticky top-[var(--top-bar-h,0px)] z-20 bg-[var(--paper)]">
            <tr className="border-b border-[var(--rule)]">
              <th
                scope="col"
                className="w-[14%] py-2 pl-2 pr-3 text-left font-medium text-[var(--shale)] whitespace-nowrap"
              >
                Time ({tz === "ist" ? "IST" : "UTC"})
              </th>
              <th
                scope="col"
                className="w-[18%] py-2 pr-3 text-left font-medium text-[var(--shale)] whitespace-nowrap"
              >
                Service
              </th>
              <th
                scope="col"
                className="w-[12%] py-2 pr-3 text-left font-medium text-[var(--shale)] whitespace-nowrap"
              >
                Agent
              </th>
              <th
                scope="col"
                className="w-[8%] py-2 pr-3 text-right font-medium text-[var(--shale)]"
              >
                Status
              </th>
              <th
                scope="col"
                className="w-[12%] py-2 pr-6 text-right font-medium text-[var(--shale)]"
              >
                Latency
              </th>
              {/* Flags takes whatever is left once the fixed columns have
                  what they need, so chips wrap inside this column rather
                  than squeezing the service and agent names. */}
              <th
                scope="col"
                className="w-[33%] py-2 pr-3 text-left font-medium text-[var(--shale)]"
              >
                Flags
              </th>
              <th scope="col" className="w-[3%] py-2">
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
                  <tr
                    onClick={() => setExpanded(open ? null : key)}
                    className={cx(
                      "cursor-pointer border-b border-[var(--rule)] transition-colors",
                      open ? "bg-[var(--fog)]" : "hover:bg-[var(--fog)]",
                    )}
                  >
                    <td
                      className={cx(
                        "py-2 pr-3 pl-2 tnum whitespace-nowrap",
                        // DESIGN §6.8: down rows carry a 3px fault left rule.
                        // Drawn as an inset shadow rather than a border: in a
                        // border-collapse table, adjacent rows' left borders
                        // merge into one continuous bar detached from the rows.
                        down &&
                          "shadow-[inset_3px_0_0_0_var(--fault)]",
                      )}
                    >
                      {formatRowTime(row.checkedAt, tz, withYear)}
                    </td>
                    <td
                      className="truncate py-2 pr-3"
                      title={row.serviceName}
                    >
                      {row.serviceName}
                    </td>
                    <td
                      className="truncate py-2 pr-3 text-[var(--shale)]"
                      title={row.agent}
                    >
                      {row.agent}
                    </td>
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
                        "py-2 pr-6 text-right tnum whitespace-nowrap",
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
                        onClick={(e) => {
                          // The row already handles this; without stopping
                          // here the toggle would fire twice and cancel out.
                          e.stopPropagation();
                          setExpanded(open ? null : key);
                        }}
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
                      <td colSpan={7} className="overflow-hidden px-2 py-3">
                        <div className="row-detail">
                          <RowDetail row={row} />
                        </div>
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
              onClick={() => setExpanded(open ? null : key)}
              className={cx(
                "cursor-pointer border-b border-[var(--rule)] py-3 pl-3 transition-colors",
                open && "bg-[var(--fog)]",
                down && "shadow-[inset_3px_0_0_0_var(--fault)]",
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
                onClick={(e) => {
                  // The card already handles this; see the desktop row.
                  e.stopPropagation();
                  setExpanded(open ? null : key);
                }}
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
                <div className="row-detail mt-2">
                  <RowDetail row={row} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
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
  // A narrow screen fits far fewer numbers than a wide one, so it gets a
  // tighter window. Both lists are built the same way, and the wide one is
  // simply hidden below `sm` rather than measured at runtime.
  const narrowItems = pageItems(page, pageCount, 0);
  const wideItems = pageItems(page, pageCount, 1);

  const numberClass = (active: boolean) =>
    cx(
      "inline-flex h-9 min-w-9 shrink-0 items-center justify-center rounded-[var(--radius-field)] px-1.5",
      "text-[13px] leading-[18px] tnum transition-colors",
      "disabled:opacity-50 disabled:pointer-events-none",
      active
        ? "bg-[var(--tide)] font-medium text-[var(--paper)]"
        : "text-[var(--shale)] hover:bg-[var(--fog)] hover:text-[var(--basalt)]",
    );

  const arrowClass =
    "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-field)] " +
    "border border-[var(--rule)] text-[var(--shale)] transition-colors " +
    "hover:border-[var(--shale)] hover:text-[var(--basalt)] " +
    "disabled:opacity-40 disabled:pointer-events-none";

  const numbers = (items: (number | null)[]) =>
    items.map((item, i) =>
      item === null ? (
        <span
          key={`gap-${i}`}
          aria-hidden="true"
          className="shrink-0 px-0.5 text-[13px] leading-[18px] text-[var(--shale)]"
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
          className={numberClass(item === page)}
        >
          {item}
        </button>
      ),
    );

  return (
    <nav
      aria-label="Check record pages"
      className="flex flex-col gap-3 border-t border-[var(--rule)] pt-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
    >
      {/* Count and page size read as one sentence and stay on one line. */}
      <div className="flex min-w-0 items-center gap-3">
        <p className="shrink-0 text-[13px] leading-[18px] text-[var(--shale)] tnum">
          {formatNumber(rangeStart)}–{formatNumber(rangeEnd)} of{" "}
          {formatNumber(total)}
        </p>
        <PageSizeSelect value={pageSize} onChange={onPageSize} disabled={busy} />
      </div>

      {/* Never wraps: Next dropping onto its own line put the two arrows on
          opposite sides of the control. */}
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onPrev}
          disabled={!hasPrev || busy}
          aria-label="Previous page"
          className={arrowClass}
        >
          <CaretLeft size={13} weight="bold" />
        </button>

        <div className="flex items-center gap-1 sm:hidden">
          {numbers(narrowItems)}
        </div>
        <div className="hidden items-center gap-1 sm:flex">
          {numbers(wideItems)}
        </div>

        <button
          type="button"
          onClick={onNext}
          disabled={!hasNext || busy}
          aria-label="Next page"
          className={arrowClass}
        >
          <CaretRight size={13} weight="bold" />
        </button>
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
  if (loading) return <TableSkeleton rows={pageSize} />;

  if (rows.length === 0) {
    return (
      <p className="py-8 text-[15px] leading-[22px]">
        No rows were rejected in this file.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
      <table className="w-full border-collapse text-[13px] leading-[18px]">
        <thead className="sticky top-[var(--top-bar-h,0px)] z-20 bg-[var(--paper)]">
          <tr className="border-b border-[var(--rule)]">
            <th
              scope="col"
              className="w-[10%] py-2 pr-3 text-left font-medium text-[var(--shale)] whitespace-nowrap"
            >
              Line
            </th>
            <th
              scope="col"
              className="w-[22%] py-2 pr-3 text-left font-medium text-[var(--shale)] whitespace-nowrap"
            >
              Reason
            </th>
            {/* Raw rows are long, so this column takes the leftover width. */}
            <th
              scope="col"
              className="w-full py-2 text-left font-medium text-[var(--shale)]"
            >
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

/**
 * Stands in for the rows that are loading. It claims the height the real
 * rows will take, so applying a filter does not collapse the panel and jerk
 * the page up under the reader — `rows` is the page size, not a fixed 8.
 */
function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div
      className="flex flex-col gap-3 py-2"
      aria-hidden="true"
      // Very large pages would otherwise paint hundreds of shimmering bars,
      // which is slower and noisier than the table it stands in for.
      style={{ minHeight: `${Math.min(rows, 12) * 33}px` }}
    >
      {Array.from({ length: Math.min(rows, 12) }).map((_, i) => (
        <Skeleton key={i} className="h-3 w-full" />
      ))}
    </div>
  );
}
