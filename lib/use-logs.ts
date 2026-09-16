"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import type { LogRow, Outcome, RejectedRow } from "./types";

/** Page sizes offered in the picker. The API caps `limit` at 200. */
export const PAGE_SIZES = [10, 20, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 20;

export type LogsFilters = {
  datasetId: string;
  mode: "day" | "range";
  date: string | null;
  from: string | null;
  to: string | null;
  services: string[];
  outcome: Outcome;
  agent: string | null;
};

type LogsPage = {
  rows: LogRow[];
  nextCursor: string | null;
  total: number;
};

type RejectedPage = {
  rows: RejectedRow[];
  nextCursor: string | null;
  total: number;
};

export type ApiFailure = { error: string; message: string; details?: unknown };

function buildQuery(
  filters: LogsFilters,
  at: { cursor: string | null; offset: number },
  pageSize: number,
): string {
  const params = new URLSearchParams();
  // SPEC §11.3: date and from/to are mutually exclusive.
  if (filters.outcome !== "rejected") {
    if (filters.mode === "day" && filters.date) {
      params.set("date", filters.date);
    } else if (filters.mode === "range" && filters.from && filters.to) {
      params.set("from", filters.from);
      params.set("to", filters.to);
    }
  }
  if (filters.services.length > 0) {
    params.set("services", filters.services.join(","));
  }
  if (filters.outcome !== "all") params.set("outcome", filters.outcome);
  if (filters.agent) params.set("agent", filters.agent);
  // The API rejects both together: a cursor steps, an offset jumps.
  if (at.cursor) params.set("cursor", at.cursor);
  else if (at.offset > 0) params.set("offset", String(at.offset));
  params.set("limit", String(pageSize));
  return params.toString();
}

async function fetchPage(
  filters: LogsFilters,
  at: { cursor: string | null; offset: number },
  pageSize: number,
): Promise<LogsPage | RejectedPage> {
  const query = buildQuery(filters, at, pageSize);
  const response = await fetch(
    `/api/datasets/${filters.datasetId}/logs${query ? `?${query}` : ""}`,
    { headers: { Accept: "application/json" } },
  );

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiFailure;
    const error = new Error(body.message ?? "Couldn't load check records.");
    error.name = body.error ?? "logs_error";
    throw error;
  }

  return (await response.json()) as LogsPage | RejectedPage;
}

export type LogsPagination = {
  rows: (LogRow | RejectedRow)[];
  total: number;
  /** 1-based, for display. */
  page: number;
  pageCount: number;
  pageSize: PageSize;
  setPageSize: (size: PageSize) => void;
  /** Jump straight to a 1-based page number. */
  goToPage: (page: number) => void;
  /** Index of the first row on this page, 1-based; 0 when the page is empty. */
  firstRowNumber: number;
  hasPrev: boolean;
  hasNext: boolean;
  goPrev: () => void;
  goNext: () => void;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
};

/**
 * One page of check records at a time.
 *
 * The rows were previously accumulated with useInfiniteQuery and a "Load
 * more" button, which meant a filter matching 15,000 records could put every
 * one of them in the DOM. Only the current page is rendered now, so the row
 * count is bounded by PAGE_SIZE however large the result is.
 *
 * Paging is keyset, not OFFSET: each page is fetched with the cursor the
 * previous page returned, which is what keeps the query fast deep into a
 * large dataset. A keyset cursor only points forward, so going back is done
 * by remembering the cursor that produced each page rather than by asking the
 * server for a page number it has no way to seek to.
 */
/**
 * Where the pager currently is, and how it got there. `trail[i]` is the
 * cursor that produces page `i`, so `trail[0]` is always null. The filter key
 * travels with it: a position only means something for the result set it was
 * built against.
 *
 * A page reached by jumping has no cursor — nobody walked to it — so the
 * trail is abandoned and `index` alone identifies the page, fetched by
 * offset. Stepping on from there starts a fresh trail anchored at that page.
 */
export type PagePosition = {
  key: string;
  trail: (string | null)[];
  index: number;
  /** True when this page was jumped to and must be fetched by offset. */
  jumped: boolean;
};

export const firstPage = (key: string): PagePosition => ({
  key,
  trail: [null],
  index: 0,
  jumped: false,
});

/** The position to render for `key`, discarding a trail from other filters. */
export function positionFor(prev: PagePosition, key: string): PagePosition {
  return prev.key === key ? prev : firstPage(key);
}

/**
 * Appends the next page's cursor and steps onto it. Truncating at the current
 * index first keeps the trail honest when the user has stepped back and then
 * forward again through a changed result set.
 */
