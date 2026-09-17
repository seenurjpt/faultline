"use client";

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import * as Select from "@radix-ui/react-select";
import * as ToggleGroup from "@radix-ui/react-toggle-group";
import * as Checkbox from "@radix-ui/react-checkbox";
import { CalendarBlank, CaretDown, Check } from "@phosphor-icons/react";
import { DayPicker } from "react-day-picker";
import type { DateRange } from "react-day-picker";
import { Button, cx } from "../ui/primitives";
import { formatDate, parseUtcDayKey, toUtcDayKey } from "@/lib/format";
import type { Outcome } from "@/lib/types";

const FIELD =
  "inline-flex items-center gap-2 min-h-10 px-3 rounded-[var(--radius-field)] " +
  "border border-[var(--rule)] bg-[var(--paper)] text-[15px] leading-[22px] " +
  "hover:border-[var(--shale)] transition-colors";

const POPOVER =
  "z-50 rounded-[var(--radius-field)] border border-[var(--rule)] bg-[var(--paper)] p-3";

const OUTCOMES: { value: Outcome; label: string }[] = [
  { value: "all", label: "All checks" },
  { value: "failures", label: "Failures" },
  { value: "slow", label: "Slow checks" },
  { value: "flagged", label: "Checks with notes" },
  { value: "rejected", label: "Rejected rows" },
];

// react-day-picker is used unstyled; every class comes from our tokens.
const DAY_PICKER_CLASSES = {
  months: "flex flex-col",
  month: "flex flex-col gap-2",
  month_caption: "text-[15px] leading-[22px] font-medium px-1 py-1",
  nav: "flex items-center gap-1 justify-end",
  button_previous:
    "inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-field)] border border-[var(--rule)]",
  button_next:
    "inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-field)] border border-[var(--rule)]",
  month_grid: "border-collapse",
  weekdays: "text-[12px] leading-[16px] text-[var(--shale)]",
  weekday: "h-8 w-9 font-normal",
  day: "h-9 w-9 p-0 text-center text-[13px] leading-[18px] tnum",
  day_button:
    "h-9 w-9 rounded-[var(--radius-field)] hover:bg-[var(--fog)] disabled:opacity-35 disabled:hover:bg-transparent",
  selected:
    "[&_button]:bg-[var(--tide)] [&_button]:text-[var(--paper)] [&_button]:hover:bg-[var(--tide)]",
  range_middle: "[&_button]:bg-[var(--fog)] [&_button]:text-[var(--basalt)]",
  today: "[&_button]:underline [&_button]:underline-offset-4",
  outside: "opacity-40",
};

export type FilterState = {
  mode: "day" | "range";
  date: string | null;
  from: string | null;
  to: string | null;
  services: string[];
  outcome: Outcome;
  /** Set by a receipt drill-down to narrow outcome=flagged to one flag. */
  flag: string | null;
  agent: string | null;
};

