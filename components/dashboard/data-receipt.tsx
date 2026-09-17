"use client";

import { useState } from "react";
import { CaretDown, Info } from "@phosphor-icons/react";
import * as Tooltip from "@radix-ui/react-tooltip";
import type { Outcome, Quality } from "@/lib/types";
import {
  REJECTION_REASONS,
  formatNumber,
  issueLabel,
  issueWhy,
} from "@/lib/format";
import { cx } from "../ui/primitives";

type Segment = {
  key: "stored" | "merged" | "rejected";
  label: string;
  value: number;
  color: string;
  /** Where this figure leads in the logs, if anywhere. */
  outcome: Outcome | null;
  /** Narrows a flagged link to the rows this figure counted. */
  flag?: string;
  help: string;
};

function segments(quality: Quality): Segment[] {
  return [
    {
      key: "stored",
      label: "Stored",
      value: quality.stored,
      color: "var(--tide)",
      // Stored checks are simply every check, which is the default view.
      outcome: "all",
      help: "Rows that became a check on the dashboard. Every availability figure is computed from these.",
    },
    {
      key: "merged",
      label: "Merged",
      value: quality.merged,
      color: "var(--shale)",
      outcome: "flagged",
      flag: "merged_duplicate",
      help: "Rows that reported a check another row had already reported. They were combined rather than counted twice, which would have double-counted failures.",
    },
    {
      key: "rejected",
      label: "Rejected",
      value: quality.rejected,
      color: "var(--fault)",
      outcome: "rejected",
      help: "Rows that could not be trusted as a check. Each one is kept with its line number and reason, so nothing is silently dropped.",
    },
  ];
}

