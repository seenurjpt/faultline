import type { ComponentPropsWithoutRef, ReactNode } from "react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

// DESIGN §6.9: three button kinds, 40px tall, 6px radius, no arrows in labels.
const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-[var(--radius-field)] " +
  "text-[15px] leading-[22px] font-medium min-h-10 px-4 transition-colors " +
  "disabled:opacity-50 disabled:pointer-events-none";

const BUTTON_KINDS = {
  primary: "bg-[var(--tide)] text-[var(--paper)] hover:opacity-90",
  secondary:
    "border border-[var(--tide)] text-[var(--tide)] hover:bg-[var(--fog)]",
  text: "text-[var(--tide)] px-0 min-h-10 hover:underline underline-offset-4",
} as const;

type ButtonProps = ComponentPropsWithoutRef<"button"> & {
  kind?: keyof typeof BUTTON_KINDS;
};

export function Button({
  kind = "primary",
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      className={cx(BUTTON_BASE, BUTTON_KINDS[kind], className)}
      {...props}
    />
  );
}

// DESIGN §3.3: panels get the 14px radius; instrument surfaces stay square.
export function Panel({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<"section">) {
  return (
    <section
      className={cx(
        "bg-[var(--paper)] border border-[var(--rule)] rounded-[var(--radius-panel)]",
        className,
      )}
      {...props}
    >
      {children}
    </section>
  );
}

export function PanelTitle({
  children,
  count,
}: {
  children: ReactNode;
  count?: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <h2 className="font-display text-[19px] leading-[26px] font-semibold">
        {children}
      </h2>
      {count !== undefined && (
        <span className="text-[13px] leading-[18px] text-[var(--shale)] tnum">
          {count}
        </span>
      )}
    </div>
  );
}

// DESIGN §6.8: flags render as pill chips with human labels.
export function Chip({
  children,
  tone = "neutral",
  title,
}: {
  children: ReactNode;
  tone?: "neutral" | "warn" | "fault";
  title?: string;
}) {
  const tones = {
    neutral: "border-[var(--rule)] text-[var(--shale)]",
    warn: "border-[var(--rule)] text-[var(--ochre-ink)]",
    fault: "border-[var(--fault)] text-[var(--fault)]",
  } as const;
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center rounded-[var(--radius-chip)] border px-2 py-[1px]",
        "text-[12px] leading-[16px] whitespace-nowrap",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

// DESIGN §6.10: inline error block with a fault left rule and a retry action.
export function InlineError({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="border-l-[3px] border-[var(--fault)] pl-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1"
    >
      <p className="text-[15px] leading-[22px]">{message}</p>
      {onRetry && (
        <Button kind="text" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton", className)} aria-hidden="true" />;
}

/** DESIGN §6.1: the wordmark glyph — three strokes of 4 / 12 / 6px. */
export function FaultGlyph() {
  return (
    <svg
      width="14"
      height="16"
      viewBox="0 0 14 16"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect x="0" y="6" width="2" height="4" fill="var(--fault)" />
      <rect x="5" y="2" width="2" height="12" fill="var(--fault)" />
      <rect x="10" y="5" width="2" height="6" fill="var(--fault)" />
    </svg>
  );
}
