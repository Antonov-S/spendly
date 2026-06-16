"use client";

import { Plus } from "lucide-react";
import { useAppShell } from "@/components/layout/app-shell";

/**
 * Page header for the transactions feed. The "Add transaction" CTA opens the
 * shared create/edit drawer (create mode) via the app-shell context.
 */
export function TransactionsHeader() {
  const { openDrawer } = useAppShell();

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

      {/* Hidden on mobile — the floating + button in the bottom nav covers create. */}
      <button
        type="button"
        onClick={() => openDrawer()}
        className="hidden items-center gap-1.5 rounded-lg bg-success px-4 py-2 text-[13px] font-semibold text-white ring-1 ring-inset ring-white/15 transition-colors hover:bg-success/90 md:flex"
      >
        <Plus size={16} strokeWidth={2.5} />
        Add transaction
      </button>
    </div>
  );
}
