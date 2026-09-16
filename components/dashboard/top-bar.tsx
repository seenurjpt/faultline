"use client";

import Link from "next/link";
import * as Select from "@radix-ui/react-select";
import * as ToggleGroup from "@radix-ui/react-toggle-group";
import * as Tooltip from "@radix-ui/react-tooltip";
import { CaretDown, Check, Folders, UploadSimple } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { FaultGlyph, cx } from "../ui/primitives";
import { formatRange, middleTruncate } from "@/lib/format";
import { useDashboardState, useViewState } from "@/lib/url-state";
import type { DatasetSummary, Period } from "@/lib/types";

const TRIGGER =
  "inline-flex items-center gap-2 min-h-10 px-3 rounded-[var(--radius-field)] " +
  "border border-[var(--rule)] bg-[var(--paper)] text-[15px] leading-[22px] " +
  "text-left hover:border-[var(--shale)] transition-colors max-w-full";

const CONTENT =
  "z-50 overflow-hidden rounded-[var(--radius-field)] border border-[var(--rule)] " +
  "bg-[var(--paper)] p-1 min-w-[var(--radix-select-trigger-width)]";

const ITEM =
  "relative flex items-center gap-2 select-none rounded-[4px] py-2 pl-8 pr-3 " +
  "text-[15px] leading-[22px] outline-none cursor-default " +
  "data-[highlighted]:bg-[var(--fog)] data-[state=checked]:font-medium";

