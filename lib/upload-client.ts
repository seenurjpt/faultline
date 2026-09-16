// SPEC §5.1: pre-flight in the browser, then chunk uploads with a bounded
// number in flight and a bounded retry policy. The browser does the splitting
// because the Worker has a 10 ms CPU budget per request and a 1 MB body cap;
// one 10 MB file would blow both.
import { runPool } from "./pool";
import { REQUIRED_COLUMNS } from "@/core/src/types";
import {
  dataLines,
  headerIndex,
  missingColumns,
  parseLine,
  splitLines,
  stripBom,
} from "@/core/src/csv";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const CHUNK_ROWS = 2000;
/**
 * Batches in flight at once. Four keeps a 100-batch file well inside the
 * Worker's per-isolate rate limit (240 requests a minute) and inside a
 * browser's per-host connection budget. Measured on the 8-batch 30-day file
 * against the real database: 16.8 s one at a time, 7.4 s with four in flight
 * (2.3x). The gain is bounded by how much concurrency the database's compute
 * absorbs, not by the Worker, so more than four buys little on the free tier.
 */
export const CHUNK_CONCURRENCY = 4;
const MAX_ROWS = 200_000;
/** SPEC §5.1: three retries at 500 ms, 1.5 s, 4 s. */
const RETRY_DELAYS_MS = [500, 1500, 4000];

export type PreflightOk = {
  ok: true;
  file: File;
  headerLine: string;
  header: string[];
  lines: string[];
  rows: number;
  chunkCount: number;
  sha256: string;
};

export type PreflightError = { ok: false; message: string };

export type ChunkReport = {
  chunkIndex: number;
  rowsIn: number;
  stored: number;
  mergedInChunk: number;
  mergedAcrossChunks: number;
  rejected: number;
  issues: Record<string, number>;
};

export type UploadSummary = {
  uploadId: string;
  rows: number;
  stored: number;
  merged: number;
  rejected: number;
  issues: Record<string, number>;
  rangeStart: string | null;
  rangeEnd: string | null;
  services: string[];
};

export type DuplicateInfo = { uploadId: string; completedAt: string };

export class UploadError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly details: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    retryable = false,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "UploadError";
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

/** Duplicate file (409). Carries what the UI needs to offer both choices. */
export class DuplicateUploadError extends UploadError {
  readonly info: DuplicateInfo;
  constructor(info: DuplicateInfo) {
    super("already_uploaded", "This file was already processed.", false, { ...info });
    this.name = "DuplicateUploadError";
    this.info = info;
  }
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function preflight(file: File): Promise<PreflightOk | PreflightError> {
  if (!file.name.toLowerCase().endsWith(".csv")) {
    return { ok: false, message: "Choose a .csv file." };
  }
  if (file.size > MAX_FILE_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return { ok: false, message: `This file is ${mb} MB. The limit is 10 MB.` };
  }
  if (file.size === 0) {
    return { ok: false, message: "This file is empty." };
  }

  const bytes = await file.arrayBuffer();
  const text = stripBom(new TextDecoder("utf-8").decode(bytes));
  const lines = splitLines(text);

  if (lines.length < 2) {
    return { ok: false, message: "This file has a header but no rows." };
  }

  const header = parseLine(lines[0]).map((h) => h.trim());
  const missing = missingColumns(headerIndex(lines[0]), REQUIRED_COLUMNS);
  if (missing.length > 0) {
    return {
      ok: false,
      message: `This file is missing: ${missing.join(", ")}. Add the ${
        missing.length === 1 ? "column" : "columns"
      } and choose the file again.`,
    };
  }

  const rows = dataLines(lines).length;
  if (rows === 0) {
    return { ok: false, message: "This file has a header but no rows." };
  }
  if (rows > MAX_ROWS) {
    return {
      ok: false,
      message: `This file has ${rows.toLocaleString("en-IN")} rows. The limit is 200,000.`,
    };
  }

  return {
    ok: true,
    file,
    headerLine: lines[0],
    header,
    lines,
    rows,
    chunkCount: Math.ceil(rows / CHUNK_ROWS),
    sha256: await sha256Hex(bytes),
  };
}

function processorUrl(): string {
  const url = process.env.NEXT_PUBLIC_PROCESSOR_URL;
  if (!url) {
    throw new UploadError(
      "not_configured",
      "The processor URL isn't configured. Set NEXT_PUBLIC_PROCESSOR_URL.",
    );
  }
  return url.replace(/\/$/, "");
}

async function readError(response: Response): Promise<UploadError> {
  let body: {
    error?: string;
    message?: string;
    retryable?: boolean;
    details?: Record<string, unknown>;
  } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    // A non-JSON error body is still an error; fall through to the default.
  }
  return new UploadError(
    body.error ?? `http_${response.status}`,
    body.message ?? `The processor returned ${response.status}.`,
    body.retryable ?? response.status >= 500,
    body.details ?? {},
  );
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * `fetch` rejects with a DOMException named "AbortError" when its signal
 * fires. That is a cancellation, not a failure to reach the processor, and
 * telling the two apart is what keeps a closed modal (or React's
 * mount/unmount/remount in development) from being reported as the processor
 * being down.
 */
function isAbort(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.code === DOMException.ABORT_ERR)
  );
}

