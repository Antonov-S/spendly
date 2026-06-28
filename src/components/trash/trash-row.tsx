import { ArrowLeftRight, RotateCcw, Trash2 } from "lucide-react";
import { CategoryIcon } from "@/components/dashboard/category-icon";
import { formatCurrency, formatSigned } from "@/lib/format";
import { resolveIcon } from "@/lib/icon-map";
import { TYPE_BORDER_COLOR, formatDeletedAt } from "@/lib/transactions";
import { UNCATEGORIZED } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { CategoryRef } from "@/types/dashboard";
import type { TrashTransaction } from "@/types/transactions";

const UNCATEGORIZED_REF: CategoryRef = {
  name: UNCATEGORIZED.name,
  color: UNCATEGORIZED.color,
  icon: resolveIcon(UNCATEGORIZED.icon),
};

interface TrashRowProps {
  txn: TrashTransaction;
  /** Request-anchored "now" for the relative "deleted X ago" label. */
  nowMs: number;
  onRestore: () => void;
  onDeleteForever: () => void;
  busy: boolean;
}

/**
 * Read-only trash row: mirrors the feed row's visuals (type-color border,
 * category icon, signed amount) plus a deletion-timestamp line, and trails two
 * actions — Restore and Delete forever. It is not click-to-edit; a trashed row
 * must be restored before it can be edited.
 */
export function TrashRow({
  txn,
  nowMs,
  onRestore,
  onDeleteForever,
  busy,
}: TrashRowProps) {
  const isTransfer = txn.type === "TRANSFER";
  const isIncome = txn.type === "INCOME";

  const category: CategoryRef = txn.category
    ? {
        name: txn.category.name,
        color: txn.category.color,
        icon: resolveIcon(txn.category.icon),
      }
    : UNCATEGORIZED_REF;

  const accountLabel =
    isTransfer && txn.counterpartyAccountName
      ? `${txn.accountName} → ${txn.counterpartyAccountName}`
      : txn.accountName;

  return (
    <div
      className="flex items-center gap-3 border-b border-line px-4 py-2.5"
      style={{ boxShadow: `inset 2px 0 0 ${TYPE_BORDER_COLOR[txn.type]}` }}
    >
      {/* Icon + description + deletion meta */}
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        {isTransfer ? (
          <span className="flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-md bg-surface-2 text-ink-3">
            <ArrowLeftRight size={13} strokeWidth={2} />
          </span>
        ) : (
          <CategoryIcon category={category} />
        )}
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[12px] text-ink">
            {txn.description}
          </span>
          <span className="truncate text-[10px] text-ink-3">
            {formatDeletedAt(txn.deletedAt, nowMs)} ·{" "}
            {isTransfer ? accountLabel : category.name}
          </span>
        </span>
      </div>

      {/* Amount — magnitude in grey for transfers, signed otherwise */}
      <span
        className={cn(
          "shrink-0 text-right text-[12px] font-medium tabular-nums",
          isTransfer ? "text-ink-3" : isIncome ? "text-success" : "text-ink"
        )}
      >
        {isTransfer ? formatCurrency(txn.amount) : formatSigned(txn.amount)}
      </span>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onRestore}
          disabled={busy}
          aria-label="Restore transaction"
          className="flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12px] font-medium text-ink transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RotateCcw size={14} />
          <span className="hidden sm:inline">Restore</span>
        </button>
        <button
          type="button"
          onClick={onDeleteForever}
          disabled={busy}
          aria-label="Delete forever"
          className="flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12px] font-medium text-danger transition-colors hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Trash2 size={14} />
          <span className="hidden sm:inline">Delete forever</span>
        </button>
      </div>
    </div>
  );
}
