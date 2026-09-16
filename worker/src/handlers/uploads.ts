// SPEC §6.2, §6.3, §6.4: the upload lifecycle.
import { z } from "zod";
import { processChunk } from "../../../core/src/pipeline";
import { REQUIRED_COLUMNS } from "../../../core/src/types";
import {
  completeUpload,
  createUpload,
  findCompletedBySha,
  getUpload,
  missingChunks,
  writeChunk,
  type Sql,
} from "../db";
import { LIMITS, errorResponse, json } from "../http";

// Every external input is validated before it reaches SQL or the cleaner.
const createUploadSchema = z
  .object({
    filename: z.string().min(1).max(LIMITS.maxFilenameLength),
    sizeBytes: z.number().int().positive().max(LIMITS.maxFileBytes),
    sha256: z.string().regex(/^[0-9a-f]{64}$/, "sha256 must be 64 hex characters"),
    totalRows: z.number().int().min(1).max(LIMITS.maxRows),
    chunkCount: z.number().int().min(1),
    header: z.array(z.string()).min(1).max(100),
    force: z.boolean().optional().default(false),
  })
  .refine(
    (v) => v.chunkCount === Math.ceil(v.totalRows / LIMITS.chunkRows),
    { message: "chunkCount must equal ceil(totalRows / 2000)", path: ["chunkCount"] },
  );

export async function handleCreateUpload(
  request: Request,
  sql: Sql,
  cors: Record<string, string>,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid_json", "The request body isn't valid JSON.", {
      headers: cors,
    });
  }

  const parsed = createUploadSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return errorResponse(422, "invalid_request", first.message, {
      details: { field: first.path.join("."), issues: parsed.error.issues },
      headers: cors,
    });
  }
  const input = parsed.data;

  // SPEC §6.2: the header must carry every required column.
  const header = input.header.map((h) => h.trim().toLowerCase());
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    return errorResponse(
      422,
      "missing_columns",
      `This file is missing: ${missing.join(", ")}.`,
      { details: { columns: missing }, headers: cors },
    );
  }

  // SPEC §6.2: the same bytes already processed is a duplicate unless forced.
  if (!input.force) {
    const existing = await findCompletedBySha(sql, input.sha256);
    if (existing) {
      return errorResponse(
        409,
        "already_uploaded",
        "This file was already processed.",
        {
          details: { uploadId: existing.id, completedAt: existing.completed_at },
          headers: cors,
        },
      );
    }
  }

  const uploadId = await createUpload(sql, input);
  return json({ uploadId }, 201, cors);
}

export async function handlePutChunk(
  request: Request,
  sql: Sql,
  cors: Record<string, string>,
  uploadId: string,
  chunkIndexRaw: string,
): Promise<Response> {
  const chunkIndex = Number(chunkIndexRaw);
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
    return errorResponse(422, "invalid_chunk_index", "Chunk index must be a whole number.", {
      headers: cors,
    });
  }

  const lineOffsetRaw = request.headers.get("X-Line-Offset");
  const lineOffset = Number(lineOffsetRaw);
  if (!Number.isInteger(lineOffset) || lineOffset < 2) {
    return errorResponse(
      422,
      "invalid_line_offset",
      "X-Line-Offset must be a whole number of at least 2.",
      { headers: cors },
    );
  }

  const text = await request.text();
  // SPEC §6.3: the body cap is measured in bytes, not characters, because a
  // multi-byte payload can be far larger than its length suggests.
  const byteLength = new TextEncoder().encode(text).length;
  if (byteLength > LIMITS.maxChunkBytes) {
    return errorResponse(413, "chunk_too_large", "This batch is larger than 1 MB.", {
      headers: cors,
    });
  }

  const upload = await getUpload(sql, uploadId);
  if (!upload) {
    return errorResponse(404, "upload_not_found", "This upload doesn't exist.", {
      headers: cors,
    });
  }
  if (upload.status === "complete") {
    return errorResponse(409, "upload_complete", "This upload is already complete.", {
      headers: cors,
    });
  }
  if (chunkIndex >= upload.chunk_count) {
    return errorResponse(
      422,
      "chunk_index_out_of_range",
      `This upload has ${upload.chunk_count} batches.`,
      { headers: cors },
    );
  }

  const processed = processChunk(text, lineOffset);

  const { stored, mergedAcrossChunks } = await writeChunk(sql, {
    uploadId,
    chunkIndex,
    checks: processed.checks,
    rejections: processed.rejections,
    rowsIn: processed.counts.rowsIn,
    mergedInChunk: processed.counts.mergedInChunk,
    issues: processed.issues,
  });

  return json(
    {
      chunkIndex,
      rowsIn: processed.counts.rowsIn,
      stored,
      mergedInChunk: processed.counts.mergedInChunk,
      mergedAcrossChunks,
      rejected: processed.counts.rejected,
      issues: processed.issues,
    },
    200,
    cors,
  );
}

export async function handleComplete(
  sql: Sql,
  cors: Record<string, string>,
  uploadId: string,
): Promise<Response> {
  const upload = await getUpload(sql, uploadId);
  if (!upload) {
    return errorResponse(404, "upload_not_found", "This upload doesn't exist.", {
      headers: cors,
    });
  }

  const missing = await missingChunks(sql, uploadId, upload.chunk_count);
  if (missing.length > 0) {
    return errorResponse(409, "missing_chunks", "Some batches haven't arrived yet.", {
      details: { missing },
      headers: cors,
    });
  }

  const summary = await completeUpload(sql, upload);
  return json({ uploadId, ...summary }, 200, cors);
}
