// SPEC §6: shared response shapes, CORS and limits for the processor.

export type Env = {
  DATABASE_URL: string;
  ALLOWED_ORIGINS: string;
};

/** SPEC §6: the error body shape used by every endpoint. */
export type ApiError = {
  error: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
};

// SPEC §6.5: the abuse limits. The Worker URL is public, so these are the
// only thing standing between it and a hostile caller.
export const LIMITS = {
  maxFileBytes: 10 * 1024 * 1024,
  maxChunkBytes: 1024 * 1024,
  maxRows: 200_000,
  chunkRows: 2000,
  maxFilenameLength: 200,
} as const;

function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
}

/**
 * Returns CORS headers for an allowed origin, or an empty object.
 * An origin that is not on the list gets no CORS headers at all, so the
 * browser blocks the response rather than the Worker having to guess.
 */
export function corsHeaders(
  request: Request,
  env: Env,
): Record<string, string> {
  const origin = request.headers.get("Origin");
  if (!origin) return {};
  if (!allowedOrigins(env).includes(origin)) return {};

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Line-Offset",
    "Access-Control-Max-Age": "86400",
    // The allowed origin varies per request, so caches must key on it.
    Vary: "Origin",
  };
}

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

export function json(
  body: unknown,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...SECURITY_HEADERS,
      ...extraHeaders,
    },
  });
}

export function errorResponse(
  status: number,
  error: string,
  message: string,
  options: { retryable?: boolean; details?: Record<string, unknown>; headers?: Record<string, string> } = {},
): Response {
  const body: ApiError = {
    error,
    message,
    retryable: options.retryable ?? false,
    details: options.details ?? {},
  };
  return json(body, status, options.headers ?? {});
}

export function preflight(
  request: Request,
  env: Env,
): Response {
  const headers = corsHeaders(request, env);
  // No CORS headers means the origin is not allowed; say so plainly rather
  // than returning a 200 the browser will reject anyway.
  if (Object.keys(headers).length === 0) {
    return errorResponse(403, "origin_not_allowed", "This origin is not allowed.");
  }
  return new Response(null, { status: 204, headers });
}
