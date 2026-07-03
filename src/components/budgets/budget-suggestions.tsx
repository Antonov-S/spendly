"use client";

import { useRef, useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { createBudget } from "@/actions/budgets";
import { suggestBudgets } from "@/actions/ai/suggest-budgets";
import {
  trackBudgetAccepted,
  trackBudgetDismissed,
} from "@/actions/ai/track-budget-outcome";
import { CategoryIcon } from "@/components/dashboard/category-icon";
import { resolveIcon } from "@/lib/icon-map";
import { cn } from "@/lib/utils";
import type { BudgetSuggestion } from "@/lib/budget-suggest";

/**
 * Pro-only Smart Budget Suggestions panel on `/budgets` (above the list / empty
 * state). Proposes per-category ceilings from the user's own history — every
 * amount is deterministic (D1); the model only phrases each rationale. **Read-
 * only: accepting a row goes through the existing `createBudget`; nothing is
 * written by the AI.** Every failure is fail-open — the manual "Add budget" flow
 * and starter presets stay available regardless.
 *
 * State is local: stepping the period navigates (`/budgets?month=…`), which
 * remounts this component via the page's Suspense key, clearing any shown
 * suggestions computed for another month. `suggestRunRef` additionally discards a
 * slow in-flight result within one mount.
 */
export function BudgetSuggestions({
  period,
}: {
  period: { month: number; year: number };
}) {
  const router = useRouter();
  const [periodLabel, setPeriodLabel] = useState<string | null>(null);
  const [rows, setRows] = useState<BudgetSuggestion[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [aiNotes, setAiNotes] = useState(false);
  const [suggestedCount, setSuggestedCount] = useState(0);
  const [acceptedCount, setAcceptedCount] = useState(0);
  const [promptVersion, setPromptVersion] = useState<number | undefined>();
  const [errorNote, setErrorNote] = useState<string | null>(null);
  const [isSuggesting, startSuggesting] = useTransition();
  const [isAccepting, startAccepting] = useTransition();
  const suggestRunRef = useRef(0);

  const hasResult = rows.length > 0 || acceptedCount > 0;

  function handleSuggest() {
    setErrorNote(null);
    const myRun = ++suggestRunRef.current;
    startSuggesting(async () => {
      const res = await suggestBudgets({
        month: period.month,
        year: period.year,
      });
      if (suggestRunRef.current !== myRun) return; // discard a superseded run
      if (!res.success) {
        setErrorNote(
          res.reason === "no_match"
            ? "Not enough spending history yet to suggest budgets."
            : res.reason === "rate_limited"
              ? "You've hit the hourly limit — try again shortly."
              : "Couldn't suggest budgets right now."
        );
        return;
      }
      setPeriodLabel(res.data.periodLabel);
      setRows(res.data.suggestions);
      setAmounts(
        Object.fromEntries(
          res.data.suggestions.map((s) => [s.categoryId, String(s.suggestedAmount)])
        )
      );
      setAiNotes(res.data.aiNotes);
      setSuggestedCount(res.data.suggestions.length);
      setAcceptedCount(0);
      setPromptVersion(res.data.promptVersion);
    });
  }

  /** Create one budget; returns true on success. Removes the row + toasts caller-side. */
  async function accept(row: BudgetSuggestion): Promise<boolean> {
    const amount = Number(amounts[row.categoryId]);
    const res = await createBudget({
      categoryId: row.categoryId,
      amount,
      month: period.month,
      year: period.year,
      rollover: false,
    });
    if (!res.success) {
      toast.error(res.error ?? "Could not create the budget.");
      return false;
    }
    void trackBudgetAccepted({
      promptVersion,
      edited: amount !== row.suggestedAmount,
    });
    return true;
  }

  function handleAcceptRow(row: BudgetSuggestion) {
    startAccepting(async () => {
      if (!(await accept(row))) return;
      setRows((prev) => prev.filter((r) => r.categoryId !== row.categoryId));
      setAcceptedCount((n) => n + 1);
      toast.success(`Added ${row.name} budget`);
      router.refresh();
    });
  }

  function handleAcceptAll() {
    startAccepting(async () => {
      const current = rows;
      let added = 0;
      const remaining: BudgetSuggestion[] = [];
      for (const row of current) {
        if (await accept(row)) added += 1;
        else remaining.push(row);
      }
      setRows(remaining);
      setAcceptedCount((n) => n + added);
      if (added > 0) {
        toast.success(`Added ${added} ${added === 1 ? "budget" : "budgets"}`);
        router.refresh();
      }
    });
  }

  function handleDismiss() {
    void trackBudgetDismissed({ promptVersion, suggestedCount, acceptedCount });
    setRows([]);
    setAmounts({});
    setAcceptedCount(0);
    setSuggestedCount(0);
    setPeriodLabel(null);
    setErrorNote(null);
  }

  return (
    <section className="flex flex-col rounded-xl border border-ai/25 bg-surface">
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <span className="flex size-6 items-center justify-center rounded-md bg-ai/10 text-ai">
          <Sparkles className="size-3.5" />
        </span>
        <div className="flex-1">
          <h2 className="text-[13px] font-medium text-ink">Budget suggestions</h2>
          <p className="mt-0.5 text-[11px] text-ink-3">
            {periodLabel
              ? `Based on your spending before ${periodLabel} — you confirm each one`
              : "Based on your last 3 months of spending — you confirm each one"}
          </p>
        </div>
        {hasResult && (
          <button
            type="button"
            onClick={handleDismiss}
            className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            Dismiss
          </button>
        )}
      </div>

      <div className="flex flex-col p-4">
        {rows.length === 0 ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-[12px] text-ink-3">
              {acceptedCount > 0
                ? "All set — every suggestion was added."
                : "Suggested amounts, computed from your history — edit and confirm each one."}
            </p>
            {errorNote && <p className="text-[12px] text-ink-2">{errorNote}</p>}
            <button
              type="button"
              onClick={handleSuggest}
              disabled={isSuggesting}
              className="inline-flex items-center gap-1.5 rounded-md border border-ai/30 bg-ai/10 px-2.5 py-1.5 text-[12px] font-medium text-ai transition-colors hover:bg-ai/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Sparkles className="size-3.5" />
              {isSuggesting ? "Analyzing your spending…" : "Suggest budgets"}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            <ul className="flex flex-col divide-y divide-line">
              {rows.map((row) => (
                <li
                  key={row.categoryId}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 first:pt-0"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <CategoryIcon
                      category={{
                        name: row.name,
                        color: row.color,
                        icon: resolveIcon(row.icon),
                      }}
                      size="sm"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium text-ink">
                          {row.name}
                        </span>
                        <span
                          className={cn(
                            "shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide",
                            row.variability === "variable"
                              ? "bg-warning/10 text-warning"
                              : "bg-surface-2 text-ink-3"
                          )}
                        >
                          {row.variability === "variable"
                            ? "Varies month to month"
                            : "Consistent spending"}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-ink-3">
                        {row.note}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex items-center rounded-lg border border-line bg-app px-2.5">
                      <span className="text-[14px] font-medium text-ink-3">€</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={amounts[row.categoryId] ?? ""}
                        onChange={(e) =>
                          setAmounts((prev) => ({
                            ...prev,
                            [row.categoryId]: e.target.value,
                          }))
                        }
                        aria-label={`${row.name} monthly limit`}
                        className="w-16 bg-transparent py-1.5 pl-1 text-[14px] font-medium text-ink outline-none"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleAcceptRow(row)}
                      disabled={isAccepting}
                      className="rounded-md bg-success px-2.5 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
              <p className="text-[10px] text-ink-3">
                {aiNotes
                  ? "AI-phrased — amounts computed from your data."
                  : "Computed from your data."}
              </p>
              {rows.length > 1 && (
                <button
                  type="button"
                  onClick={handleAcceptAll}
                  disabled={isAccepting}
                  className="inline-flex items-center gap-1 rounded-md border border-success/30 bg-success/10 px-2.5 py-1 text-[12px] font-medium text-success transition-colors hover:bg-success/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isAccepting ? "Adding…" : "Add all"}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
