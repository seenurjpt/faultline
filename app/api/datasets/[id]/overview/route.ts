import { NextResponse } from "next/server";
import { z } from "zod";
import { buildOverview } from "@/lib/overview";
import { isDbConfigured } from "@/lib/db";

// SPEC §11.2
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = z.string().uuid();
// Either the whole file or a YYYY-MM month key; anything else is rejected
// rather than silently falling back.
const PERIOD = z
  .string()
  .regex(/^(all|\d{4}-(0[1-9]|1[0-2]))$/)
  .default("all");

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/datasets/[id]/overview">,
) {
  if (!isDbConfigured()) {
    return NextResponse.json(
      { error: "not_configured", message: "The database isn't configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const { id } = await ctx.params;
  const idCheck = UUID.safeParse(id);
  if (!idCheck.success) {
    return NextResponse.json(
      { error: "invalid_dataset_id", message: "That dataset id isn't valid." },
      { status: 422, headers: { "Cache-Control": "no-store" } },
    );
  }

  const periodCheck = PERIOD.safeParse(
    new URL(request.url).searchParams.get("period") ?? undefined,
  );
  if (!periodCheck.success) {
    return NextResponse.json(
      { error: "invalid_period", message: "Period must be 'all' or YYYY-MM." },
      { status: 422, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const overview = await buildOverview(idCheck.data, periodCheck.data);
    if (!overview) {
      return NextResponse.json(
        { error: "dataset_not_found", message: "That dataset doesn't exist." },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(overview, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error: unknown) {
    console.error("GET overview", error);
    return NextResponse.json(
      { error: "db_unavailable", message: "Couldn't reach the database." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