/**
 * Sends one request, retrying only what is safe to retry. Chunks are
 * idempotent (SPEC §10.1), so a retry can never double-count.
 */
async function sendWithRetry(
  input: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Response> {
  let lastError: UploadError | null = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (signal?.aborted) throw new UploadError("aborted", "Upload cancelled.");

    try {
      const response = await fetch(input, { ...init, signal });
      if (response.ok) return response;

      const error = await readError(response);
      // A 4xx will fail the same way next time, so stop immediately.
      if (!error.retryable) throw error;
      lastError = error;
    } catch (error: unknown) {
      if (error instanceof UploadError) {
        if (!error.retryable) throw error;
        lastError = error;
      } else if (isAbort(error) || signal?.aborted) {
        // A cancelled request is not a network failure, and retrying it would
        // just abort again. It has to keep the "aborted" code so the caller
        // can stay silent rather than reporting the processor as unreachable.
        throw new UploadError("aborted", "Upload cancelled.");
      } else {
        // Network failure: the request never reached the processor.
        lastError = new UploadError(
          "network_error",
          "Couldn't reach the processor, so nothing was stored. Try again.",
          true,
        );
      }
    }

    if (attempt < RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt]);
  }

  throw lastError ?? new UploadError("unknown_error", "The upload failed.");
}

export type UploadCallbacks = {
  onUploadCreated?: (uploadId: string) => void;
  /** A batch has been handed to the network. */
  onChunkStart?: (index: number) => void;
  /** A batch has been recorded. Fires out of order, and also for batches an earlier attempt already stored. */
  onChunk?: (report: ChunkReport, index: number, total: number) => void;
  /** The processor continued an earlier unfinished upload of this file; `received` lists the batches it already held. */
  onResume?: (received: number[]) => void;
};

type CreateResponse = {
  uploadId: string;
  resumed?: boolean;
  receivedChunks?: ChunkReport[];
};

/** Builds the body for one chunk: the header line plus that chunk's rows. */
function chunkBody(
  pre: PreflightOk,
  rows: string[],
  index: number,
): { body: string; lineOffset: number } {
  const start = index * CHUNK_ROWS;
  const slice = rows.slice(start, start + CHUNK_ROWS);
  return {
    body: `${pre.headerLine}\n${slice.join("\n")}`,
    // The header is line 1, so the first data row is line 2.
    lineOffset: 2 + start,
  };
}

type SendOptions = {
  signal?: AbortSignal;
  /** Batches in flight at once; defaults to CHUNK_CONCURRENCY. */
  concurrency?: number;
} & UploadCallbacks;