function Help({ text }: { text: string }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          aria-label={text}
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[var(--shale)] hover:text-[var(--basalt)]"
        >
          <Info size={13} />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          sideOffset={6}
          collisionPadding={16}
          className="z-50 max-w-[280px] rounded-[var(--radius-field)] border border-[var(--rule)] bg-[var(--paper)] px-3 py-2 text-[13px] leading-[18px]"
        >
          {text}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function DataReceipt({
  quality,
  onFilter,
}: {
  quality: Quality;
  /** `flag` narrows outcome=flagged to one specific flag. */
  onFilter: (outcome: Outcome, flag?: string | null) => void;
}) {
  // The conversion list is long and rarely the reason someone opened the
  // dashboard, so it starts closed behind a count.
  const [showChanges, setShowChanges] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const parts = segments(quality);
  const total = quality.stored + quality.merged + quality.rejected || 1;
  const issues = Object.entries(quality.issues).filter(([, n]) => n > 0);
  const changedRows = issues.reduce((sum, [, n]) => sum + n, 0);
  const rejectedReason = Object.keys(quality.rejectedByReason)[0];

  return (
    <Tooltip.Provider delayDuration={200}>
      <div className="flex flex-col gap-4">
        <p className="text-[15px] leading-[22px] text-[var(--shale)]">
          What happened to the{" "}
          <span className="tnum font-medium text-[var(--basalt)]">
            {formatNumber(quality.rows)}
          </span>{" "}
          rows in this file.
        </p>

        {/* One bar, then the same three figures directly beneath it, so the
            colours are legible even where a segment is a sliver. */}
        <div>
          <div
            className="flex h-2 w-full overflow-hidden rounded-[var(--radius-chip)]"
            role="img"
            aria-label={parts
              .map((s) => `${formatNumber(s.value)} ${s.label.toLowerCase()}`)
              .join(", ")}
          >
            {parts.map((s) => (
              <span
                key={s.key}
                // A single rejected row out of 15,577 is far under a pixel, so
                // tiny segments get a floor to stay visible.
                style={{
                  width: `max(3px, ${(s.value / total) * 100}%)`,
                  background: s.color,
                }}
              />
            ))}
          </div>

          <ul className="mt-3 grid gap-3 sm:grid-cols-3">
            {parts.map((s) => (
              <li key={s.key} className="flex items-start gap-2">
                <span
                  aria-hidden="true"
                  className="mt-[7px] h-2 w-2 shrink-0 rounded-full"
                  style={{ background: s.color }}
                />
                <span className="min-w-0">
                  <span className="flex items-baseline gap-2">
                    <span className="tnum text-[19px] leading-[26px] font-semibold">
                      {formatNumber(s.value)}
                    </span>
                    <span className="text-[13px] leading-[18px] text-[var(--shale)]">
                      {s.label}
                    </span>
                    <Help text={s.help} />
                  </span>
                  {s.outcome && s.value > 0 && (
                    <button
                      type="button"
                      onClick={() => onFilter(s.outcome as Outcome, s.flag)}
                      className="mt-[2px] block text-[13px] leading-[18px] text-[var(--tide)] hover:underline underline-offset-4"
                    >
                      {s.key === "rejected"
                        ? "See rejected rows"
                        : s.key === "merged"
                          ? "See merged checks"
                          : "See all checks"}
                    </button>
                  )}
                  {s.key === "rejected" && rejectedReason && s.value > 0 && (
                    <span className="mt-[2px] block text-[13px] leading-[18px] text-[var(--shale)]">
                      {REJECTION_REASONS[rejectedReason] ?? rejectedReason}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="border-t border-[var(--rule)] pt-3">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
            {issues.length > 0 ? (
              <button
                type="button"
                onClick={() => setShowChanges((o) => !o)}
                aria-expanded={showChanges}
                className="inline-flex min-h-10 items-center gap-2 text-[15px] leading-[22px] text-[var(--tide)]"
              >
                {showChanges ? "Hide" : "Show"} what was cleaned up
                <span className="tnum text-[13px] leading-[18px] text-[var(--shale)]">
                  {formatNumber(changedRows)} in {issues.length}{" "}
                  {issues.length === 1 ? "way" : "ways"}
                </span>
                <CaretDown
                  size={13}
                  weight="bold"
                  className={cx(
                    "transition-transform",
                    showChanges && "rotate-180",
                  )}
                />
              </button>
            ) : (
              <span className="text-[15px] leading-[22px] text-[var(--shale)]">
                Nothing needed cleaning up in this file.
              </span>
            )}

            <span className="flex items-center gap-2 text-[13px] leading-[18px] text-[var(--shale)]">
              <span className="tnum">
                Coverage {quality.coveragePct.toFixed(3)}%
              </span>
              <Help text="The share of 15-minute slots that have at least one check. Slots with no data are left out of availability rather than counted as up or down, so this is how you tell a quiet period from a healthy one." />
            </span>
          </div>

          {showChanges && (
            <ul className="mt-2 flex flex-col">
              {issues.map(([flag, count]) => {
                const why = issueWhy(flag);
                const open = expanded === flag;
                return (
                  <li
                    key={flag}
                    className="border-b border-[var(--rule)] last:border-b-0"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-x-4 py-2">
                      <span className="tnum text-[15px] leading-[22px]">
                        {issueLabel(flag, count)}
                      </span>
                      <span className="flex items-center gap-4">
                        {why && (
                          <button
                            type="button"
                            onClick={() => setExpanded(open ? null : flag)}
                            aria-expanded={open}
                            className="text-[13px] leading-[18px] text-[var(--tide)] hover:underline underline-offset-4"
                          >
                            {open ? "Less" : "Why"}
                          </button>
                        )}
                        {/* Passes the flag, so this lands on the rows this
                            line counted rather than on every flagged row. */}
                        <button
                          type="button"
                          onClick={() => onFilter("flagged", flag)}
                          className="text-[13px] leading-[18px] text-[var(--tide)] hover:underline underline-offset-4"
                        >
                          See these checks
                        </button>
                      </span>
                    </div>
                    {open && why && (
                      <p className="max-w-[72ch] pb-3 text-[13px] leading-[18px] text-[var(--shale)]">
                        {why}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Tooltip.Provider>
  );
}
