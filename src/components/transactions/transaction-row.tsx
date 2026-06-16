import { ArrowLeftRight } from "lucide-react";
import { CategoryIcon } from "@/components/dashboard/category-icon";
import { formatCurrency, formatSigned } from "@/lib/format";
import { resolveIcon } from "@/lib/icon-map";
import { TYPE_BORDER_COLOR } from "@/lib/transactions";
import { cn } from "@/lib/utils";
import type { CategoryRef } from "@/types/dashboard";
import type { FeedTransaction } from "@/types/transactions";

/** Columns: Description | Category | Account | Amount (date lives in the group header). */
const ROW_GRID =
  "grid items-center gap-3 grid-cols-[1fr_auto] md:grid-cols-[minmax(0,1.7fr)_1.1fr_1fr_minmax(72px,auto)]";

const UNCATEGORIZED: CategoryRef = {
  name: "Uncategorized",
  color: "#D1D5DB",
  icon: resolveIcon("HelpCircle"),
};

export function TransactionRow({
  txn,
  onSelect,
}: {
  txn: FeedTransaction;
  /** Open the edit drawer for this row. */
  onSelect: () => void;
}) {
  const isTransfer = txn.type === "TRANSFER";
  const isIncome = txn.type === "INCOME";

  const category: CategoryRef = txn.category
    ? {
        name: txn.category.name,
        color: txn.category.color,
        icon: resolveIcon(txn.category.icon),
      }
    : UNCATEGORIZED;

  const accountLabel =
    isTransfer && txn.counterpartyAccountName
      ? `${txn.accountName} → ${txn.counterpartyAccountName}`
      : txn.accountName;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        ROW_GRID,
        "w-full cursor-pointer border-b border-line px-4 py-2.5 text-left transition-colors hover:bg-surface-2"
      )}
      style={{ boxShadow: `inset 2px 0 0 ${TYPE_BORDER_COLOR[txn.type]}` }}
    >
      {/* Description (+ mobile secondary line) */}
      <div className="flex min-w-0 items-center gap-2.5">
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
          <span className="truncate text-[10px] text-ink-3 md:hidden">
            {isTransfer ? accountLabel : category.name}
          </span>
        </span>
      </div>

      {/* Category (hidden for transfers and on mobile) */}
      <div className="hidden min-w-0 items-center gap-1.5 md:flex">
        {!isTransfer && (
          <>
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: category.color }}
            />
            <span className="truncate text-[12px] text-ink-2">
              {category.name}
            </span>
          </>
        )}
      </div>

      {/* Account */}
      <span className="hidden truncate text-[12px] text-ink-3 md:block">
        {accountLabel}
      </span>

      {/* Amount — magnitude in grey for transfers, signed otherwise */}
      <span
        className={cn(
          "text-right text-[12px] font-medium tabular-nums",
          isTransfer ? "text-ink-3" : isIncome ? "text-success" : "text-ink"
        )}
      >
        {isTransfer ? formatCurrency(txn.amount) : formatSigned(txn.amount)}
      </span>
    </button>
  );
}
