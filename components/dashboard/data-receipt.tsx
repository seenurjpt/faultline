"use client";

import type { Outcome, Quality } from "@/lib/types";
import { ISSUE_LABELS, REJECTION_REASONS, formatNumber } from "@/lib/format";

/** DESIGN §6.6: tiny segments still need 3px so they stay visible. */
function segments(quality: Quality) {
  const total = quality.stored + quality.merged + quality.rejected || 1;
  return [
    { key: "stored", value: quality.stored, color: "var(--tide)" },
    { key: "merged", value: quality.merged, color: "var(--shale)" },
    { key: "rejected", value: quality.rejected, color: "var(--fault)" },
  ].map((s) => ({ ...s, pct: (s.value / total) * 100 }));
}

export function DataReceipt({
  quality,
  onFilter,
}: {
  quality: Quality;
  onFilter: (outcome: Outcome) => void;
}) {
  const parts = segments(quality);
  const rejectedReason =
    Object.keys(quality.rejectedByReason)[0] ?? "invalid_status_code";

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[15px] leading-[22px]">
        <span className="tnum font-medium">{formatNumber(quality.rows)}</span>{" "}
        rows read
      </p>

      <div
        className="flex h-2 w-full overflow-hidden"
        role="img"
        aria-label={`${formatNumber(quality.stored)} stored, ${formatNumber(quality.merged)} merged, ${formatNumber(quality.rejected)} rejected`}
      >
        {parts.map((s) => (
          <span
            key={s.key}
            style={{
              width: `max(3px, ${s.pct}%)`,
              background: s.color,
            }}
          />
        ))}
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        {/* Each figure sets the logs outcome filter (§6.6). */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] leading-[18px]">
          <span className="tnum">{formatNumber(quality.stored)} stored</span>
          <button
            type="button"
            onClick={() => onFilter("flagged")}
            className="tnum text-[var(--tide)] hover:underline underline-offset-4"
          >
            {formatNumber(quality.merged)} merged duplicates
          </button>
          <button
            type="button"
            onClick={() => onFilter("rejected")}
            className="tnum text-[var(--tide)] hover:underline underline-offset-4"
          >
            {formatNumber(quality.rejected)} rejected
          </button>
          <span className="text-[var(--shale)]">
            {REJECTION_REASONS[rejectedReason]}
          </span>
        </div>

        <ul className="flex flex-col gap-1 text-[13px] leading-[18px] lg:text-right">
          {Object.entries(quality.issues).map(([flag, count]) => {
            const label = ISSUE_LABELS[flag]?.(count) ?? `${count} ${flag}`;
            return (
              <li key={flag}>
                <button
                  type="button"
                  onClick={() => onFilter("flagged")}
                  className="tnum text-[var(--tide)] hover:underline underline-offset-4"
                >
                  {label}
                </button>
              </li>
            );
          })}
          <li className="tnum text-[var(--shale)]">
            Coverage {quality.coveragePct.toFixed(3)}%
          </li>
        </ul>
      </div>
    </div>
  );
}
