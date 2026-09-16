"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Button, Skeleton, cx } from "../ui/primitives";
import { UploadPanel } from "./upload-panel";
import { useUpload } from "./use-upload";

export function UploadModal({
  open,
  onOpenChange,
  currentDatasetId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The dataset the dashboard behind the modal is currently showing. */
  currentDatasetId: string;
}) {
  const controller = useUpload();
  const router = useRouter();
  const [confirmingClose, setConfirmingClose] = useState(false);
  // Whether this modal started a navigation, which swaps the body for the
  // loading state and locks the close button.
  const [opening, setOpening] = useState(false);
  // The dataset being navigated to, so the modal knows which arrival to
  // close on rather than closing on any re-render.
  const [target, setTarget] = useState<string | null>(null);

  const close = useCallback(() => {
    setConfirmingClose(false);
    setOpening(false);
    controller.reset();
    onOpenChange(false);
  }, [controller, onOpenChange]);

  // Esc and backdrop clicks route through here so an upload in flight is
  // never discarded by a stray keypress.
  const requestClose = useCallback(() => {
    if (controller.isProcessing) {
      setConfirmingClose(true);
      return;
    }
    close();
  }, [controller.isProcessing, close]);

  const openDataset = useCallback(
    (datasetId: string) => {
      // The dashboard recomputes the whole overview against Neon for a dataset
      // that has just landed, which takes a moment. Closing the modal first
      // left the old dashboard on screen with no sign anything was happening,
      // so the modal stays up showing progress and closes once the new page
      // has actually rendered.
      setOpening(true);
      setTarget(datasetId);
      // A freshly uploaded dataset is not in the server-rendered dataset list
      // yet, so the page must re-fetch as well as navigate. push() carries the
      // id in the URL and refresh() re-runs the server component for it;
      // refresh() must come after, because calling it first cancels the
      // pending navigation and the id never reaches the URL.
      router.push(`/?dataset=${datasetId}`);
      router.refresh();
    },
    [router],
  );

  // The modal closes when the dashboard for the requested dataset is actually
  // on screen, which `currentDatasetId` reports from the server component.
  // Timing the close off the navigation call instead closed it immediately,
  // leaving the previous dashboard visible while the new one was still being
  // computed — the thing the loading state exists to avoid.
  if (opening && target !== null && currentDatasetId === target) {
    setOpening(false);
    setTarget(null);
    controller.reset();
    onOpenChange(false);
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (next) {
          onOpenChange(true);
          return;
        }
        requestClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="modal-scrim fixed inset-0 z-50 bg-[var(--scrim)]" />
        <Dialog.Content
          // Radix closes on Esc and outside clicks by default; both are
          // intercepted so the guard above can run first.
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            requestClose();
          }}
          onPointerDownOutside={(e) => {
            e.preventDefault();
            requestClose();
          }}
          onInteractOutside={(e) => e.preventDefault()}
          className={cx(
            // The centring transform lives in .modal-dialog's keyframes, not
            // in a Tailwind -translate-* class, so the two cannot fight.
            "modal-dialog fixed left-1/2 top-1/2 z-50 w-[min(760px,calc(100vw-32px))]",
            // A fixed height, not a max: the tray, pre-flight card, batch
            // track and receipt are all different lengths, and letting the
            // dialog resize between them made it jump under the cursor.
            // On a short viewport it shrinks to fit rather than overflowing.
            "h-[min(560px,calc(100dvh-32px))]",
            "flex flex-col overflow-hidden",
            "rounded-[var(--radius-panel)] border border-[var(--rule)] bg-[var(--fog)]",
          )}
        >
          {/* Header stays put; only the body between it and the footer moves. */}
          <div className="flex shrink-0 items-start justify-between gap-4 p-6 pb-4">
            <div>
              <Dialog.Title className="font-display text-[23px] leading-[30px] font-semibold">
                Process a monitoring file
              </Dialog.Title>
              <Dialog.Description className="mt-2 max-w-[60ch] text-[15px] leading-[22px] text-[var(--shale)]">
                Faultline reads your CSV in batches, cleans each batch in the
                cloud, and stores every check it keeps, merges or rejects, so
                the numbers can be traced back to the file.
              </Dialog.Description>
            </div>
            <button
              type="button"
              onClick={requestClose}
              disabled={opening}
              aria-label="Close"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-field)] text-[var(--shale)] hover:bg-[var(--paper)] hover:text-[var(--basalt)] disabled:opacity-40"
            >
              <X size={16} />
            </button>
          </div>

          {/* min-h-0 is what lets a flex child actually scroll rather than
              growing to fit its content and pushing the footer out. */}
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
            {opening ? (
              <OpeningDashboard />
            ) : (
              /* Full height so the panel's min-h-full has something to resolve
               against and the tray fills the box instead of floating. */
              <div className="h-full">
                <UploadPanel
                  controller={controller}
                  onOpenDataset={openDataset}
                />
              </div>
            )}
          </div>

          {/* Pinned, so a long receipt cannot scroll the warning out of view. */}
          {confirmingClose && (
            <div className="shrink-0 border-t border-[var(--rule)] px-6 py-4">
              <ConfirmClose
                onKeepGoing={() => setConfirmingClose(false)}
                onStop={close}
              />
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Shown while the dashboard is being built for a dataset that has just been
 * stored. The shapes match what is about to appear behind the modal — a
 * verdict line, the ribbon lanes, a few ledger rows — so the wait reads as
 * the page arriving rather than as a spinner over nothing (DESIGN §6.10:
 * skeletons match final geometry, slow pulse, no shimmer).
 */
function OpeningDashboard() {
  return (
    <div className="flex h-full flex-col gap-5 py-2" aria-hidden="true">
      <p
        aria-hidden="false"
        aria-live="polite"
        className="text-[15px] leading-[22px] text-[var(--shale)]"
      >
        Building the dashboard for this file…
      </p>

      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-4/5" />
        <Skeleton className="h-5 w-3/5" />
      </div>

      <div className="flex flex-col gap-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-3 w-24 shrink-0" />
            <Skeleton className="h-[2px] flex-1" />
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-3 w-full" />
        ))}
      </div>
    </div>
  );
}

/**
 * SPEC §5.2: stopping mid-upload leaves the upload in `processing`, which
 * never appears in the dataset switcher and does not block re-uploading the
 * same file, because only complete uploads trigger the duplicate check.
 */
function ConfirmClose({
  onKeepGoing,
  onStop,
}: {
  onKeepGoing: () => void;
  onStop: () => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-label="Stop processing this file?"
      className="border-l-[3px] border-[var(--fault)] pl-4"
    >
      <p className="text-[15px] leading-[22px]">
        Stop processing this file? Batches already sent are kept, and nothing is
        added to the dashboard until the file finishes.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <Button kind="secondary" onClick={onKeepGoing} autoFocus>
          Keep processing
        </Button>
        <Button kind="text" onClick={onStop}>
          Stop and close
        </Button>
      </div>
    </div>
  );
}
