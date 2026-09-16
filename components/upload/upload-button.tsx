"use client";

// Opens the upload modal from a server-rendered page (the empty dashboard),
// which cannot hold the modal's open state itself.
import { useState } from "react";
import { UploadModal } from "./upload-modal";
import { cx } from "../ui/primitives";

export function UploadButton({
  children = "Upload a file",
  kind = "primary",
  className,
}: {
  children?: React.ReactNode;
  kind?: "primary" | "secondary";
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cx(
          "inline-flex min-h-10 items-center rounded-[var(--radius-field)] px-4 text-[15px] leading-[22px] font-medium",
          kind === "primary"
            ? "bg-[var(--tide)] text-[var(--paper)] hover:opacity-90"
            : "border border-[var(--tide)] text-[var(--tide)] hover:bg-[var(--fog)]",
          className,
        )}
      >
        {children}
      </button>
      {/* No dataset is on screen in the empty state, so there is nothing for
          the modal to wait to arrive: it navigates and unmounts with the page. */}
      <UploadModal open={open} onOpenChange={setOpen} currentDatasetId="" />
    </>
  );
}
