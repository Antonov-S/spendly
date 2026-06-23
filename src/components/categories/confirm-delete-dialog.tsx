"use client";

import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";

interface ConfirmDeleteCategoryDialogProps {
  /** Category name shown in the prompt; null when none is targeted. */
  name: string | null;
  /** Non-deleted transactions that become Uncategorized (SetNull). */
  transactionCount: number;
  /** Active recurring templates that become Uncategorized (SetNull). */
  recurringCount: number;
  /** Active budgets that are DELETED (Cascade). */
  budgetCount: number;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  pending: boolean;
}

/** "1 X" / "N Xs" with a conditional plural. */
function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * Native <dialog> confirm for hard-deleting a user category. Categories have no
 * soft delete / undo. The copy distinguishes the two FK outcomes (spec §7):
 * transactions + recurring templates go Uncategorized (SetNull); budgets are
 * DELETED (Cascade). Counts come from the already-loaded row — no extra query.
 */
export function ConfirmDeleteCategoryDialog({
  name,
  transactionCount,
  recurringCount,
  budgetCount,
  open,
  onClose,
  onConfirm,
  pending,
}: ConfirmDeleteCategoryDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  // Uncategorized (SetNull) clause: transactions and/or recurring templates.
  const uncategorizedParts: string[] = [];
  if (transactionCount > 0) {
    uncategorizedParts.push(plural(transactionCount, "transaction"));
  }
  if (recurringCount > 0) {
    uncategorizedParts.push(plural(recurringCount, "recurring template"));
  }
  const uncategorizedNote =
    uncategorizedParts.length > 0
      ? ` This leaves ${uncategorizedParts.join(" and ")} uncategorized.`
      : "";

  // Deleted (Cascade) clause: budgets.
  const deletedNote =
    budgetCount > 0 ? ` It also deletes ${plural(budgetCount, "budget")}.` : "";

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="delete-category-title"
      onClose={onClose}
      className="m-auto w-[min(92vw,28rem)] rounded-xl border border-line bg-surface p-6 text-ink backdrop:bg-black/60"
    >
      <h3 id="delete-category-title" className="text-[15px] font-medium text-ink">
        Delete this category?
      </h3>
      <p className="mt-2 text-[12px] text-ink-2">
        This will delete{" "}
        <span className="font-medium text-ink">{name ?? "this category"}</span>.
        {uncategorizedNote}
        {deletedNote} This cannot be undone.
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
          Delete category
        </button>
      </div>
    </dialog>
  );
}
