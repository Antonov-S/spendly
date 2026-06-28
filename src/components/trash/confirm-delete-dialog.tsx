"use client";

import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";

interface ConfirmDeleteDialogProps {
  /**
   * What is being permanently deleted. `single` is one row (with transfer-aware
   * copy when `isTransfer`); `all` is the "Empty trash" bulk action.
   */
  mode: "single" | "all";
  /** Row count, used in the "Empty trash" copy. */
  count: number;
  /** Whether the targeted single row is a transfer (removes both legs). */
  isTransfer: boolean;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  pending: boolean;
}

/**
 * Native <dialog> confirm for an irreversible permanent delete. No typing-to-
 * confirm — a single Delete forever / Cancel pair suffices; the copy makes the
 * irreversibility explicit. Mirrors the recurring/goals confirm pattern.
 */
export function ConfirmDeleteDialog({
  mode,
  count,
  isTransfer,
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

  const title =
    mode === "all"
      ? `Permanently delete ${count} ${count === 1 ? "transaction" : "transactions"}?`
      : "Delete this transaction forever?";

  const body =
    mode === "all"
      ? "This empties your trash. The transactions are removed for good and can't be restored."
      : isTransfer
        ? "This permanently deletes both sides of the transfer. This can't be undone."
        : "This permanently deletes the transaction. This can't be undone.";

  const confirmLabel = mode === "all" ? "Empty trash" : "Delete forever";

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="trash-delete-title"
      onClose={onClose}
      className="m-auto w-[min(92vw,28rem)] rounded-xl border border-line bg-surface p-6 text-ink backdrop:bg-black/60"
    >
      <h3 id="trash-delete-title" className="text-[15px] font-medium text-ink">
        {title}
      </h3>
      <p className="mt-2 text-[12px] text-ink-2">{body}</p>

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
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
