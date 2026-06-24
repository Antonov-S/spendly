import Link from "next/link";
import { CategoryIcon } from "@/components/dashboard/category-icon";
import { formatSigned } from "@/lib/format";
import { TYPE_BORDER_COLOR } from "@/lib/transactions";
import { cn } from "@/lib/utils";
import type { TransactionRow } from "@/types/dashboard";

const ROW_GRID =
  "grid items-center gap-3 grid-cols-[1fr_auto] md:grid-cols-[minmax(0,1.7fr)_1.1fr_84px_96px_minmax(64px,auto)]";

type DateGroup = "Today" | "Yesterday" | "Earlier";
const GROUP_ORDER: DateGroup[] = ["Today", "Yesterday", "Earlier"];

function groupFor(dateLabel: string): DateGroup {
  if (dateLabel === "Today") return "Today";
  if (dateLabel === "Yesterday") return "Yesterday";
  return "Earlier";
}

interface TransactionsPanelProps {
  rows: TransactionRow[];
  count: number;
}

export function TransactionsPanel({ rows, count }: TransactionsPanelProps) {
  const grouped = GROUP_ORDER.map((group) => ({
    group,
    rows: rows.filter((tx) => groupFor(tx.dateLabel) === group),
  })).filter((g) => g.rows.length > 0);

  return (
    <section className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface">
      {/* Panel header */}
      <div className="flex items-center gap-2 px-4 py-3.5">
        <h2 className="text-[13px] font-medium text-ink">Recent transactions</h2>
        <span className="text-[11px] text-ink-3">{count} this month</span>
        <Link
          href="/transactions"
          className="ml-auto text-[11px] text-info transition-opacity hover:opacity-80"
        >
          See all →
        </Link>
      </div>

      {/* Column header */}
      <div
        className={cn(
          ROW_GRID,
          "border-y border-line px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-ink-3"
        )}
      >
        <span>Description</span>
        <span className="hidden md:block">Category</span>
        <span className="hidden md:block">Date</span>
        <span className="hidden md:block">Account</span>
        <span className="text-right">Amount</span>
      </div>

      {/* Date-grouped rows */}
      <div className="flex flex-col">
        {grouped.map(({ group, rows: groupRows }) => (
          <div key={group}>
            <div className="bg-app/40 px-4 py-1.5 text-[10px] font-medium uppercase tracking-wide text-ink-3">
              {group}
            </div>
            {groupRows.map((tx) => (
              <TransactionRowItem key={tx.id} tx={tx} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function TransactionRowItem({ tx }: { tx: TransactionRow }) {
  return (
    <div
      className={cn(
        ROW_GRID,
        "border-b border-line px-4 py-2.5 transition-colors hover:bg-surface-2"
      )}
      style={{ boxShadow: `inset 2px 0 0 ${TYPE_BORDER_COLOR[tx.type]}` }}
    >
      {/* Description */}
      <div className="flex min-w-0 items-center gap-2.5">
        <CategoryIcon category={tx.category} />
        <span className="truncate text-[12px] text-ink">{tx.description}</span>
      </div>

      {/* Category */}
      <div className="hidden min-w-0 items-center gap-1.5 md:flex">
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: tx.category.color }}
        />
        <span className="truncate text-[12px] text-ink-2">
          {tx.category.name}
        </span>
      </div>

      {/* Date */}
      <span className="hidden text-[12px] text-ink-3 md:block">
        {tx.dateLabel}
      </span>

      {/* Account */}
      <span className="hidden text-[12px] text-ink-3 md:block">
        {tx.account}
      </span>

      {/* Amount */}
      <span
        className={cn(
          "text-right text-[12px] font-medium tabular-nums",
          tx.isIncome ? "text-success" : "text-ink"
        )}
      >
        {formatSigned(tx.amount)}
      </span>
    </div>
  );
}
