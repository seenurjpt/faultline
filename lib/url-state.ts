"use client";

import {
  parseAsArrayOf,
  parseAsBoolean,
  parseAsString,
  parseAsStringLiteral,
  useQueryState,
  useQueryStates,
} from "nuqs";

// SPEC §5.3: every piece of dashboard state lives in the URL, so a copied
// link reproduces the exact view.
export const TZ_VALUES = ["utc", "ist"] as const;
export const OUTCOME_VALUES = [
  "all",
  "failures",
  "slow",
  "flagged",
  "rejected",
] as const;
export const DATE_MODE_VALUES = ["day", "range"] as const;

export const dashboardParsers = {
  dataset: parseAsString.withDefault(""),
  period: parseAsString.withDefault("all"),
  stats: parseAsBoolean.withDefault(true),
  tz: parseAsStringLiteral(TZ_VALUES).withDefault("utc"),
};

export const logsParsers = {
  mode: parseAsStringLiteral(DATE_MODE_VALUES).withDefault("day"),
  date: parseAsString,
  from: parseAsString,
  to: parseAsString,
  services: parseAsArrayOf(parseAsString).withDefault([]),
  outcome: parseAsStringLiteral(OUTCOME_VALUES).withDefault("all"),
  agent: parseAsString,
};

export function useDashboardState() {
  return useQueryStates(dashboardParsers, { history: "replace" });
}

export function useLogsState() {
  return useQueryStates(logsParsers, { history: "replace" });
}

export function useTz() {
  return useQueryState("tz", dashboardParsers.tz);
}

export function useStatsOpen() {
  return useQueryState("stats", dashboardParsers.stats);
}