function DatasetSelect({
  datasets,
  value,
  onChange,
}: {
  datasets: DatasetSummary[];
  value: string;
  onChange: (id: string) => void;
}) {
  const current = datasets.find((d) => d.id === value) ?? datasets[0];
  return (
    <Select.Root value={value} onValueChange={onChange}>
      <Select.Trigger className={cx(TRIGGER, "min-w-0")} aria-label="Dataset">
        <span className="flex min-w-0 flex-col leading-tight sm:flex-row sm:items-baseline sm:gap-2">
          <span className="truncate">{middleTruncate(current.filename)}</span>
          <span className="text-[13px] leading-[18px] text-[var(--shale)] whitespace-nowrap">
            {formatRange(current.rangeStart, current.rangeEnd)}
          </span>
        </span>
        <Select.Icon className="ml-auto shrink-0 text-[var(--shale)]">
          <CaretDown size={13} weight="bold" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className={CONTENT} position="popper" sideOffset={4}>
          <Select.Viewport>
            {datasets.map((d) => (
              <Select.Item key={d.id} value={d.id} className={ITEM}>
                <Select.ItemIndicator className="absolute left-2">
                  <Check size={14} weight="bold" />
                </Select.ItemIndicator>
                <Select.ItemText>
                  <span className="flex flex-col">
                    <span>{middleTruncate(d.filename, 36)}</span>
                    <span className="text-[13px] leading-[18px] text-[var(--shale)]">
                      {formatRange(d.rangeStart, d.rangeEnd)}
                    </span>
                  </span>
                </Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

function PeriodSelect({
  periods,
  value,
  onChange,
}: {
  periods: Period[];
  value: string;
  onChange: (key: string) => void;
}) {
  const current = periods.find((p) => p.key === value) ?? periods[0];
  return (
    <Select.Root value={current.key} onValueChange={onChange}>
      <Select.Trigger className={TRIGGER} aria-label="Period">
        <Select.Value>{current.label}</Select.Value>
        <Select.Icon className="ml-auto shrink-0 text-[var(--shale)]">
          <CaretDown size={13} weight="bold" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className={CONTENT} position="popper" sideOffset={4}>
          <Select.Viewport>
            {periods.map((p) => (
              <Select.Item key={p.key} value={p.key} className={ITEM}>
                <Select.ItemIndicator className="absolute left-2">
                  <Check size={14} weight="bold" />
                </Select.ItemIndicator>
                <Select.ItemText>
                  <span className="flex items-baseline gap-2">
                    {p.label}
                    {/* DESIGN §6.1: partial months show their measured days. */}
                    {p.measuredDays !== undefined &&
                      p.monthDays !== undefined &&
                      p.measuredDays < p.monthDays && (
                        <span className="text-[13px] leading-[18px] text-[var(--shale)]">
                          {p.measuredDays} of {p.monthDays} days
                        </span>
                      )}
                  </span>
                </Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

function TzToggle({
  value,
  onChange,
}: {
  value: "utc" | "ist";
  onChange: (tz: "utc" | "ist") => void;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <ToggleGroup.Root
          type="single"
          value={value}
          onValueChange={(v) => v && onChange(v as "utc" | "ist")}
          aria-label="Time zone shown"
          className="inline-flex rounded-[var(--radius-field)] border border-[var(--rule)] bg-[var(--paper)] p-[2px]"
        >
          {(["utc", "ist"] as const).map((tz) => (
            <ToggleGroup.Item
              key={tz}
              value={tz}
              className={cx(
                "min-h-9 min-w-11 px-3 rounded-[4px] text-[13px] leading-[18px] font-medium",
                "data-[state=on]:bg-[var(--tide)] data-[state=on]:text-[var(--paper)]",
                "data-[state=off]:text-[var(--shale)]",
              )}
            >
              {tz === "utc" ? "UTC" : "IST"}
            </ToggleGroup.Item>
          ))}
        </ToggleGroup.Root>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          sideOffset={6}
          className="z-50 max-w-[260px] rounded-[var(--radius-field)] border border-[var(--rule)] bg-[var(--paper)] px-3 py-2 text-[13px] leading-[18px]"
        >
          Changes how times are shown. Filters and calculations always use UTC.
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function TopBar({
  datasets,
  periods,
  onUploadClick,
  onManageClick,
}: {
  datasets: DatasetSummary[];
  periods: Period[];
  onUploadClick: () => void;
  onManageClick: () => void;
}) {
  // Dataset and period re-render the server component; the timezone toggle is
  // display-only, so it stays a shallow URL update.
  const [state, setState, isPending] = useDashboardState();
  const [view, setView] = useViewState();
  // DESIGN §5.4: under 720px the dataset and period controls collapse.
  const [open, setOpen] = useState(false);

  // The table headers stick below this one, so they need its height. It is
  // measured rather than hardcoded because the row is sized by its contents
  // and by the font once it loads, and those differ per breakpoint. The
  // disclosure panel is deliberately not part of this: it is positioned over
  // the page, so opening it must not push the table headers down.
  //
  // The value is published as a CSS variable on <html>, the nearest common
  // ancestor of the header and the tables.
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const publish = () => {
      document.documentElement.style.setProperty(
        "--top-bar-h",
        `${Math.round(el.getBoundingClientRect().height)}px`,
      );
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--top-bar-h");
    };
  }, []);

  // Above 768px the controls live in the row itself, so a disclosure left
  // open would re-appear the next time the window narrowed.
  useEffect(() => {
    if (!open) return;
    const wide = window.matchMedia("(min-width: 768px)");
    const close = () => {
      if (wide.matches) setOpen(false);
    };
    close();
    wide.addEventListener("change", close);
    return () => wide.removeEventListener("change", close);
  }, [open]);

  const datasetId = state.dataset || datasets[0]?.id || "";
  const currentDataset =
    datasets.find((d) => d.id === datasetId) ?? datasets[0];

  const controls = (
    <>
      <DatasetSelect
        datasets={datasets}
        value={datasetId}
        onChange={(id) => setState({ dataset: id, period: "all" })}
      />
      <PeriodSelect
        periods={periods}
        value={state.period}
        onChange={(key) => setState({ period: key })}
      />
      {/* Changing either control recomputes the overview on the server, which
          takes a moment on free-tier compute. Without this the click looks
          like it did nothing until the new numbers arrive. */}
      <span
        aria-live="polite"
        className={cx(
          "text-[13px] leading-[18px] text-[var(--shale)] transition-opacity",
          isPending ? "opacity-100" : "opacity-0",
        )}
      >
        {isPending ? "Updating…" : ""}
      </span>
    </>
  );

  return (
    <Tooltip.Provider delayDuration={200}>
      {/* The dataset and period controls decide what every number below
          means, so they stay reachable while reading a long logs table. */}
      <header
        ref={headerRef}
        className="sticky top-0 z-30 border-b border-[var(--rule)] bg-[var(--paper)]"
      >
        <div className="relative mx-auto max-w-[1360px] px-4 sm:px-8">
          {/* One row at every width. It wrapped before, which made the sticky
              bar three rows tall on a phone and left little of the table
              visible; the controls that do not fit move into the disclosure
              below instead. */}
          <div className="flex min-h-14 items-center gap-2 py-2 sm:gap-3">
            <Link
              href="/"
              className="flex shrink-0 items-center gap-2 font-display text-[19px] leading-[26px] font-semibold"
            >
              <FaultGlyph />
              <span className="hidden sm:inline">Faultline</span>
            </Link>

            <div className="hidden min-w-0 flex-1 items-center gap-3 md:flex">
              {controls}
            </div>

            {/* Under 720px the dataset and period sit behind this, in the row
                itself rather than on one of their own. */}
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-field)] border border-[var(--rule)] bg-[var(--paper)] px-3 py-2 text-left text-[13px] leading-[18px] hover:border-[var(--shale)] md:hidden"
            >
              <span className="min-w-0 flex-1 truncate">
                {middleTruncate(currentDataset?.filename ?? "Dataset", 22)}
              </span>
              <CaretDown
                size={13}
                weight="bold"
                className={cx(
                  "shrink-0 text-[var(--shale)] transition-transform",
                  open && "rotate-180",
                )}
              />
            </button>

            <div className="flex shrink-0 items-center gap-1 sm:gap-3">
              <div className="hidden sm:block">
                <TzToggle value={view.tz} onChange={(tz) => setView({ tz })} />
              </div>
              {/* Labels would not fit beside everything else on a phone, so
                  the actions become icons with accessible names. */}
              <button
                type="button"
                onClick={onManageClick}
                aria-label="Manage files"
                title="Manage files"
                className="inline-flex h-10 min-w-10 items-center justify-center rounded-[var(--radius-field)] px-0 text-[var(--shale)] hover:bg-[var(--fog)] hover:text-[var(--basalt)] sm:px-3 sm:text-[15px] sm:leading-[22px]"
              >
                <Folders size={17} className="sm:hidden" />
                <span className="hidden sm:inline">Manage files</span>
              </button>
              <button
                type="button"
                onClick={onUploadClick}
                aria-label="Upload file"
                title="Upload file"
                className="inline-flex h-10 min-w-10 items-center justify-center rounded-[var(--radius-field)] border border-[var(--tide)] px-0 font-medium text-[var(--tide)] hover:bg-[var(--fog)] sm:px-4 sm:text-[15px] sm:leading-[22px]"
              >
                <UploadSimple size={17} className="sm:hidden" />
                <span className="hidden sm:inline">Upload file</span>
              </button>
            </div>
          </div>

          {/* Expands over the page rather than pushing it, so opening it does
              not shift the rows being read. */}
          {open && (
            <div className="absolute inset-x-0 top-full z-40 border-b border-[var(--rule)] bg-[var(--paper)] px-4 pb-4 pt-1 shadow-lg md:hidden sm:px-8">
              <div className="mx-auto flex max-w-[1360px] flex-col gap-2">
                {controls}
                <div className="flex items-center justify-between gap-3 pt-1">
                  <span className="text-[13px] leading-[18px] text-[var(--shale)]">
                    Times shown in
                  </span>
                  <TzToggle value={view.tz} onChange={(tz) => setView({ tz })} />
                </div>
              </div>
            </div>
          )}
        </div>
      </header>
    </Tooltip.Provider>
  );
}
