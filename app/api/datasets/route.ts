import { NextResponse } from "next/server";
import { listDatasets } from "@/lib/queries";
import { isDbConfigured } from "@/lib/db";

// SPEC §11: reads run on Node with no caching, so a fresh upload is visible
// immediately.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isDbConfigured()) {
    return NextResponse.json(
      { error: "not_configured", message: "The database isn't configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const datasets = await listDatasets();
    return NextResponse.json(datasets, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error: unknown) {
    console.error("GET /api/datasets", error);
    return NextResponse.json(
      { error: "db_unavailable", message: "Couldn't reach the database." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
