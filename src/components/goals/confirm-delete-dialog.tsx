"use client";

import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";

interface ConfirmDeleteGoalDialogProps {
  /** Goal name shown in the prompt; null when no goal is targeted. */
  name: string | null;
  /** Number of contributions that will be deleted alongside the goal. */
  contributionCount: number;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  pending: boolean;
}

/**
 * Native <dialog> confirm for hard-deleting a goal. Goals have no soft delete /
 * undo, so a confirm step guards the irreversible cascade. The count comes from
 * the already-loaded card data — no extra query.
 */
export function ConfirmDeleteGoalDialog({
  name,
  contributionCount,
  open,
  onClose,
  onConfirm,
  pending,
}: ConfirmDeleteGoalDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  const contributionNote =
    contributionCount > 0
      ? ` This also deletes ${contributionCount} ${
          contributionCount === 1 ? "contribution" : "contributions"
        }.`
      : "";

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="delete-goal-title"
      onClose={onClose}
      className="m-auto w-[min(92vw,28rem)] rounded-xl border border-line bg-surface p-6 text-ink backdrop:bg-black/60"
    >
      <h3 id="delete-goal-title" className="text-[15px] font-medium text-ink">
        Delete this goal?
      </h3>
      <p className="mt-2 text-[12px] text-ink-2">
        This will delete{" "}
        <span className="font-medium text-ink">{name ?? "this goal"}</span>.
        {contributionNote} This cannot be undone.
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
          Delete goal
        </button>
      </div>
    </dialog>
  );
}
