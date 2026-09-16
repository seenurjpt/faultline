"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, FaultGlyph, InlineError, cx } from "../ui/primitives";
import { formatBytes, formatDate, formatNumber } from "@/lib/format";
import { REQUIRED_COLUMNS } from "@/core/src/types";
import {
  CHUNK_ROWS,
  DuplicateUploadError,
  UploadError,
  preflight,
  uploadFile,
  type ChunkReport,
  type PreflightOk,
  type UploadSummary,
} from "@/lib/upload-client";

type BatchState = "pending" | "active" | "done" | "failed";

type Stage =
  | { kind: "empty" }
  | { kind: "preflight"; pre: PreflightOk }
  | {
      kind: "processing";
      pre: PreflightOk;
      batches: BatchState[];
      stored: number;
      merged: number;
      rejected: number;
      announcement: string;
    }
  | { kind: "duplicate"; pre: PreflightOk; uploadId: string; completedAt: string }
  | { kind: "receipt"; summary: UploadSummary };

export function UploadView() {
  const [stage, setStage] = useState<Stage>({ kind: "empty" });
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Cancel any upload still in flight when the screen goes away.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const runPreflight = useCallback(async (file: File) => {
    setError(null);
    const result = await preflight(file);
    if (!result.ok) {
      setError(result.message);
      setStage({ kind: "empty" });
      return;
    }
    setStage({ kind: "preflight", pre: result });
  }, []);

  const start = useCallback(async (pre: PreflightOk, force: boolean) => {
    setError(null);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStage({
      kind: "processing",
      pre,
      batches: Array.from({ length: pre.chunkCount }, (_, i) =>
        i === 0 ? "active" : "pending",
      ),
      stored: 0,
      merged: 0,
      rejected: 0,
      announcement: `Batch 1 of ${pre.chunkCount} started.`,
    });

    try {
      const summary = await uploadFile(pre, {
        force,
        signal: controller.signal,
        onChunk: (report: ChunkReport, index: number, total: number) => {
          setStage((prev) => {
            if (prev.kind !== "processing") return prev;
            const batches = [...prev.batches];
            batches[index] = "done";
            if (index + 1 < batches.length) batches[index + 1] = "active";
            return {
              ...prev,
              batches,
              stored: prev.stored + report.stored,
              merged:
                prev.merged + report.mergedInChunk + report.mergedAcrossChunks,
              rejected: prev.rejected + report.rejected,
              announcement: `Batch ${index + 1} of ${total} processed.`,
            };
          });
        },
      });
      setStage({ kind: "receipt", summary });
    } catch (err: unknown) {
      if (err instanceof DuplicateUploadError) {
        setStage({
          kind: "duplicate",
          pre,
          uploadId: err.info.uploadId,
          completedAt: err.info.completedAt,
        });
        return;
      }

      // Mark the batch that failed so the strip shows where it stopped.
      setStage((prev) => {
        if (prev.kind !== "processing") return prev;
        const batches = [...prev.batches];
        const active = batches.indexOf("active");
        if (active >= 0) batches[active] = "failed";
        return { ...prev, batches };
      });

      if (err instanceof UploadError && err.code === "aborted") return;
      setError(
        err instanceof UploadError
          ? err.message
          : "Something went wrong during the upload. Try again.",
      );
    }
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setStage({ kind: "empty" });
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  return (
    <>
      <header className="border-b border-[var(--rule)] bg-[var(--paper)]">
        <div className="mx-auto flex min-h-14 max-w-[1360px] items-center justify-between gap-4 px-4 sm:px-8">
          <Link
            href="/"
            className="flex items-center gap-2 font-display text-[19px] leading-[26px] font-semibold"
          >
            <FaultGlyph />
            Faultline
          </Link>
          <Link
            href="/"
            className="text-[15px] leading-[22px] text-[var(--tide)] hover:underline underline-offset-4"
          >
            Back to dashboard
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1360px] flex-1 px-4 py-10 sm:px-8 sm:py-16">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-6">
          <div className="lg:col-span-5">
            <h1 className="font-display text-[29px] leading-[36px] font-semibold sm:text-[37px] sm:leading-[42px]">
              Process a monitoring file
            </h1>
            <p className="mt-4 max-w-[60ch] text-[15px] leading-[22px]">
              Faultline reads your CSV in batches, cleans each batch in the
              cloud, and stores every check it keeps, merges or rejects, so the
              numbers can be traced back to the file.
            </p>
            <h2 className="mt-8 font-display text-[19px] leading-[26px] font-semibold">
              What gets checked
            </h2>
            <p className="mt-2 max-w-[60ch] text-[15px] leading-[22px]">
              Timestamps in any zone, units, duplicates, impossible values.
              Nothing is silently dropped.
            </p>
          </div>

          <div className="lg:col-span-7">
            <div
              className={cx(
                "rounded-[var(--radius-panel)] border bg-[var(--paper)] p-6",
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
                if (file) void runPreflight(file);
              }}
            >
              {stage.kind === "empty" && (
                <EmptyTray
                  inputRef={inputRef}
                  onChoose={(file) => void runPreflight(file)}
                />
              )}

              {stage.kind === "preflight" && (
                <PreflightCard
                  pre={stage.pre}
                  onProcess={() => void start(stage.pre, false)}
                  onReset={reset}
                />
              )}

              {stage.kind === "processing" && <BatchTrack stage={stage} />}

              {stage.kind === "duplicate" && (
                <DuplicatePrompt
                  uploadId={stage.uploadId}
                  completedAt={stage.completedAt}
                  onProcessAgain={() => void start(stage.pre, true)}
                />
              )}

              {stage.kind === "receipt" && (
                <ReceiptCard summary={stage.summary} onReset={reset} />
              )}

              {error && (
                <div className="mt-4">
                  <InlineError message={error} onRetry={reset} />
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </>
  );
}

function EmptyTray({
  inputRef,
  onChoose,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onChoose: (file: File) => void;
}) {
  return (
    <div className="flex flex-col items-start gap-4 py-8">
      <p className="text-[19px] leading-[26px]">Drop a .csv here</p>
      <div className="flex items-center gap-3">
        <span className="text-[15px] leading-[22px] text-[var(--shale)]">or</span>
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
    <div className="flex flex-col gap-4">
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

function BatchTrack({ stage }: { stage: Extract<Stage, { kind: "processing" }> }) {
  const done = stage.batches.filter((b) => b === "done").length;
  const total = stage.batches.length;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[19px] leading-[26px] tnum">
        Batch {Math.min(done + 1, total)} of {total}
      </p>

      <ol className="flex flex-wrap gap-1">
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
        So far: {formatNumber(stage.stored)} stored, {formatNumber(stage.merged)}{" "}
        merged, {formatNumber(stage.rejected)} rejected
      </p>

      <p aria-live="polite" className="sr-only-table">
        {stage.announcement}
      </p>
    </div>
  );
}

function DuplicatePrompt({
  uploadId,
  completedAt,
  onProcessAgain,
}: {
  uploadId: string;
  completedAt: string;
  onProcessAgain: () => void;
}) {
  const when = completedAt ? formatDate(completedAt) : "an earlier date";
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[15px] leading-[22px]">
        This file was already processed on {when}.
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <Link
          href={`/?dataset=${uploadId}`}
          className="inline-flex min-h-10 items-center rounded-[var(--radius-field)] bg-[var(--tide)] px-4 text-[15px] leading-[22px] font-medium text-[var(--paper)]"
        >
          Open existing dataset
        </Link>
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
}: {
  summary: UploadSummary;
  onReset: () => void;
}) {
  const issues = summary.issues ?? {};
  const epoch = issues.ts_epoch_converted ?? 0;
  const ist = issues.ts_offset_converted ?? 0;
  const seconds = issues.latency_unit_seconds ?? 0;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[19px] leading-[26px] tnum">
        Processed {formatNumber(summary.rows)} rows
      </p>
      <ul className="flex flex-col gap-1 text-[15px] leading-[22px] tnum">
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
        <Link
          href={`/?dataset=${summary.uploadId}`}
          className="inline-flex min-h-10 items-center rounded-[var(--radius-field)] bg-[var(--tide)] px-4 text-[15px] leading-[22px] font-medium text-[var(--paper)]"
        >
          Open dashboard
        </Link>
        <Button kind="text" onClick={onReset}>
          Process another file
        </Button>
      </div>
    </div>
  );
}
