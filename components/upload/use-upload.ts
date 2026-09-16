"use client";

// The upload state machine, kept apart from how it is presented so the modal
// (and anything else) drives one implementation of SPEC §5.1.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DuplicateUploadError,
  UploadError,
  preflight,
  uploadFile,
  type ChunkReport,
  type PreflightOk,
  type UploadSummary,
} from "@/lib/upload-client";

export type BatchState = "pending" | "active" | "done" | "failed";

export type Stage =
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

export type UploadController = {
  stage: Stage;
  error: string | null;
  /** True while batches are in flight — the modal guards closing on this. */
  isProcessing: boolean;
  choose: (file: File) => void;
  start: (pre: PreflightOk, force: boolean) => void;
  reset: () => void;
  /** Aborts an in-flight upload and clears state. */
  cancel: () => void;
};

export function useUpload(): UploadController {
  const [stage, setStage] = useState<Stage>({ kind: "empty" });
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Cancel any upload still in flight when the screen goes away.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const choose = useCallback((file: File) => {
    setError(null);
    void preflight(file).then((result) => {
      if (!result.ok) {
        setError(result.message);
        setStage({ kind: "empty" });
        return;
      }
      setStage({ kind: "preflight", pre: result });
    });
  }, []);

  const start = useCallback((pre: PreflightOk, force: boolean) => {
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

    void (async () => {
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

        // An abort is the user closing the modal, not a failure to report.
        if (err instanceof UploadError && err.code === "aborted") return;
        setError(
          err instanceof UploadError
            ? err.message
            : "Something went wrong during the upload. Try again.",
        );
      }
    })();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setStage({ kind: "empty" });
    setError(null);
  }, []);

  return {
    stage,
    error,
    isProcessing: stage.kind === "processing",
    choose,
    start,
    reset,
    cancel: reset,
  };
}
