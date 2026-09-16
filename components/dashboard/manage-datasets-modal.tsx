"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "@phosphor-icons/react";
import { useCallback, useState } from "react";
import { Button, InlineError, cx } from "../ui/primitives";
import { deleteDataset } from "@/lib/delete-client";
import { formatNumber, formatRange } from "@/lib/format";
import type { DatasetSummary } from "@/lib/types";

/**
 * Deleting lives here rather than in the dataset switcher because a Radix
 * Select item is a choice: a delete control inside one would be activated by
 * the same click that picks the dataset. A separate list makes the two
 * actions distinct and gives the confirm step somewhere to sit.
 */
export function ManageDatasetsModal({
  open,
  onOpenChange,
  datasets,
  currentId,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  datasets: DatasetSummary[];
  currentId: string;
  onDeleted: (deletedId: string, remaining: DatasetSummary[]) => void;
}) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = deletingId !== null;

  const close = useCallback(() => {
    if (busy) return;
    setConfirmingId(null);
    setError(null);
    onOpenChange(false);
  }, [busy, onOpenChange]);

  const runDelete = useCallback(
    async (dataset: DatasetSummary) => {
      setError(null);
      setDeletingId(dataset.id);
      try {
        await deleteDataset(dataset.id);
        const remaining = datasets.filter((d) => d.id !== dataset.id);
        setConfirmingId(null);
        onDeleted(dataset.id, remaining);
      } catch (e: unknown) {
        setError(
          e instanceof Error ? e.message : "Couldn't delete this dataset.",
        );
      } finally {
        setDeletingId(null);
      }
    },
    [datasets, onDeleted],
  );

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="modal-scrim fixed inset-0 z-50 bg-[var(--scrim)]" />
        <Dialog.Content
          onEscapeKeyDown={(e) => {
            if (busy) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (busy) e.preventDefault();
          }}
          className={cx(
            // Centring lives in .modal-dialog's keyframes, not a Tailwind
            // -translate-* class, so the two cannot fight.
            "modal-dialog fixed left-1/2 top-1/2 z-50 w-[min(640px,calc(100vw-32px))]",
            "max-h-[calc(100dvh-32px)] overflow-y-auto",
            "rounded-[var(--radius-panel)] border border-[var(--rule)] bg-[var(--fog)] p-6",
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="font-display text-[23px] leading-[30px] font-semibold">
                Manage files
              </Dialog.Title>
              <Dialog.Description className="mt-2 max-w-[60ch] text-[15px] leading-[22px] text-[var(--shale)]">
                Deleting a file removes its checks, rejected rows and batch
                records. This cannot be undone.
              </Dialog.Description>
            </div>
            <button
              type="button"
              onClick={close}
              disabled={busy}
              aria-label="Close"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-field)] text-[var(--shale)] hover:bg-[var(--paper)] hover:text-[var(--basalt)] disabled:opacity-50"
            >
              <X size={16} />
            </button>
          </div>

          {error && (
            <div className="mt-4">
              <InlineError message={error} />
            </div>
          )}

          <ul className="mt-5 flex flex-col gap-2">
            {datasets.map((d) => {
              const isConfirming = confirmingId === d.id;
              const isDeleting = deletingId === d.id;
              return (
                <li
                  key={d.id}
                  className={cx(
                    "rounded-[var(--radius-field)] border border-[var(--rule)] bg-[var(--paper)] p-4",
                    isConfirming && "border-[var(--fault)]",
                  )}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
                    <div className="min-w-0">
                      <p className="truncate text-[15px] leading-[22px] font-medium">
                        {d.filename}
                        {d.id === currentId && (
                          <span className="ml-2 text-[13px] leading-[18px] font-normal text-[var(--shale)]">
                            shown now
                          </span>
                        )}
                      </p>
                      <p className="mt-1 text-[13px] leading-[18px] text-[var(--shale)]">
                        {formatRange(d.rangeStart, d.rangeEnd)} ·{" "}
                        {formatNumber(d.totals.stored)} checks
                      </p>
                    </div>

                    {!isConfirming && (
                      <Button
                        kind="text"
                        onClick={() => {
                          setError(null);
                          setConfirmingId(d.id);
                        }}
                        disabled={busy}
                        className="text-[var(--fault)]"
                      >
                        Delete
                      </Button>
                    )}
                  </div>

                  {isConfirming && (
                    <div
                      role="alertdialog"
                      aria-label={`Delete ${d.filename}?`}
                      className="mt-3 border-l-[3px] border-[var(--fault)] pl-4"
                    >
                      <p className="text-[15px] leading-[22px]">
                        Delete {d.filename} and its{" "}
                        {formatNumber(d.totals.stored)} stored checks?
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-4">
                        <Button
                          kind="secondary"
                          onClick={() => setConfirmingId(null)}
                          disabled={isDeleting}
                          autoFocus
                        >
                          Keep it
                        </Button>
                        <Button
                          kind="text"
                          onClick={() => void runDelete(d)}
                          disabled={isDeleting}
                          className="text-[var(--fault)]"
                        >
                          {isDeleting ? "Deleting…" : "Delete permanently"}
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {datasets.length === 0 && (
            <p className="mt-5 text-[15px] leading-[22px] text-[var(--shale)]">
              No files to manage.
            </p>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
