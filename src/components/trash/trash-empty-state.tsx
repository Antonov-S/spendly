import Link from "next/link";
import { Trash2 } from "lucide-react";

/**
 * Calm empty treatment for `/trash` — active guidance per the "never a blank
 * state" principle, with a path back to the feed.
 */
export function TrashEmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-line bg-surface px-6 py-16 text-center">
      <Trash2 size={28} className="text-ink-3" />
      <p className="text-[13px] text-ink-2">Trash is empty.</p>
      <p className="text-[11px] text-ink-3">
        Deleted transactions show up here so you can restore them.
      </p>
      <Link
        href="/transactions"
        className="text-[12px] font-medium text-info transition-opacity hover:opacity-80"
      >
        Back to transactions
      </Link>
    </div>
  );
}
