"use client";

import { useTransition } from "react";
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
  // Which flag a receipt drill-down narrowed to, so the view is shareable and
  // survives a reload like every other filter.
  flag: parseAsString,
  agent: parseAsString,
};

/**
 * The logs filters at rest. `mode` is deliberately absent: which date control
 * the user prefers is not a filter, and resetting it would move the UI under
 * them for no reason.
 */
export function clearedLogsFilters(): {
  date: null;
  from: null;
  to: null;
  services: string[];
  outcome: (typeof OUTCOME_VALUES)[number];
  flag: null;
  agent: null;
} {
  // A function, not a shared constant: the `services` array would otherwise be
  // handed to every caller, and one mutation would poison every later reset.
  return {
    date: null,
    from: null,
    to: null,
    services: [],
    outcome: "all",
    flag: null,
    agent: null,
  };
}

/**
 * `dataset` and `period` are read by the server component that renders the
 * overview, so they need `shallow: false`: the default shallow update changes
 * the URL in the browser only, which left the switcher label moving while the
 * verdict, ledger and ribbon kept the previous period's numbers.
 *
 * `stats` and `tz` are presentational and handled entirely on the client, so
 * they stay shallow and cost no round-trip.
 */
export function useDashboardState() {
  // The round-trip recomputes the whole overview against Neon, which on the
  // free tier can take a couple of seconds. Routing it through a transition
  // exposes `isPending`, so the switcher can say it is working instead of
  // looking like the click did nothing.
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useQueryStates(dashboardParsers, {
    history: "replace",
    shallow: false,
    startTransition,
  });
  return [state, setState, isPending] as const;
}

export function useViewState() {
  return useQueryStates(
    { stats: dashboardParsers.stats, tz: dashboardParsers.tz },
    { history: "replace" },
  );
}

/** Logs are fetched client-side, so these never need the server. */
export function useLogsState() {
  return useQueryStates(logsParsers, { history: "replace" });
}

export function useTz() {
  return useQueryState("tz", dashboardParsers.tz);
}

export function useStatsOpen() {
  return useQueryState("stats", dashboardParsers.stats);
}
