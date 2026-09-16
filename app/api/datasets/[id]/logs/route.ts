import { NextResponse } from "next/server";
import { z } from "zod";
import { isDbConfigured } from "@/lib/db";
import { slowThresholds } from "@/lib/overview";
import { getDataset, getLogs, getRejectedRows } from "@/lib/queries";

// SPEC §11.3
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const paramsSchema = z
  .object({
    date: z.string().regex(DAY).optional(),
    from: z.string().regex(DAY).optional(),
    to: z.string().regex(DAY).optional(),
    services: z.string().max(500).optional(),
    outcome: z
      .enum(["all", "failures", "slow", "flagged", "rejected"])
      .default("all"),
    agent: z.string().max(100).optional(),
    cursor: z.string().max(500).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  // SPEC §11.3: one date mode or the other, never both.
  .refine((v) => !(v.date && (v.from || v.to)), {
    message: "Use either date or from/to, not both.",
    path: ["date"],
  })
  .refine((v) => !(v.from && !v.to) && !(v.to && !v.from), {
    message: "from and to must be given together.",
    path: ["from"],
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: "from must not be after to.",
    path: ["from"],
  });

type Cursor = { checkedAt: string; serviceId: string; agent: string };

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

/** An opaque cursor is still user input, so it is parsed defensively. */
function decodeCursor(raw: string): Cursor | null {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    );
    const shape = z.object({
      checkedAt: z.string().datetime(),
      serviceId: z.string().max(100),
      agent: z.string().max(100),
    });
    const result = shape.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function utcDay(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/datasets/[id]/logs">,
) {
  if (!isDbConfigured()) {
    return NextResponse.json(
      { error: "not_configured", message: "The database isn't configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json(
      { error: "invalid_dataset_id", message: "That dataset id isn't valid." },
      { status: 422, headers: { "Cache-Control": "no-store" } },
    );
  }

  const url = new URL(request.url);
  const parsed = paramsSchema.safeParse(
    Object.fromEntries(url.searchParams.entries()),
  );
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: "invalid_params", message: first.message, details: { field: first.path.join(".") } },
      { status: 422, headers: { "Cache-Control": "no-store" } },
    );
  }
  const q = parsed.data;

  try {
    const dataset = await getDataset(id);
    if (!dataset) {
      return NextResponse.json(
        { error: "dataset_not_found", message: "That dataset doesn't exist." },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    // SPEC §11.3: rejected rows have no usable date, so the date filter is
    // ignored for them and the UI says so.
    if (q.outcome === "rejected") {
      const after = q.cursor ? Number(q.cursor) : null;
      const result = await getRejectedRows(
        id,
        q.limit,
        Number.isFinite(after) ? after : null,
      );
      return NextResponse.json(
        {
          rows: result.rows,
          nextCursor: result.nextId === null ? null : String(result.nextId),
          total: result.total,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const rangeStart = new Date(dataset.range_start);
    const rangeEnd = new Date(dataset.range_end);

    let from: Date | null = null;
    let to: Date | null = null;
    if (q.date) {
      from = utcDay(q.date);
      to = new Date(from.getTime() + 86_400_000);
    } else if (q.from && q.to) {
      from = utcDay(q.from);
      // `to` is inclusive for the user, exclusive in SQL.
      to = new Date(utcDay(q.to).getTime() + 86_400_000);
    }

    if (from && to && (to <= rangeStart || from >= rangeEnd)) {
      return NextResponse.json(
        {
          error: "date_out_of_range",
          message: "That date is outside this dataset.",
          details: {
            rangeStart: rangeStart.toISOString(),
            rangeEnd: rangeEnd.toISOString(),
          },
        },
        { status: 422, headers: { "Cache-Control": "no-store" } },
      );
    }

    const cursor = q.cursor ? decodeCursor(q.cursor) : null;
    if (q.cursor && !cursor) {
      return NextResponse.json(
        { error: "invalid_cursor", message: "That page cursor isn't valid." },
        { status: 422, headers: { "Cache-Control": "no-store" } },
      );
    }

    // Only the "slow" filter needs baselines, and they cost a full slot scan.
    const thresholds =
      q.outcome === "slow" ? await slowThresholds(id) : {};

    const { rows, total } = await getLogs({
      uploadId: id,
      from,
      to,
      services: q.services ? q.services.split(",").filter(Boolean).slice(0, 50) : [],
      outcome: q.outcome,
      agent: q.agent ?? null,
      cursor,
      limit: q.limit,
      slowThresholds: thresholds,
    });

    const last = rows[rows.length - 1];
    const nextCursor =
      rows.length === q.limit && last
        ? encodeCursor({
            checkedAt: last.checkedAt,
            serviceId: last.serviceId,
            agent: last.agent,
          })
        : null;

    return NextResponse.json(
      { rows, nextCursor, total },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: unknown) {
    console.error("GET logs", error);
    return NextResponse.json(
      { error: "db_unavailable", message: "Couldn't reach the database." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