export function advance(
  prev: PagePosition,
  key: string,
  nextCursor: string,
): PagePosition {
  const base = positionFor(prev, key);
  // After a jump the trail has no entries for the pages that were skipped,
  // so it is padded to keep `trail[index]` meaning "the cursor for page
  // index". The holes are undefined rather than null: null would claim those
  // pages need no cursor, and retreat() reads them to decide whether it can
  // step back or must jump again.
  if (base.jumped) {
    const trail: (string | null)[] = new Array(base.index + 1);
    trail[0] = null;
    trail[base.index + 1] = nextCursor;
    return { key, trail, index: base.index + 1, jumped: false };
  }
  const trail = base.trail.slice(0, base.index + 1);
  trail.push(nextCursor);
  return { key, trail, index: base.index + 1, jumped: false };
}

/**
 * Steps back one page. After a jump there is no trail to walk back through,
 * so the previous page is itself reached by jumping.
 */
export function retreat(prev: PagePosition, key: string): PagePosition {
  if (prev.key !== key) return firstPage(key);
  const index = Math.max(0, prev.index - 1);
  if (prev.jumped || prev.trail[index] === undefined) {
    return index === 0
      ? firstPage(key)
      : { key, trail: [null], index, jumped: true };
  }
  return { ...prev, index, jumped: false };
}

/** Jumps straight to a 0-based page index, fetched by offset. */
export function jumpTo(
  prev: PagePosition,
  key: string,
  index: number,
): PagePosition {
  const target = Math.max(0, index);
  if (target === 0) return firstPage(key);
  const base = positionFor(prev, key);
  // Walking to an adjacent page keeps the cursor, which is cheaper than an
  // offset and is what Next/Previous already do.
  if (!base.jumped && base.trail[target] !== undefined) {
    return { ...base, index: target, jumped: false };
  }
  return { key, trail: [null], index: target, jumped: true };
}

export function useLogs(filters: LogsFilters): LogsPagination {
  // Any filter change invalidates the trail, because the cursors describe
  // positions within one specific result set.
  const filterKey = useMemo(
    () =>
      JSON.stringify([
        filters.datasetId,
        filters.mode,
        filters.date,
        filters.from,
        filters.to,
        [...filters.services].sort(),
        filters.outcome,
        filters.agent,
      ]),
    [filters],
  );

  const [pageSize, setSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);

  // The position and the filters it belongs to are one value, so a filter
  // change cannot leave a cursor from the previous result set behind.
  const [position, setPosition] = useState<PagePosition>(() =>
    firstPage(filterKey),
  );

  // Deriving rather than resetting in an effect: a stale key simply means
  // page 0 of the new filters, with no extra render in between.
  const current = positionFor(position, filterKey);

  // A jumped-to page has no cursor, so it is fetched by offset. Everything
  // else steps with the cursor the previous page handed back.
  const at = current.jumped
    ? { cursor: null, offset: current.index * pageSize }
    : { cursor: current.trail[current.index] ?? null, offset: 0 };

  const query = useQuery({
    queryKey: ["logs", filterKey, pageSize, at.cursor, at.offset],
    queryFn: () => fetchPage(filters, at, pageSize),
    enabled: filters.datasetId.length > 0,
    // Holds the page already on screen while the next one loads, so the table
    // does not collapse to a skeleton on every step.
    placeholderData: keepPreviousData,
  });

  const nextCursor = query.data?.nextCursor ?? null;
  const total = query.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const rows = (query.data?.rows ?? []) as (LogRow | RejectedRow)[];

  const goPrev = useCallback(() => {
    setPosition((prev) => retreat(prev, filterKey));
  }, [filterKey]);

  // The cursor for the next page is appended at the moment of navigating,
  // which is the only time it is needed and keeps the trail out of effects.
  // Without one — the last page of a filtered set — there is nowhere to go.
  const goNext = useCallback(() => {
    setPosition((prev) => {
      const base = positionFor(prev, filterKey);
      if (nextCursor) return advance(base, filterKey, nextCursor);
      return base;
    });
  }, [filterKey, nextCursor]);

  const goToPage = useCallback(
    (page: number) => {
      setPosition((prev) => jumpTo(prev, filterKey, page - 1));
    },
    [filterKey],
  );

  // Changing the page size changes what "page 3" means, so the only honest
  // landing place is the first page.
  const setPageSize = useCallback(
    (size: PageSize) => {
      setSize(size);
      setPosition(firstPage(filterKey));
    },
    [filterKey],
  );

  return {
    rows,
    total,
    page: current.index + 1,
    pageCount,
    pageSize,
    setPageSize,
    goToPage,
    firstRowNumber: rows.length === 0 ? 0 : current.index * pageSize + 1,
    hasPrev: current.index > 0,
    // The API returns a cursor whenever it handed back exactly `limit` rows,
    // including for a page reached by jumping, so this is true wherever the
    // user landed.
    hasNext: nextCursor !== null,
    goPrev,
    goNext,
    isPending: query.isPending,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}
