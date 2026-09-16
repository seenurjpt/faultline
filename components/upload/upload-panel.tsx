"use client";

// The upload tray and its states (DESIGN §5.3). No page chrome, so the modal
// owns its own framing.
import Link from "next/link";
import { useRef, useState } from "react";
import { Button, InlineError, cx } from "../ui/primitives";
import { formatBytes, formatDate, formatNumber } from "@/lib/format";
import { REQUIRED_COLUMNS } from "@/core/src/types";
import {
  CHUNK_ROWS,
  type PreflightOk,
  type UploadSummary,
} from "@/lib/upload-client";
import type { Stage, UploadController } from "./use-upload";

export function UploadPanel({
  controller,
  onOpenDataset,
}: {
  controller: UploadController;
  /** Lets the modal close itself and navigate instead of a hard link. */
  onOpenDataset?: (datasetId: string) => void;
}) {
  const { stage, error, choose, start, reset } = controller;
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div
      className={cx(
        "rounded-[var(--radius-panel)] border bg-[var(--paper)] p-6",
        // The panel fills the dialog's fixed body rather than leaving dead
        // space beneath it, which also makes the whole of it a drop target.
        // Every stage is centred in that space, so the box does not look
        // top-heavy with a block of emptiness underneath.
        "flex min-h-full flex-col items-center justify-center",
        dragging ? "border-[var(--tide)]" : "border-[var(--rule)]",
        stage.kind === "empty" && "border-dashed",
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) choose(file);
      }}
    >
      {stage.kind === "empty" && (
        <EmptyTray inputRef={inputRef} onChoose={choose} />
      )}

      {stage.kind === "preflight" && (
        <PreflightCard
          pre={stage.pre}
          onProcess={() => start(stage.pre, false)}
          onReset={() => {
            reset();
            if (inputRef.current) inputRef.current.value = "";
          }}
        />
      )}

      {stage.kind === "processing" && <BatchTrack stage={stage} />}

      {stage.kind === "duplicate" && (
        <DuplicatePrompt
          uploadId={stage.uploadId}
          completedAt={stage.completedAt}
          onProcessAgain={() => start(stage.pre, true)}
          onOpenDataset={onOpenDataset}
        />
      )}

      {stage.kind === "receipt" && (
        <ReceiptCard
          summary={stage.summary}
          onReset={() => {
            reset();
            if (inputRef.current) inputRef.current.value = "";
          }}
          onOpenDataset={onOpenDataset}
        />
      )}

      {error && (
        <div className="mt-4">
          <InlineError
            message={error}
            onRetry={() => {
              reset();
              if (inputRef.current) inputRef.current.value = "";
            }}
          />
        </div>
      )}
    </div>
  );
}

function EmptyTray({
  inputRef,
  onChoose,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onChoose: (file: File) => void;
}) {
  // Centred: the tray is an empty target filling the dialog, so its content
  // sits in the middle of it rather than hugging one corner.
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 py-8 text-center">
      <p className="text-[19px] leading-[26px]">Drop a .csv here</p>
      <div className="flex items-center gap-3">
        <span className="text-[15px] leading-[22px] text-[var(--shale)]">
          or
        </span>
        <Button onClick={() => inputRef.current?.click()}>Choose file</Button>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="sr-only-table"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onChoose(file);
          }}
        />
      </div>
      <p className="max-w-[52ch] text-[13px] leading-[18px] text-[var(--shale)]">
        Up to 10 MB. Required columns: {REQUIRED_COLUMNS.join(", ")}.
      </p>
    </div>
  );
}

function PreflightCard({
  pre,
  onProcess,
  onReset,
}: {
  pre: PreflightOk;
  onProcess: () => void;
  onReset: () => void;
}) {
  return (
    <div className="flex w-full flex-col items-center gap-4 text-center">
      <p className="text-[19px] leading-[26px] [word-break:break-all]">
        {pre.file.name}
      </p>
      <p className="text-[15px] leading-[22px] text-[var(--shale)] tnum">
        {formatBytes(pre.file.size)}, {formatNumber(pre.rows)} rows, sent in{" "}
        {pre.chunkCount} {pre.chunkCount === 1 ? "batch" : "batches"} of up to{" "}
        {formatNumber(CHUNK_ROWS)} rows
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <Button onClick={onProcess}>Process file</Button>
        <Button kind="text" onClick={onReset}>
          Choose a different file
        </Button>
      </div>
    </div>
  );
}

