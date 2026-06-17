"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { toast } from "sonner";
import { CategoryIcon } from "@/components/dashboard/category-icon";
import { confirmDraft, dismissDraft } from "@/actions/recurring";
import { isDraftOverdue } from "@/lib/recurring";
import { formatCurrency } from "@/lib/format";
import { toDateInputValue } from "@/lib/date";
import { resolveIcon } from "@/lib/icon-map";
import { cn } from "@/lib/utils";
import type { DraftRow } from "@/lib/recurring";

interface DraftsInboxProps {
  drafts: DraftRow[];
}

/** Format a stored calendar date as "Jun 16, 2026". */
function formatDate(date: Date): string {
  return new Date(toDateInputValue(date) + "T00:00:00").toLocaleDateString(
    "en-US",
    { month: "short", day: "numeric", year: "numeric" }
  );
}

export function DraftsInbox({ drafts }: DraftsInboxProps) {
  return (
    <section className="rounded-xl border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <h2 className="text-[13px] font-medium text-ink">
          Pending confirmation
        </h2>
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-success/15 px-1.5 text-[11px] font-medium text-success tabular-nums">
          {drafts.length}
        </span>
      </div>
      <ul className="flex flex-col">
        {drafts.map((draft) => (
          <DraftCard key={draft.id} draft={draft} />
        ))}
      </ul>
    </section>
  );
}

function DraftCard({ draft }: { draft: DraftRow }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const overdue = isDraftOverdue(draft.suggestedDate);
  const isIncome = draft.type === "INCOME";

  function handleConfirm() {
    startTransition(async () => {
      const res = await confirmDraft(draft.id);
      if (res.success) {
        toast.success("Transaction added");
        router.refresh();
      } else {
        toast.error(res.error ?? "Could not confirm the draft.");
      }
    });
  }

  function handleDismiss() {
    startTransition(async () => {
      const res = await dismissDraft(draft.id);
      if (res.success) {
        toast.success("Draft dismissed");
        router.refresh();
      } else {
        toast.error(res.error ?? "Could not dismiss the draft.");
      }
    });
  }

  return (
    <li className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
      <span
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
          isIncome ? "bg-success/15 text-success" : "bg-danger/15 text-danger"
        )}
      >
        {isIncome ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-ink">
            {draft.templateName}
          </span>
          {draft.category && (
            <CategoryIcon
              category={{
                name: draft.category.name,
                color: draft.category.color,
                icon: resolveIcon(draft.category.icon),
              }}
              size="sm"
            />
          )}
        </div>
        <p className="mt-0.5 text-[11px] text-ink-3">
          <span className={cn(overdue && "text-warning")}>
            {overdue ? "Overdue · " : ""}
            {formatDate(draft.suggestedDate)}
          </span>{" "}
          · {draft.accountName}
        </p>
      </div>

      <span
        className={cn(
          "shrink-0 text-[13px] font-medium tabular-nums",
          isIncome ? "text-success" : "text-ink"
        )}
      >
        {isIncome ? "+" : "−"}
        {formatCurrency(draft.suggestedAmount)}
      </span>

      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={isPending}
          aria-label="Confirm draft"
          className="flex h-8 items-center gap-1 rounded-lg bg-success px-2.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          <Check size={14} />
          <span className="hidden sm:inline">Confirm</span>
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          disabled={isPending}
          aria-label="Dismiss draft"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-60"
        >
          <X size={14} />
        </button>
      </div>
    </li>
  );
}
