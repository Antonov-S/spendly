"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  restoreTransaction,
  hardDeleteTransaction,
  emptyTrash,
} from "@/actions/transactions";
import { TrashRow } from "@/components/trash/trash-row";
import { TrashEmptyState } from "@/components/trash/trash-empty-state";
import { ConfirmDeleteDialog } from "@/components/trash/confirm-delete-dialog";
import type { TrashTransaction } from "@/types/transactions";

interface TrashViewProps {
  rows: TrashTransaction[];
  /** Request-anchored "now" for relative deletion labels. */
  nowMs: number;
}

interface DialogState {
  open: boolean;
  mode: "single" | "all";
  targetId: string | null;
  isTransfer: boolean;
}

const CLOSED_DIALOG: DialogState = {
  open: false,
  mode: "single",
  targetId: null,
  isTransfer: false,
};

/** How long a rolling-count toast stays visible before its counter resets. */
const TOAST_WINDOW_MS = 4000;

/**
 * Coordinator for the `/trash` recovery list. Fires restore / hard-delete /
 * empty-trash actions, shows a single rolling-count toast per action kind, and
 * refreshes the server-rendered list after each mutation. The "Empty trash"
 * affordance is hidden (not disabled) when the list is empty.
 */
export function TrashView({ rows, nowMs }: TrashViewProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<DialogState>(CLOSED_DIALOG);

  // One reused toast id per action kind, with a rolling count so rapid actions
  // replace rather than stack. The counter resets once the toast window lapses.
  const restore = useRef({ count: 0, timer: null as ReturnType<typeof setTimeout> | null });
  const remove = useRef({ count: 0, timer: null as ReturnType<typeof setTimeout> | null });

  function rollingToast(
    ref: typeof restore,
    id: string,
    label: string
  ) {
    ref.current.count += 1;
    const n = ref.current.count;
    toast.success(n === 1 ? label : `${label} ${n}`, { id });
    if (ref.current.timer) clearTimeout(ref.current.timer);
    ref.current.timer = setTimeout(() => {
      ref.current.count = 0;
    }, TOAST_WINDOW_MS);
  }

  function handleRestore(id: string) {
    startTransition(async () => {
      const res = await restoreTransaction(id);
      if (!res.success) {
        toast.error(res.error ?? "Could not restore the transaction.");
        return;
      }
      rollingToast(restore, "trash-restore", "Restored");
      router.refresh();
    });
  }

  function handleConfirm() {
    const { mode, targetId } = dialog;
    startTransition(async () => {
      if (mode === "all") {
        const res = await emptyTrash();
        if (!res.success) {
          toast.error(res.error ?? "Could not empty the trash.");
          return;
        }
        toast.success("Trash emptied");
      } else {
        if (!targetId) return;
        const res = await hardDeleteTransaction(targetId);
        if (!res.success) {
          toast.error(res.error ?? "Could not delete the transaction.");
          return;
        }
        rollingToast(remove, "trash-delete", "Deleted");
      }
      setDialog(CLOSED_DIALOG);
      router.refresh();
    });
  }

  const isEmpty = rows.length === 0;

  return (
    <>
      <header className="flex items-center gap-3">
        <div>
          <h1 className="text-[20px] font-medium leading-none text-ink">
            Recently deleted
          </h1>
          <p className="mt-1.5 text-[12px] text-ink-3">
            Restore a transaction or remove it for good
          </p>
        </div>

        {/* Hidden when empty — the empty state already says "nothing here". */}
        {!isEmpty && (
          <button
            type="button"
            onClick={() =>
              setDialog({
                open: true,
                mode: "all",
                targetId: null,
                isTransfer: false,
              })
            }
            disabled={isPending}
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[13px] font-medium text-danger transition-colors hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 size={16} />
            <span className="hidden sm:inline">Empty trash</span>
          </button>
        )}
      </header>

      {isEmpty ? (
        <TrashEmptyState />
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          {rows.map((txn) => (
            <TrashRow
              key={txn.id}
              txn={txn}
              nowMs={nowMs}
              busy={isPending}
              onRestore={() => handleRestore(txn.id)}
              onDeleteForever={() =>
                setDialog({
                  open: true,
                  mode: "single",
                  targetId: txn.id,
                  isTransfer: txn.type === "TRANSFER",
                })
              }
            />
          ))}
        </div>
      )}

      <ConfirmDeleteDialog
        mode={dialog.mode}
        count={rows.length}
        isTransfer={dialog.isTransfer}
        open={dialog.open}
        pending={isPending}
        onClose={() => setDialog(CLOSED_DIALOG)}
        onConfirm={handleConfirm}
      />
    </>
  );
}