function BatchTrack({
  stage,
}: {
  stage: Extract<Stage, { kind: "processing" }>;
}) {
  const done = stage.batches.filter((b) => b === "done").length;
  const active = stage.batches.filter((b) => b === "active").length;
  const total = stage.batches.length;

  return (
    <div className="flex w-full flex-col items-center gap-4 text-center">
      {/* Batches travel several at a time, so the heading counts what has
          landed rather than pointing at "the" current one. */}
      <p className="text-[19px] leading-[26px] tnum">
        {done} of {total} {total === 1 ? "batch" : "batches"} processed
        {active > 0 && (
          <span className="text-[var(--shale)]">, {active} in flight</span>
        )}
      </p>

      {/* Full width so the segments still span the panel and read as a
          sequential track rather than shrinking to their own content. */}
      <ol className="flex w-full flex-wrap gap-1">
        {stage.batches.map((state, i) => (
          <li
            key={i}
            className={cx(
              "flex h-8 min-w-12 flex-1 items-center justify-center border text-[12px] leading-[16px] tnum",
              state === "done" &&
                "border-[var(--tide)] bg-[var(--tide)] text-[var(--paper)]",
              state === "active" &&
                "border-[var(--tide)] text-[var(--tide)] animate-pulse",
              state === "pending" && "border-[var(--rule)] text-[var(--shale)]",
              state === "failed" && "border-[var(--fault)] text-[var(--fault)]",
            )}
          >
            {i + 1}
          </li>
        ))}
      </ol>

      <p className="text-[15px] leading-[22px] tnum">
        So far: {formatNumber(stage.stored)} stored,{" "}
        {formatNumber(stage.merged)} merged, {formatNumber(stage.rejected)}{" "}
        rejected
      </p>

      <p aria-live="polite" className="sr-only-table">
        {stage.announcement}
      </p>
    </div>
  );
}

function DatasetLink({
  datasetId,
  children,
  onOpenDataset,
}: {
  datasetId: string;
  children: React.ReactNode;
  onOpenDataset?: (datasetId: string) => void;
}) {
  const className =
    "inline-flex min-h-10 items-center rounded-[var(--radius-field)] bg-[var(--tide)] px-4 text-[15px] leading-[22px] font-medium text-[var(--paper)]";

  // Inside the modal the dashboard is already behind it, so opening a dataset
  // closes and navigates rather than reloading the page.
  if (onOpenDataset) {
    return (
      <button
        type="button"
        className={className}
        onClick={() => onOpenDataset(datasetId)}
      >
        {children}
      </button>
    );
  }

  return (
    <Link href={`/?dataset=${datasetId}`} className={className}>
      {children}
    </Link>
  );
}

function DuplicatePrompt({
  uploadId,
  completedAt,
  onProcessAgain,
  onOpenDataset,
}: {
  uploadId: string;
  completedAt: string;
  onProcessAgain: () => void;
  onOpenDataset?: (datasetId: string) => void;
}) {
  const when = completedAt ? formatDate(completedAt) : "an earlier date";
  return (
    <div className="flex w-full flex-col items-center gap-4 text-center">
      <p className="text-[15px] leading-[22px]">
        This file was already processed on {when}.
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <DatasetLink datasetId={uploadId} onOpenDataset={onOpenDataset}>
          Open existing dataset
        </DatasetLink>
        <Button kind="secondary" onClick={onProcessAgain}>
          Process again
        </Button>
      </div>
    </div>
  );
}

function ReceiptCard({
  summary,
  onReset,
  onOpenDataset,
}: {
  summary: UploadSummary;
  onReset: () => void;
  onOpenDataset?: (datasetId: string) => void;
}) {
  const issues = summary.issues ?? {};
  const epoch = issues.ts_epoch_converted ?? 0;
  const ist = issues.ts_offset_converted ?? 0;
  const seconds = issues.latency_unit_seconds ?? 0;

  return (
    <div className="flex w-full flex-col items-center gap-3 text-center">
      <p className="text-[19px] leading-[26px] tnum">
        Processed {formatNumber(summary.rows)} rows
      </p>
      {/* The figures are a list to read down, so they stay left-aligned
          inside the centred block rather than each line being centred. */}
      <ul className="flex flex-col gap-1 text-left text-[15px] leading-[22px] tnum">
        <li>{formatNumber(summary.stored)} checks stored</li>
        <li>
          {formatNumber(summary.merged)}{" "}
          {summary.merged === 1 ? "duplicate merged" : "duplicates merged"}
        </li>
        <li>
          {formatNumber(summary.rejected)}{" "}
          {summary.rejected === 1 ? "row rejected" : "rows rejected"}
        </li>
        {(epoch > 0 || ist > 0) && (
          <li>
            Converted {formatNumber(epoch)} epoch timestamps and{" "}
            {formatNumber(ist)} IST timestamps to UTC
          </li>
        )}
        {seconds > 0 && (
          <li>Converted {formatNumber(seconds)} latency values from seconds</li>
        )}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-4">
        <DatasetLink datasetId={summary.uploadId} onOpenDataset={onOpenDataset}>
          Open dashboard
        </DatasetLink>
        <Button kind="text" onClick={onReset}>
          Process another file
        </Button>
      </div>
    </div>
  );
}
