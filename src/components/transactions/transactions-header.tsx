import { Plus } from "lucide-react";

/**
 * Page header for the transactions feed. The "Add transaction" CTA is rendered
 * but intentionally inert in Part 1 — the create/edit drawer arrives in Part 2.
 */
export function TransactionsHeader() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 className="text-[20px] font-medium leading-none text-ink">
          Transactions
        </h1>
        <p className="mt-1.5 text-[11px] text-ink-3">
          Your full transaction history
        </p>
      </div>

      {/* Inert in Part 1 (no onClick) — opens the drawer in Part 2. */}
      <button
        type="button"
        className="flex items-center gap-1.5 rounded-lg bg-success px-4 py-2 text-[13px] font-semibold text-white ring-1 ring-inset ring-white/15 transition-colors hover:bg-success/90"
      >
        <Plus size={16} strokeWidth={2.5} />
        Add transaction
      </button>
    </div>
  );
}
