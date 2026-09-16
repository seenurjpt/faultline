"use client";

import Link from "next/link";
import * as Select from "@radix-ui/react-select";
import * as ToggleGroup from "@radix-ui/react-toggle-group";
import * as Tooltip from "@radix-ui/react-tooltip";
import { CaretDown, Check } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { FaultGlyph, cx } from "../ui/primitives";
import { formatRange, middleTruncate } from "@/lib/format";
import { useDashboardState } from "@/lib/url-state";
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
  const [state, setState] = useDashboardState();
  // DESIGN §5.4: under 720px the dataset and period controls collapse.
  const [open, setOpen] = useState(false);

  // The table headers stick below this one, so they need its height. It is
  // measured rather than hardcoded because the bar wraps at narrow widths and
  // grows when the mobile disclosure opens. The value is published as a CSS
  // variable on <html>, which is the nearest common ancestor of the header
  // and the tables.
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

  const datasetId = state.dataset || datasets[0]?.id || "";

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
    </>
  );

  return (
    <Tooltip.Provider delayDuration={200}>
      {/* The dataset and period controls decide what every number below
          means, so they stay reachable while reading a long logs table. */}
      <header
        ref={headerRef}
        className="sticky top-0 z-30 bg-[var(--paper)] border-b border-[var(--rule)]"
      >
        <div className="mx-auto max-w-[1360px] px-4 sm:px-8">
          <div className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 py-2">
            <Link
              href="/"
              className="flex items-center gap-2 font-display text-[19px] leading-[26px] font-semibold"
            >
              <FaultGlyph />
              Faultline
            </Link>

            <div className="hidden min-w-0 flex-1 items-center gap-3 md:flex">
              {controls}
            </div>

            <div className="ml-auto flex items-center gap-3">
              <TzToggle
                value={state.tz}
                onChange={(tz) => setState({ tz })}
              />
              <button
                type="button"
                onClick={onManageClick}
                className="inline-flex min-h-10 items-center rounded-[var(--radius-field)] px-3 text-[15px] leading-[22px] text-[var(--shale)] hover:text-[var(--basalt)]"
              >
                Manage files
              </button>
              <button
                type="button"
                onClick={onUploadClick}
                className="inline-flex min-h-10 items-center rounded-[var(--radius-field)] border border-[var(--tide)] px-4 text-[15px] leading-[22px] font-medium text-[var(--tide)] hover:bg-[var(--fog)]"
              >
                Upload file
              </button>
            </div>
          </div>

          {/* Under 720px the two selects sit behind a disclosure. */}
          <div className="md:hidden pb-3">
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              className="inline-flex min-h-10 items-center gap-2 text-[15px] leading-[22px] text-[var(--tide)]"
            >
              Dataset and period
              <CaretDown
                size={13}
                weight="bold"
                className={cx("transition-transform", open && "rotate-180")}
              />
            </button>
            {open && (
              <div className="mt-2 flex flex-col gap-2">{controls}</div>
            )}
          </div>
        </div>
      </header>
    </Tooltip.Provider>
  );
}
