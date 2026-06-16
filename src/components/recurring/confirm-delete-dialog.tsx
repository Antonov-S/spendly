"use client";

import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";

interface ConfirmDeleteDialogProps {
  /** Template name shown in the prompt; null when no template is targeted. */
  name: string | null;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  pending: boolean;
}

/**
 * Native <dialog> confirm for hard-deleting a template. No typing-to-confirm —
 * this is a template, not an account; a single Delete/Cancel pair suffices.
 */
export function ConfirmDeleteDialog({
  name,
  open,
  onClose,
  onConfirm,
  pending,
}: ConfirmDeleteDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Keep the native dialog in sync with the controlled `open` prop.
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="delete-template-title"
      onClose={onClose}
      className="m-auto w-[min(92vw,28rem)] rounded-xl border border-line bg-surface p-6 text-ink backdrop:bg-black/60"
    >
      <h3 id="delete-template-title" className="text-[15px] font-medium text-ink">
        Delete this template?
      </h3>
      <p className="mt-2 text-[12px] text-ink-2">
        This will delete{" "}
        <span className="font-medium text-ink">{name ?? "this template"}</span>{" "}
        and all of its pending drafts. This cannot be undone. Transactions
        already created from it are kept.
      </p>

      <div className="mt-5 flex gap-2">
        <button
          type="button"
          onClick={onClose}
          className="flex h-9 flex-1 items-center justify-center rounded-md border border-line text-[13px] font-medium text-ink transition-colors hover:bg-surface-2"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className="flex h-9 flex-1 items-center justify-center gap-2 rounded-md bg-danger text-[13px] font-medium text-white transition-colors hover:bg-danger/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending && <Loader2 size={15} className="animate-spin" />}
          Delete template
        </button>
      </div>
    </dialog>
  );
}
