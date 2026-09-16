"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Button, cx } from "../ui/primitives";
import { UploadPanel } from "./upload-panel";
import { useUpload } from "./use-upload";

export function UploadModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const controller = useUpload();
  const router = useRouter();
  const [confirmingClose, setConfirmingClose] = useState(false);

  const close = useCallback(() => {
    setConfirmingClose(false);
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
      close();
      // A freshly uploaded dataset is not in the server-rendered dataset list
      // yet, so the page must re-fetch as well as navigate. push() carries the
      // id in the URL and refresh() re-runs the server component for it;
      // refresh() must come after, because calling it first cancels the
      // pending navigation and the id never reaches the URL.
      router.push(`/?dataset=${datasetId}`);
      router.refresh();
    },
    [close, router],
  );

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
              aria-label="Close"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-field)] text-[var(--shale)] hover:bg-[var(--paper)] hover:text-[var(--basalt)]"
            >
              <X size={16} />
            </button>
          </div>

          {/* min-h-0 is what lets a flex child actually scroll rather than
              growing to fit its content and pushing the footer out. */}
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
            {/* Full height so the panel's min-h-full has something to resolve
                against and the tray fills the box instead of floating. */}
            <div className="h-full">
              <UploadPanel controller={controller} onOpenDataset={openDataset} />
            </div>
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
