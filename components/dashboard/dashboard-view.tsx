"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
import { ManageDatasetsModal } from "./manage-datasets-modal";
import {
  clearedLogsFilters,
  useLogsState,
  useViewState,
} from "@/lib/url-state";
import { useLogs } from "@/lib/use-logs";
import { formatDate, formatNumber, parseUtcDayKey } from "@/lib/format";

/** A period's `to` is exclusive; the range filter's is inclusive. */
function lastDayOf(exclusiveEndIso: string): string {
  const d = new Date(new Date(exclusiveEndIso).getTime() - 86_400_000);
  return d.toISOString().slice(0, 10);
}

export function DashboardView({
  datasets,
  overview,
  agents,
}: {
  datasets: DatasetSummary[];
  overview: Overview;
  agents: string[];
}) {
  const [dash, setDash] = useViewState();
  const [filters, setFilters] = useLogsState();
  const [highlight, setHighlight] = useState<string | null>(null);
  const [pulse, setPulse] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const logsRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

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
    flag: filters.flag,
    agent: filters.agent,
  });

  const logsTotal = logsQuery.total;
  // The endpoint returns check rows or rejected rows depending on `outcome`.
  // The hook only hands back rows that belong to the filters currently
  // selected, so the filter is a safe way to know which shape arrived — and
  // while a switch is in flight it hands back none, rather than the previous
  // outcome's rows in the other shape.
  const isRejectedView = filters.outcome === "rejected";
  const logRows = isRejectedView ? [] : (logsQuery.rows as LogRow[]);
  const rejectedRows = isRejectedView ? (logsQuery.rows as RejectedRow[]) : [];

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
      // DESIGN §6.3 sets the day and the service, and deliberately not the
      // outcome: clicking a healthy stretch used to force "failures" and show
      // an empty table, and it silently discarded whatever outcome the user
      // had already chosen. The one exception is the rejected view, which has
      // no date or service of its own, so a click there has to leave it.
      setFilters({
        mode: "day",
        date: utcDay,
        from: null,
        to: null,
        services: [serviceId],
        ...(filters.outcome === "rejected" ? { outcome: "all" as const } : {}),
      });
      scrollToLogs();
    },
    [setFilters, scrollToLogs, filters.outcome],
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
        // Unlike a ribbon click, choosing a named incident is an explicit
        // "show me this outage", so narrowing to failures is what was asked
        // for rather than an assumption.
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
    flag: filters.flag,
    agent: filters.agent,
  };

  // rangeEnd is exclusive, so the last covered day is the day before it. A
  // file ending 31 Dec has a rangeEnd of 1 Jan, which would otherwise read as
  // spanning two years and put a year on every log row.
  const datasetSpansYears =
    new Date(overview.dataset.rangeStart).getUTCFullYear() !==
    new Date(
      new Date(overview.dataset.rangeEnd).getTime() - 86_400_000,
    ).getUTCFullYear();

  /**
   * The period scopes the findings above, not the check records below: the
   * records are a separate investigation, and the ribbon and incidents both
   * set a single day there. That is defensible but easy to misread as one
   * view — a billing reader can see "April 2025" in the header and May rows
   * in the table. Rather than silently re-scoping the logs (which would fight
   * every click-through), the mismatch is stated where it shows, with one
   * action to make the table match.
   */
  // Only raised when the records are genuinely unscoped. Someone who has
  // picked a day or a range of their own is looking at what they asked for,
  // and does not need telling the header says something else.
  const logsHaveOwnDates =
    (filters.mode === "day" && filters.date !== null) ||
    (filters.mode === "range" && filters.from !== null);
  const periodMatchesLogs = isWholeFile || isRejectedView || logsHaveOwnDates;

  const scopeLogsToPeriod = useCallback(() => {
    setFilters({
      mode: "range",
      date: null,
      from: period.from.slice(0, 10),
      // The period's `to` is exclusive; the range filter is inclusive.
      to: lastDayOf(period.to),
    });
  }, [setFilters, period.from, period.to]);

  const periodScopeNotice = periodMatchesLogs ? null : (
    <p className="mt-2 text-[13px] leading-[18px] text-[var(--shale)]">
      These records cover the whole file. The findings above are for{" "}
      {period.label}.{" "}
      <button
        type="button"
        onClick={scopeLogsToPeriod}
        className="text-[var(--tide)] hover:underline underline-offset-4"
      >
        Show only {period.label}
      </button>
    </p>
  );

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

  // After a delete the server component has to re-run, because the dataset
  // list, the overview and the logs all came from it. Deleting the dataset on
  // screen also has to move the URL off that id: refresh() alone would
  // re-render the same now-missing id and fall through to "couldn't be
  // loaded". push() goes to the newest survivor (or the bare dashboard, which
  // shows the empty state) and refresh() re-runs the server component for it.
  const handleDeleted = useCallback(
    (deletedId: string, remaining: DatasetSummary[]) => {
      const wasOnScreen = deletedId === overview.dataset.id;
      if (wasOnScreen) {
        setManageOpen(false);
        const next = remaining[0];
        router.push(next ? `/?dataset=${next.id}` : "/");
      }
      router.refresh();
    },
    [overview.dataset.id, router],
  );

  return (
    <>
      <TopBar
        datasets={datasets}
        periods={overview.periods}
        onUploadClick={() => setUploadOpen(true)}
        onManageClick={() => setManageOpen(true)}
      />

      <UploadModal
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        currentDatasetId={overview.dataset.id}
      />

      <ManageDatasetsModal
        open={manageOpen}
        onOpenChange={setManageOpen}
        datasets={datasets}
        currentId={overview.dataset.id}
        onDeleted={handleDeleted}
      />

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
                    onFilter={(outcome: Outcome, flag?: string | null) => {
                      // A figure that counts one flag narrows to that flag;
                      // anything else clears it, so a previous drill-down
                      // never silently restricts the new view.
                      setFilters({ outcome, flag: flag ?? null });
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
                ? `${formatNumber(logsTotal)} rejected ${logsTotal === 1 ? "row" : "rows"}`
                : `${formatNumber(logsTotal)} ${logsTotal === 1 ? "record" : "records"}`
            }
          />

          {periodScopeNotice}

          <Panel
            className={cx(
              "mt-4 min-w-0 px-4 pb-4 sm:px-6 sm:pb-6",
              pulse && "attention-pulse",
            )}
          >
            {logsQuery.isError ? (
              <InlineError
                message={
                  logsQuery.error instanceof Error
                    ? logsQuery.error.message
                    : "Couldn't load check records."
                }
                onRetry={logsQuery.refetch}
              />
            ) : isRejectedView ? (
              <RejectedTable
                rows={rejectedRows}
                loading={logsQuery.isPending}
                total={logsTotal}
                page={logsQuery.page}
                pageCount={logsQuery.pageCount}
                pageSize={logsQuery.pageSize}
                onPageSize={logsQuery.setPageSize}
                onGoToPage={logsQuery.goToPage}
                firstRowNumber={logsQuery.firstRowNumber}
                hasPrev={logsQuery.hasPrev}
                hasNext={logsQuery.hasNext}
                onPrev={logsQuery.goPrev}
                onNext={logsQuery.goNext}
                paging={logsQuery.isFetching}
              />
            ) : (
              <LogsTable
                rows={logRows}
                tz={dash.tz}
                withYear={datasetSpansYears}
                loading={logsQuery.isPending}
                total={logsTotal}
                page={logsQuery.page}
                pageCount={logsQuery.pageCount}
                pageSize={logsQuery.pageSize}
                onPageSize={logsQuery.setPageSize}
                onGoToPage={logsQuery.goToPage}
                firstRowNumber={logsQuery.firstRowNumber}
                hasPrev={logsQuery.hasPrev}
                hasNext={logsQuery.hasNext}
                onPrev={logsQuery.goPrev}
                onNext={logsQuery.goNext}
                paging={logsQuery.isFetching}
                onClearFilters={() => setFilters(clearedLogsFilters())}
                emptyMessage={emptyMessage}
              />
            )}
          </Panel>
        </div>
      </main>
    </>
  );
}