export async function uploadFile(
  pre: PreflightOk,
  options: { force?: boolean } & SendOptions = {},
): Promise<UploadSummary> {
  const base = processorUrl();

  const createResponse = await fetch(`${base}/v1/uploads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: options.signal,
    body: JSON.stringify({
      filename: pre.file.name,
      sizeBytes: pre.file.size,
      sha256: pre.sha256,
      totalRows: pre.rows,
      chunkCount: pre.chunkCount,
      header: pre.header,
      force: options.force ?? false,
    }),
  }).catch((error: unknown) => {
    // Same distinction as sendWithRetry: a cancelled create is not the
    // processor being unreachable.
    if (isAbort(error) || options.signal?.aborted) {
      throw new UploadError("aborted", "Upload cancelled.");
    }
    throw new UploadError(
      "network_error",
      "Couldn't reach the processor, so nothing was stored. Try again.",
      true,
    );
  });

  if (createResponse.status === 409) {
    const error = await readError(createResponse);
    const details = error.details as Partial<DuplicateInfo>;
    throw new DuplicateUploadError({
      uploadId: String(details.uploadId ?? ""),
      completedAt: String(details.completedAt ?? ""),
    });
  }
  if (!createResponse.ok) throw await readError(createResponse);

  const created = (await createResponse.json()) as CreateResponse;
  const { uploadId } = created;
  options.onUploadCreated?.(uploadId);

  // Split once; every batch slices the same array.
  const rows = dataLines(pre.lines);
  const total = pre.chunkCount;

  // A continued upload already holds some batches. They are reported through
  // the same callback a freshly sent batch uses, so the caller's totals and
  // batch strip need no second code path to stay right.
  const received = new Set<number>();
  if (created.resumed && created.receivedChunks) {
    for (const report of created.receivedChunks) {
      if (report.chunkIndex < 0 || report.chunkIndex >= total) continue;
      received.add(report.chunkIndex);
      options.onChunk?.(report, report.chunkIndex, total);
    }
    options.onResume?.([...received].sort((a, b) => a - b));
  }

  const pending: number[] = [];
  for (let i = 0; i < total; i++) if (!received.has(i)) pending.push(i);

  await sendChunks(base, uploadId, pre, rows, pending, options);
  return completeUpload(base, uploadId, pre, rows, options);
}

/**
 * Sends the given batches with a bounded number in flight. Batches are
 * independent — each carries its own header and line offset, and the database
 * merges a duplicate across batches the same way whichever lands first — so
 * nothing about the stored result depends on completion order.
 */
async function sendChunks(
  base: string,
  uploadId: string,
  pre: PreflightOk,
  rows: string[],
  indexes: number[],
  options: SendOptions,
): Promise<void> {
  await runPool(
    indexes,
    async (index, _position, signal) => {
      options.onChunkStart?.(index);
      const { body, lineOffset } = chunkBody(pre, rows, index);
      try {
        const response = await sendWithRetry(
          `${base}/v1/uploads/${uploadId}/chunks/${index}`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "text/csv",
              "X-Line-Offset": String(lineOffset),
            },
            body,
          },
          signal,
        );
        const report = (await response.json()) as ChunkReport;
        options.onChunk?.(report, index, pre.chunkCount);
      } catch (error: unknown) {
        // Name the batch that failed so the UI can mark it. Cancellations stay
        // anonymous: they are a consequence of the failure, not a cause.
        if (error instanceof UploadError && error.code !== "aborted") {
          throw new UploadError(error.code, error.message, error.retryable, {
            ...error.details,
            chunkIndex: index,
          });
        }
        throw error;
      }
    },
    {
      concurrency: options.concurrency ?? CHUNK_CONCURRENCY,
      signal: options.signal,
    },
  );
}

async function completeUpload(
  base: string,
  uploadId: string,
  pre: PreflightOk,
  rows: string[],
  options: SendOptions,
): Promise<UploadSummary> {
  const finish = async (): Promise<Response> =>
    sendWithRetry(
      `${base}/v1/uploads/${uploadId}/complete`,
      { method: "POST" },
      options.signal,
    );

  let response: Response;
  try {
    response = await finish();
  } catch (error: unknown) {
    // SPEC §5.2: on missing_chunks, resend only those indexes once, then
    // complete again.
    if (error instanceof UploadError && error.code === "missing_chunks") {
      const missing = (error.details.missing as number[] | undefined) ?? [];
      await sendChunks(base, uploadId, pre, rows, missing, options);
      response = await finish();
    } else {
      throw error;
    }
  }

  return (await response.json()) as UploadSummary;
}
