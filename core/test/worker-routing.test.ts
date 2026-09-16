// Exercises the Worker's HTTP surface — routing, CORS, validation and the
// abuse limits — without a database. The DB-dependent paths are covered by
// scripts/smoke.ts against a real deployment.
import { describe, expect, it } from "vitest";
import {
  LIMITS,
  corsHeaders,
  errorResponse,
  preflight,
  type Env,
} from "../../worker/src/http";

const ENV: Env = {
  DATABASE_URL: "postgres://unused",
  ALLOWED_ORIGINS: "https://faultline.vercel.app,http://localhost:3000",
};

function request(
  url: string,
  init: RequestInit & { origin?: string } = {},
): Request {
  const headers = new Headers(init.headers);
  if (init.origin) headers.set("Origin", init.origin);
  return new Request(url, { ...init, headers });
}

describe("SPEC §6 CORS", () => {
  it("allows an origin on the list", () => {
    const headers = corsHeaders(
      request("https://worker.dev/v1/health", { origin: "http://localhost:3000" }),
      ENV,
    );
    expect(headers["Access-Control-Allow-Origin"]).toBe("http://localhost:3000");
    expect(headers["Access-Control-Allow-Headers"]).toContain("X-Line-Offset");
    // Caches must not serve one origin's response to another.
    expect(headers.Vary).toBe("Origin");
  });

  it("gives an unlisted origin no CORS headers at all", () => {
    const headers = corsHeaders(
      request("https://worker.dev/v1/health", { origin: "https://evil.example" }),
      ENV,
    );
    expect(Object.keys(headers)).toHaveLength(0);
  });

  it("is not fooled by an origin that merely contains an allowed one", () => {
    for (const origin of [
      "http://localhost:3000.evil.example",
      "https://faultline.vercel.app.attacker.test",
      "https://notfaultline.vercel.app",
    ]) {
      const headers = corsHeaders(
        request("https://worker.dev/v1/health", { origin }),
        ENV,
      );
      expect(Object.keys(headers), origin).toHaveLength(0);
    }
  });

  it("refuses a preflight from an unlisted origin", async () => {
    const response = preflight(
      request("https://worker.dev/v1/uploads", {
        method: "OPTIONS",
        origin: "https://evil.example",
      }),
      ENV,
    );
    expect(response.status).toBe(403);
  });

  it("answers a preflight from an allowed origin with 204", () => {
    const response = preflight(
      request("https://worker.dev/v1/uploads", {
        method: "OPTIONS",
        origin: "http://localhost:3000",
      }),
      ENV,
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:3000",
    );
  });

  it("treats a request with no Origin as server-to-server", () => {
    const headers = corsHeaders(request("https://worker.dev/v1/health"), ENV);
    expect(Object.keys(headers)).toHaveLength(0);
  });
});

describe("SPEC §6 error body", () => {
  it("uses the documented shape", async () => {
    const response = errorResponse(422, "missing_columns", "This file is missing: latency.", {
      details: { columns: ["latency"] },
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      error: "missing_columns",
      message: "This file is missing: latency.",
      retryable: false,
      details: { columns: ["latency"] },
    });
  });

  it("marks database trouble retryable so the client backs off and retries", async () => {
    const response = errorResponse(500, "db_unavailable", "Try again.", {
      retryable: true,
    });
    const body = (await response.json()) as { retryable: boolean };
    expect(body.retryable).toBe(true);
  });

  it("sets no-store and nosniff on responses", () => {
    const response = errorResponse(404, "not_found", "No such endpoint.");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});

describe("SPEC §6.5 limits", () => {
  it("matches the documented caps", () => {
    expect(LIMITS.maxFileBytes).toBe(10 * 1024 * 1024);
    expect(LIMITS.maxChunkBytes).toBe(1024 * 1024);
    expect(LIMITS.maxRows).toBe(200_000);
    expect(LIMITS.chunkRows).toBe(2000);
  });
});
