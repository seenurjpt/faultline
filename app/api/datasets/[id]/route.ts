import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteDataset } from "@/lib/queries";
import { isDbConfigured } from "@/lib/db";

// Reads and writes both run on Node with no caching, so the dataset switcher
// reflects a delete immediately.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = z.string().uuid();

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function DELETE(
  _request: Request,
  ctx: RouteContext<"/api/datasets/[id]">,
) {
  if (!isDbConfigured()) {
    return NextResponse.json(
      { error: "not_configured", message: "The database isn't configured." },
      { status: 503, headers: NO_STORE },
    );
  }

  const { id } = await ctx.params;
  if (!UUID.safeParse(id).success) {
    return NextResponse.json(
      { error: "invalid_dataset_id", message: "That dataset id isn't valid." },
      { status: 422, headers: NO_STORE },
    );
  }

  try {
    const filename = await deleteDataset(id);
    // Deleting something already gone is reported honestly rather than as a
    // success, so the UI can say the list was stale instead of implying it
    // removed something.
    if (filename === null) {
      return NextResponse.json(
        { error: "not_found", message: "That dataset no longer exists." },
        { status: 404, headers: NO_STORE },
      );
    }
    return NextResponse.json({ id, filename }, { headers: NO_STORE });
  } catch (error: unknown) {
    console.error(`DELETE /api/datasets/${id}`, error);
    return NextResponse.json(
      { error: "db_unavailable", message: "Couldn't reach the database." },
      { status: 503, headers: NO_STORE },
    );
  }
}
