import "server-only";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

// `server-only` makes this a build error if a client component ever imports
// it, so the connection string cannot leak into a browser bundle.

let cached: NeonQueryFunction<false, false> | null = null;

export function db(): NeonQueryFunction<false, false> {
  if (cached) return cached;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.",
    );
  }

  cached = neon(url);
  return cached;
}

export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}
