"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import * as Collapsible from "@radix-ui/react-collapsible";
import { CaretDown } from "@phosphor-icons/react";
import type {
  DatasetSummary,
  Incident,
  LogRow,
  Outcome,
  Overview,
  RejectedRow,
} from "@/lib/types";
import { Panel, PanelTitle, InlineError, cx } from "../ui/primitives";
import { TopBar } from "./top-bar";
import { FaultRibbon } from "./fault-ribbon";
import { ServiceLedger } from "./service-ledger";
import { IncidentsList } from "./incidents-list";
import { DataReceipt } from "./data-receipt";
import { FilterBar, type FilterState } from "./filter-bar";
import { LogsTable, RejectedTable } from "./logs-table";
import { UploadModal } from "../upload/upload-modal";
import { useDashboardState, useLogsState } from "@/lib/url-state";
import { useLogs } from "@/lib/use-logs";
import { formatDate, formatNumber, parseUtcDayKey } from "@/lib/format";

export function DashboardView({
  datasets,
  overview,
  agents,
}: {
  datasets: DatasetSummary[];
  overview: Overview;
  agents: string[];
}) {
  const [dash, setDash] = useDashboardState();
  const [filters, setFilters] = useLogsState();
  const [highlight, setHighlight] = useState<string | null>(null);
  const [pulse, setPulse] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const logsRef = useRef<HTMLDivElement>(null);

  const isWholeFile = overview.period.key === "all";
  const { headline, period, quality } = overview;

  // Logs are fetched client-side with keyset pagination, so paging never
  // re-renders the (expensive) overview above.
  const logsQuery = useLogs({
    datasetId: overview.dataset.id,
    mode: filters.mode,
    date: filters.date,
    from: filters.from,
    to: filters.to,
    services: filters.services,
    outcome: filters.outcome,
    agent: filters.agent,
  });

  const pages = logsQuery.data?.pages ?? [];
  const logsTotal = pages[0]?.total ?? 0;
  // The endpoint returns check rows or rejected rows depending on `outcome`,
  // so which shape came back is decided by the filter, not by inspection.
  const fetchedRows: (LogRow | RejectedRow)[] = pages.flatMap(
    (p) => p.rows as (LogRow | RejectedRow)[],
  );
  const logRows =
    filters.outcome === "rejected" ? [] : (fetchedRows as LogRow[]);
  const rejectedRows =
    filters.outcome === "rejected" ? (fetchedRows as RejectedRow[]) : [];

  // DESIGN §6.2: the coverage warning appears below 99%.
  const lowCoverage = quality.coveragePct < 99;

  const verdict = isWholeFile
    ? `Across the whole file, ${headline.servicesBelowTarget} of ${headline.servicesTotal} services are below 99.9%. Billing is monthly, so pick a month for credit decisions.`
    : `${headline.servicesBelowTarget} of ${headline.servicesTotal} services missed 99.9% in ${period.label}.`;

  const measuredNote =
    period.measuredDays !== undefined && period.monthDays !== undefined
      ? `Data covers ${period.measuredDays} of ${period.monthDays} days.`
      : null;

  const scrollToLogs = useCallback(() => {
    logsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setPulse(true);
    window.setTimeout(() => setPulse(false), 800);
  }, []);

  // DESIGN §6.3: clicking the ribbon filters the logs to that day and service.
  const selectFromRibbon = useCallback(
    (serviceId: string, utcDay: string) => {
      setFilters({
        mode: "day",
        date: utcDay,
        from: null,
        to: null,
        services: [serviceId],
        outcome: "failures",
      });
      scrollToLogs();
    },
    [setFilters, scrollToLogs],
  );

  const selectIncident = useCallback(
    (incident: Incident) => {
      const start = new Date(incident.start);
      const day = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}-${String(start.getUTCDate()).padStart(2, "0")}`;
      setFilters({
        mode: "day",
        date: day,
        from: null,
        to: null,
        services: [incident.serviceId],
        outcome: "failures",
      });
      scrollToLogs();
    },
    [setFilters, scrollToLogs],
  );

  const filterState: FilterState = {
    mode: filters.mode,
    date: filters.date,
    from: filters.from,
    to: filters.to,
    services: filters.services,
    outcome: filters.outcome,
    agent: filters.agent,
  };

  const datasetSpansYears =
    new Date(overview.dataset.rangeStart).getUTCFullYear() !==
    new Date(overview.dataset.rangeEnd).getUTCFullYear();

  // DESIGN §7: the empty state names the filters that produced it.
  const emptyMessage = useMemo(() => {
    const parts: string[] = [];
    if (filters.date) parts.push(formatDate(parseUtcDayKey(filters.date)));
    else if (filters.from && filters.to)
      parts.push(
        `${formatDate(parseUtcDayKey(filters.from))} – ${formatDate(parseUtcDayKey(filters.to))}`,
      );
    for (const id of filters.services) {
      const svc = overview.ledger.find((l) => l.serviceId === id);
      if (svc) parts.push(svc.serviceName);
    }
    if (filters.outcome === "failures") parts.push("failures only");
    else if (filters.outcome === "slow") parts.push("slow checks only");
    else if (filters.outcome === "flagged") parts.push("checks with notes only");
    if (filters.agent) parts.push(filters.agent);
    return parts.length > 0
      ? `No check records match: ${parts.join(", ")}.`
      : "No check records match these filters.";
  }, [filters, overview.ledger]);

  const baselineRatioAbove = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const row of overview.ledger) {
      map[row.serviceId] =
        row.p95LatencyMs !== null &&
        row.p50LatencyMs !== null &&
        row.p95LatencyMs > 2 * row.p50LatencyMs;
    }
    return map;
  }, [overview.ledger]);

  // The URL deliberately does not get a `dataset` value written into it on
  // load. The server already falls back to the newest dataset when the param
  // is absent, and writing it here raced with navigation: opening a freshly
  // uploaded dataset would be overwritten by the id of the page still on
  // screen. The switcher sets it explicitly when the user picks one.

  const isRejectedView = filters.outcome === "rejected";

  return (
    <>
      <TopBar
        datasets={datasets}
        periods={overview.periods}
        onUploadClick={() => setUploadOpen(true)}
      />

      <UploadModal open={uploadOpen} onOpenChange={setUploadOpen} />

      <main className="mx-auto w-full min-w-0 max-w-[1360px] flex-1 overflow-x-clip px-4 pb-16 sm:px-8">
        <Collapsible.Root
          open={dash.stats}
          onOpenChange={(open) => setDash({ stats: open })}
          className="pt-8"
        >
          {/* DESIGN §6.2: the verdict sentence is the hero and always stays. */}
          <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3">
            <div className="max-w-[60ch]">
              <h1 className="font-display text-[29px] leading-[36px] font-semibold">
                {verdict}
              </h1>
              <p className="mt-1 text-[15px] leading-[22px] text-[var(--shale)]">
                {headline.confirmedIncidents === 1
                  ? "1 confirmed incident."
                  : `${headline.confirmedIncidents} confirmed incidents.`}{" "}
                {measuredNote}
                {lowCoverage && (
                  <span className="text-[var(--ochre-ink)]">
                    {" "}
                    Some slots have no data; see the receipt.
                  </span>
                )}
              </p>
            </div>

            <Collapsible.Trigger className="inline-flex min-h-10 items-center gap-2 text-[15px] leading-[22px] text-[var(--tide)] hover:underline underline-offset-4">
              {dash.stats ? "Hide findings" : "Show findings"}
              <CaretDown
                size={13}
                weight="bold"
                className={cx(
                  "transition-transform duration-200",
                  dash.stats && "rotate-180",
                )}
              />
            </Collapsible.Trigger>
          </div>

          <Collapsible.Content className="overflow-hidden data-[state=closed]:animate-none">
            <div className="mt-6 flex min-w-0 flex-col gap-6">
              <Panel className="min-w-0 p-4 sm:p-6">
                <FaultRibbon
                  ribbon={overview.ribbon}
                  incidents={overview.incidents}
                  tz={dash.tz}
                  onSelect={selectFromRibbon}
                  highlightIncident={highlight}
                />
              </Panel>

              {/* Ledger and incidents share a row; incidents drop below at 1200px. */}
              <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-12">
                <Panel className="min-w-0 p-4 sm:p-6 xl:col-span-8">
                  <PanelTitle>Service ledger</PanelTitle>
                  <div className="mt-3">
                    <ServiceLedger
                      rows={overview.ledger}
                      isWholeFile={isWholeFile}
                      baselineRatioAbove={baselineRatioAbove}
                      onServiceClick={(serviceId) => {
                        setFilters({ services: [serviceId] });
                        scrollToLogs();
                      }}
                    />
                  </div>
                </Panel>

                <Panel className="min-w-0 p-4 sm:p-6 xl:col-span-4">
                  <PanelTitle
                    count={overview.incidents.filter((i) => i.confirmed).length}
                  >
                    Incidents
                  </PanelTitle>
                  <div className="mt-3">
                    <IncidentsList
                      incidents={overview.incidents}
                      periodLabel={period.label}
                      tz={dash.tz}
                      onHover={setHighlight}
                      onSelect={selectIncident}
                    />
                  </div>
                </Panel>
              </div>

              <Panel className="min-w-0 p-4 sm:p-6">
                <PanelTitle>Data receipt</PanelTitle>
                <div className="mt-3">
                  <DataReceipt
                    quality={quality}
                    onFilter={(outcome: Outcome) => {
                      setFilters({ outcome });
                      scrollToLogs();
                    }}
                  />
                </div>
              </Panel>
            </div>
          </Collapsible.Content>
        </Collapsible.Root>

        <div ref={logsRef} className="scroll-mt-4 pt-10">
          <FilterBar
            state={filterState}
            onChange={(next) => setFilters(next)}
            services={overview.ledger.map((l) => ({
              serviceId: l.serviceId,
              serviceName: l.serviceName,
            }))}
            agents={agents}
            rangeStart={overview.dataset.rangeStart}
            rangeEnd={overview.dataset.rangeEnd}
            totalLabel={
              isRejectedView
                ? `${formatNumber(logsTotal)} rejected rows`
                : `${formatNumber(logsTotal)} records`
            }
          />

          <Panel
            className={cx("mt-4 min-w-0 p-4 sm:p-6", pulse && "attention-pulse")}
          >
            {logsQuery.isError ? (
              <InlineError
                message={
                  logsQuery.error instanceof Error
                    ? logsQuery.error.message
                    : "Couldn't load check records."
                }
                onRetry={() => void logsQuery.refetch()}
              />
            ) : isRejectedView ? (
              <RejectedTable
                rows={rejectedRows}
                loading={logsQuery.isPending}
              />
            ) : (
              <LogsTable
                rows={logRows}
                tz={dash.tz}
                withYear={datasetSpansYears}
                loading={logsQuery.isPending}
                total={logsTotal}
                hasMore={logsQuery.hasNextPage}
                loadingMore={logsQuery.isFetchingNextPage}
                onLoadMore={() => void logsQuery.fetchNextPage()}
                onClearFilters={() =>
                  setFilters({
                    date: null,
                    from: null,
                    to: null,
                    services: [],
                    outcome: "all",
                    agent: null,
                  })
                }
                emptyMessage={emptyMessage}
              />
            )}
          </Panel>
        </div>
      </main>
    </>
  );
}
