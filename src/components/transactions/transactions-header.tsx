"use client";

import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { useAppShell } from "@/components/layout/app-shell";

interface TransactionsHeaderProps {
  /** Soft-deleted transaction count — drives the "Recently deleted" link/badge. */
  deletedCount: number;
}

/**
 * Page header for the transactions feed. The "Add transaction" CTA opens the
 * shared create/edit drawer (create mode) via the app-shell context. A
 * "Recently deleted" link surfaces the trash recovery surface, shown only when
 * there is something to recover.
 */
export function TransactionsHeader({ deletedCount }: TransactionsHeaderProps) {
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

      <div className="flex items-center gap-2">
        {deletedCount > 0 && (
          <Link
            href="/trash"
            className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[12px] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <Trash2 size={14} />
            Recently deleted
            <span className="rounded-full bg-surface-2 px-1.5 text-[11px] tabular-nums text-ink-3">
              {deletedCount}
            </span>
          </Link>
        )}

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
    </div>
  );
}
