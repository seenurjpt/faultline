// SPEC §6: the processor. Parses, validates and cleans uploaded CSV chunks,
// then writes them. It never reads data back for the dashboard — that keeps
// this Worker small and well inside the 10 ms CPU budget of the free plan.
import { client, pingDb } from "./db";
import {
  corsHeaders,
  errorResponse,
  json,
  preflight,
  type Env,
} from "./http";
import {
  handleComplete,
  handleCreateUpload,
  handlePutChunk,
} from "./handlers/uploads";

const UPLOADS = /^\/v1\/uploads$/;
const CHUNK = /^\/v1\/uploads\/([0-9a-f-]{36})\/chunks\/(\d{1,4})$/;
const COMPLETE = /^\/v1\/uploads\/([0-9a-f-]{36})\/complete$/;

/**
 * A small in-memory limiter. Worker isolates are short-lived and not shared
 * globally, so this throttles a single hot isolate rather than enforcing a
 * global quota — enough to blunt an accidental loop, not a substitute for
 * real quota management. Cloudflare's own rate limiting is the durable answer
 * and is noted in the README.
 */
const RATE_LIMIT = { windowMs: 60_000, maxRequests: 240 };
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(request: Request): boolean {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const now = Date.now();
  const entry = hits.get(ip);

  if (!entry || now > entry.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + RATE_LIMIT.windowMs });
    // Opportunistic cleanup so the map cannot grow without bound.
    if (hits.size > 1000) {
      for (const [key, value] of hits) {
        if (now > value.resetAt) hits.delete(key);
      }
    }
    return false;
  }

  entry.count++;
  return entry.count > RATE_LIMIT.maxRequests;
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") return preflight(request, env);

    const cors = corsHeaders(request, env);

    // A browser request from an unlisted origin gets nothing useful back.
    // Server-to-server callers send no Origin and are unaffected.
    const origin = request.headers.get("Origin");
    if (origin && Object.keys(cors).length === 0) {
      return errorResponse(403, "origin_not_allowed", "This origin is not allowed.");
    }

    if (rateLimited(request)) {
      return errorResponse(429, "rate_limited", "Too many requests. Wait a minute and try again.", {
        retryable: true,
        headers: { ...cors, "Retry-After": "60" },
      });
    }

    if (!env.DATABASE_URL) {
      return errorResponse(500, "not_configured", "The processor has no database configured.", {
        headers: cors,
      });
    }

    const sql = client(env.DATABASE_URL);

    try {
      // SPEC §6.1
      if (path === "/v1/health" && request.method === "GET") {
        const db = await pingDb(sql);
        return json({ ok: true, db }, db ? 200 : 503, cors);
      }

      // SPEC §6.2
      if (UPLOADS.test(path) && request.method === "POST") {
        return await handleCreateUpload(request, sql, cors);
      }

      // SPEC §6.3
      const chunkMatch = CHUNK.exec(path);
      if (chunkMatch && request.method === "PUT") {
        return await handlePutChunk(request, sql, cors, chunkMatch[1], chunkMatch[2]);
      }

      // SPEC §6.4
      const completeMatch = COMPLETE.exec(path);
      if (completeMatch && request.method === "POST") {
        return await handleComplete(sql, cors, completeMatch[1]);
      }

      return errorResponse(404, "not_found", "No such endpoint.", { headers: cors });
    } catch (error: unknown) {
      // Database trouble is worth retrying; the client's backoff depends on
      // this flag. The underlying message is logged, never returned, because
      // it can carry connection details.
      console.error("processor error", error);
      return errorResponse(
        500,
        "db_unavailable",
        "The processor couldn't reach its database. Try again.",
        { retryable: true, headers: cors },
      );
    }
  },
};

export default worker;