export function FilterBar({
  state,
  onChange,
  services,
  agents,
  rangeStart,
  rangeEnd,
  totalLabel,
}: {
  state: FilterState;
  onChange: (next: Partial<FilterState>) => void;
  services: { serviceId: string; serviceName: string }[];
  agents: string[];
  rangeStart: string;
  rangeEnd: string;
  totalLabel: string;
}) {
  // DESIGN §5.4: the whole bar collapses into a disclosure under 720px.
  const [openOnMobile, setOpenOnMobile] = useState(false);

  const minDate = new Date(rangeStart);
  const maxDate = new Date(new Date(rangeEnd).getTime() - 86_400_000);

  const hasFilter =
    state.date !== null ||
    state.from !== null ||
    state.services.length > 0 ||
    state.outcome !== "all" ||
    state.agent !== null;

  const isRejected = state.outcome === "rejected";

  const controls = (
    <div className="flex flex-wrap items-start gap-3">
      <ToggleGroup.Root
        type="single"
        value={state.mode}
        onValueChange={(v) =>
          v && onChange({ mode: v as "day" | "range", date: null, from: null, to: null })
        }
        aria-label="Date mode"
        className="inline-flex rounded-[var(--radius-field)] border border-[var(--rule)] bg-[var(--paper)] p-[2px]"
      >
        {(
          [
            ["day", "One day"],
            ["range", "Date range"],
          ] as const
        ).map(([value, label]) => (
          <ToggleGroup.Item
            key={value}
            value={value}
            className={cx(
              "min-h-9 px-3 rounded-[4px] text-[13px] leading-[18px] font-medium whitespace-nowrap",
              "data-[state=on]:bg-[var(--tide)] data-[state=on]:text-[var(--paper)]",
              "data-[state=off]:text-[var(--shale)]",
            )}
          >
            {label}
          </ToggleGroup.Item>
        ))}
      </ToggleGroup.Root>

      <div className="flex flex-col gap-1">
        <Popover.Root>
          <Popover.Trigger
            className={cx(FIELD, isRejected && "opacity-50")}
            disabled={isRejected}
            aria-label="Choose dates"
          >
            <CalendarBlank size={15} />
            {state.mode === "day"
              ? state.date
                ? formatDate(parseUtcDayKey(state.date))
                : "Any day"
              : state.from && state.to
                ? `${formatDate(parseUtcDayKey(state.from))} – ${formatDate(parseUtcDayKey(state.to))}`
                : "Any dates"}
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content className={POPOVER} sideOffset={4} align="start">
              {state.mode === "day" ? (
                <DayPicker
                  mode="single"
                  classNames={DAY_PICKER_CLASSES}
                  selected={state.date ? parseUtcDayKey(state.date) : undefined}
                  defaultMonth={minDate}
                  disabled={{ before: minDate, after: maxDate }}
                  onSelect={(d) =>
                    onChange({ date: d ? toUtcDayKey(d) : null })
                  }
                />
              ) : (
                <DayPicker
                  mode="range"
                  classNames={DAY_PICKER_CLASSES}
                  selected={
                    state.from
                      ? {
                          from: parseUtcDayKey(state.from),
                          to: state.to ? parseUtcDayKey(state.to) : undefined,
                        }
                      : undefined
                  }
                  defaultMonth={minDate}
                  disabled={{ before: minDate, after: maxDate }}
                  onSelect={(r: DateRange | undefined) =>
                    onChange({
                      from: r?.from ? toUtcDayKey(r.from) : null,
                      to: r?.to ? toUtcDayKey(r.to) : null,
                    })
                  }
                />
              )}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        <span className="text-[12px] leading-[16px] text-[var(--shale)]">
          {isRejected
            ? "Rejected rows have no usable date."
            : "Dates are UTC days."}
        </span>
      </div>

      <Popover.Root>
        <Popover.Trigger className={FIELD}>
          {/* One service names itself, which is more use than "1 service" —
              and a ribbon click always selects exactly one. */}
          {state.services.length === 0
            ? "All services"
            : state.services.length === 1
              ? (services.find((s) => s.serviceId === state.services[0])
                  ?.serviceName ?? "1 service")
              : `${state.services.length} services`}
          <CaretDown size={13} weight="bold" className="text-[var(--shale)]" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className={POPOVER} sideOffset={4} align="start">
            <ul className="flex flex-col gap-1">
              <li>
                <label className="flex min-h-10 cursor-pointer items-center gap-3 px-1 text-[15px] leading-[22px]">
                  <CheckboxBox
                    checked={state.services.length === 0}
                    onCheckedChange={() => onChange({ services: [] })}
                  />
                  All services
                </label>
              </li>
              {services.map((s) => {
                const checked = state.services.includes(s.serviceId);
                return (
                  <li key={s.serviceId}>
                    <label className="flex min-h-10 cursor-pointer items-center gap-3 px-1 text-[15px] leading-[22px]">
                      <CheckboxBox
                        checked={checked}
                        onCheckedChange={() =>
                          onChange({
                            services: checked
                              ? state.services.filter((x) => x !== s.serviceId)
                              : [...state.services, s.serviceId],
                          })
                        }
                      />
                      {s.serviceName}
                    </label>
                  </li>
                );
              })}
            </ul>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <PlainSelect
        label="Outcome"
        value={state.outcome}
        // Choosing an outcome by hand clears any flag a receipt drill-down
        // set, so "Checks with notes" means all of them again.
        onChange={(v) => onChange({ outcome: v as Outcome, flag: null })}
        options={OUTCOMES.map((o) => ({ value: o.value, label: o.label }))}
        display={(v) =>
          `Outcome: ${OUTCOMES.find((o) => o.value === v)?.label ?? ""}`
        }
      />

      <PlainSelect
        label="Agent"
        value={state.agent ?? "all"}
        onChange={(v) => onChange({ agent: v === "all" ? null : v })}
        options={[
          { value: "all", label: "All agents" },
          ...agents.map((a) => ({ value: a, label: a })),
        ]}
        display={(v) => (v === "all" ? "All agents" : v)}
      />

      {hasFilter && (
        <Button
          kind="text"
          onClick={() =>
            onChange({
              date: null,
              from: null,
              to: null,
              services: [],
              outcome: "all",
              agent: null,
            })
          }
        >
          Clear filters
        </Button>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-display text-[23px] leading-[30px] font-semibold">
          Check records
        </h2>
        <span className="text-[13px] leading-[18px] text-[var(--shale)] tnum">
          {totalLabel}
        </span>
      </div>

      <div className="hidden sm:block">{controls}</div>

      <div className="sm:hidden">
        <button
          type="button"
          onClick={() => setOpenOnMobile((o) => !o)}
          aria-expanded={openOnMobile}
          className="inline-flex min-h-10 items-center gap-2 text-[15px] leading-[22px] text-[var(--tide)]"
        >
          Filters
          <CaretDown
            size={13}
            weight="bold"
            className={cx("transition-transform", openOnMobile && "rotate-180")}
          />
        </button>
        {openOnMobile && <div className="mt-3">{controls}</div>}
      </div>
    </div>
  );
}

function CheckboxBox({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: () => void;
}) {
  return (
    <Checkbox.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border border-[var(--rule)] bg-[var(--paper)] data-[state=checked]:border-[var(--tide)] data-[state=checked]:bg-[var(--tide)]"
    >
      <Checkbox.Indicator className="text-[var(--paper)]">
        <Check size={12} weight="bold" />
      </Checkbox.Indicator>
    </Checkbox.Root>
  );
}

function PlainSelect({
  label,
  value,
  onChange,
  options,
  display,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  display: (value: string) => string;
}) {
  return (
    <Select.Root value={value} onValueChange={onChange}>
      <Select.Trigger className={FIELD} aria-label={label}>
        <span className="whitespace-nowrap">{display(value)}</span>
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
            {options.map((o) => (
              <Select.Item
                key={o.value}
                value={o.value}
                className="relative flex cursor-default select-none items-center rounded-[4px] py-2 pl-8 pr-3 text-[15px] leading-[22px] outline-none data-[highlighted]:bg-[var(--fog)]"
              >
                <Select.ItemIndicator className="absolute left-2">
                  <Check size={14} weight="bold" />
                </Select.ItemIndicator>
                <Select.ItemText>{o.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
