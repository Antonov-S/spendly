"use client";

import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";

interface ConfirmDeleteTagDialogProps {
  /** Tag name shown in the prompt; null when none is targeted. */
  name: string | null;
  /** Non-deleted transactions that lose this tag (the join rows cascade away). */
  transactionCount: number;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  pending: boolean;
}

/** "1 transaction" / "N transactions" with a conditional plural. */
function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * Native <dialog> confirm for hard-deleting a tag. Unlike categories there is no
 * destructive cascade: deleting a tag only removes its `TransactionTag` join
 * rows — the transactions survive, they just lose the label. So the copy is a
 * one-liner. The count comes from the already-loaded row — no extra query.
 */
export function ConfirmDeleteTagDialog({
  name,
  transactionCount,
  open,
  onClose,
  onConfirm,
  pending,
}: ConfirmDeleteTagDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  const removalNote =
    transactionCount > 0
      ? ` This removes the tag from ${plural(
          transactionCount,
          "transaction"
        )}. The transactions are kept.`
      : "";

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="delete-tag-title"
      onClose={onClose}
      className="m-auto w-[min(92vw,28rem)] rounded-xl border border-line bg-surface p-6 text-ink backdrop:bg-black/60"
    >
      <h3 id="delete-tag-title" className="text-[15px] font-medium text-ink">
        Delete this tag?
      </h3>
      <p className="mt-2 text-[12px] text-ink-2">
        This will delete{" "}
        <span className="font-medium text-ink">{name ?? "this tag"}</span>.
        {removalNote} This cannot be undone.
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
          Delete tag
        </button>
      </div>
    </dialog>
  );
}
