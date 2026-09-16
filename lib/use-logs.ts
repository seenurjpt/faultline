"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import type { LogRow, Outcome, RejectedRow } from "./types";

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

function buildQuery(filters: LogsFilters, cursor: string | null): string {
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
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}

async function fetchPage(
  filters: LogsFilters,
  cursor: string | null,
): Promise<LogsPage | RejectedPage> {
  const query = buildQuery(filters, cursor);
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

export function useLogs(filters: LogsFilters) {
  return useInfiniteQuery({
    // Every filter is part of the key, so changing one starts a fresh page 1.
    queryKey: ["logs", filters],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => fetchPage(filters, pageParam),
    getNextPageParam: (last) => last.nextCursor,
    enabled: filters.datasetId.length > 0,
  });
}
