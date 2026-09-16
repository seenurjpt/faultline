"use client";

import type { ApiFailure } from "./use-logs";

/**
 * Deletes one dataset. Resolves with the deleted filename so the caller can
 * name what went; throws with the server's message otherwise, matching how
 * fetchPage() surfaces failures.
 */
export async function deleteDataset(datasetId: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`/api/datasets/${datasetId}`, {
      method: "DELETE",
      headers: { Accept: "application/json" },
    });
  } catch {
    // The request never arrived, so nothing was deleted.
    const error = new Error(
      "Couldn't reach the server, so nothing was deleted.",
    );
    error.name = "network_error";
    throw error;
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiFailure;
    const error = new Error(body.message ?? "Couldn't delete this dataset.");
    error.name = body.error ?? "delete_error";
    throw error;
  }

  const body = (await response.json()) as { id: string; filename: string };
  return body.filename;
}
