"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { addContribution, deleteContribution } from "@/actions/goals";
import { BREAKPOINTS } from "@/lib/system-constants";
import { useMediaQuery } from "@/hooks/use-media-query";
import { todayDateInputValue } from "@/lib/date";
import { formatSigned } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ContributionRow } from "@/types/goals";

interface ContributionDrawerProps {
  open: boolean;
  goalId: string | null;
  goalName: string | null;
  /** Live contributions for the open goal (date-desc), re-derived from page data. */
  contributions: ContributionRow[];
  onClose: () => void;
}

/** "YYYY-MM-DD" → "Jun 20, 2026" without re-introducing a timezone shift. */
function formatDate(value: string): string {
  return new Date(value + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function ContributionDrawer({
  open,
  goalId,
  goalName,
  contributions,
  onClose,
}: ContributionDrawerProps) {
  const router = useRouter();
  const isDesktop = useMediaQuery(`(min-width: ${BREAKPOINTS.mobile}px)`);
  const [isPending, startTransition] = useTransition();

  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [isWithdrawal, setIsWithdrawal] = useState(false);
  const [date, setDate] = useState(todayDateInputValue());
  const [note, setNote] = useState("");

  // Reset the add form whenever the drawer opens for a goal.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setAmount("");
    setIsWithdrawal(false);
    setDate(todayDateInputValue());
    setNote("");
  }, [open, goalId]);

  const canSubmit = Number(amount) > 0 && date.length > 0;

  function handleAdd() {
    if (!goalId) return;
    setError(null);
    const magnitude = Number(amount);
    const signed = isWithdrawal ? -magnitude : magnitude;
    startTransition(async () => {
      const res = await addContribution({
        goalId,
        amount: signed,
        date,
        note: note.trim() ? note.trim() : null,
      });
      if (res.success) {
        toast.success(isWithdrawal ? "Withdrawal recorded" : "Contribution added");
        setAmount("");
        setNote("");
        router.refresh();
      } else {
        setError(res.error ?? "Something went wrong.");
      }
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const res = await deleteContribution(id);
      if (res.success) {
        toast.success("Contribution removed");
        router.refresh();
      } else {
        toast.error(res.error ?? "Could not remove the contribution.");
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side={isDesktop ? "right" : "bottom"}
        className={cn(
          "gap-0 p-0",
          isDesktop
            ? "w-full sm:max-w-105"
            : "h-[90vh] rounded-t-2xl border-t border-line"
        )}
      >
        <SheetHeader>
          <SheetTitle>{goalName ?? "Contributions"}</SheetTitle>
          <SheetDescription className="sr-only">
            Add a contribution or withdrawal and review past entries.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {/* Type toggle */}
          <div className="mb-4 flex gap-1 rounded-lg border border-line bg-app p-1">
            <ToggleButton
              active={!isWithdrawal}
              onClick={() => setIsWithdrawal(false)}
            >
              Contribution
            </ToggleButton>
            <ToggleButton
              active={isWithdrawal}
              onClick={() => setIsWithdrawal(true)}
            >
              Withdrawal
            </ToggleButton>
          </div>

          {/* Amount */}
          <div className="mb-4">
            <Label>Amount</Label>
            <div className="flex items-center rounded-lg border border-line bg-app px-3">
              <span
                className={cn(
                  "text-[22px] font-medium",
                  isWithdrawal ? "text-danger" : "text-ink-3"
                )}
              >
                {isWithdrawal ? "−€" : "€"}
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full bg-transparent py-2.5 pl-1 text-[22px] font-medium text-ink outline-none placeholder:text-ink-3"
              />
            </div>
          </div>

          {/* Date */}
          <div className="mb-4">
            <Label>Date</Label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-lg border border-line bg-app px-3 py-2 text-[13px] text-ink outline-none"
            />
          </div>

          {/* Note */}
          <div className="mb-4">
            <Label>Note (optional)</Label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. tax refund"
              maxLength={200}
              className="w-full rounded-lg border border-line bg-app px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3"
            />
          </div>

          {error && <p className="mb-3 text-[12px] text-danger">{error}</p>}

          <button
            type="button"
            onClick={handleAdd}
            disabled={isPending || !canSubmit}
            className="w-full rounded-lg bg-success py-2.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {isPending
              ? "Saving…"
              : isWithdrawal
                ? "Record withdrawal"
                : "Add contribution"}
          </button>

          {/* History */}
          <div className="mt-6">
            <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-3">
              History
            </h3>
            {contributions.length === 0 ? (
              <p className="text-[12px] text-ink-3">No contributions yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
                {contributions.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center gap-3 px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "text-[13px] font-medium tabular-nums",
                          c.amount < 0 ? "text-danger" : "text-success"
                        )}
                      >
                        {formatSigned(c.amount)}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-ink-3">
                        {formatDate(c.date)}
                        {c.note ? ` · ${c.note}` : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDelete(c.id)}
                      disabled={isPending}
                      aria-label="Delete contribution"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-surface-2 hover:text-danger disabled:opacity-60"
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 rounded-md py-1.5 text-[12px] font-medium transition-colors",
        active ? "bg-surface text-ink" : "text-ink-3 hover:text-ink"
      )}
    >
      {children}
    </button>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1.5 block text-[11px] font-medium text-ink-2">
      {children}
    </label>
  );
}
