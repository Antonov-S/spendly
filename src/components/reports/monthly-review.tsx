"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import {
  generateMonthlyReview,
  type MonthlyReviewNarrative,
} from "@/actions/ai/monthly-review";

/** Relative label off `generatedAt`, so a re-run visibly resets (spec D10). */
function generatedLabel(generatedAt: number, now: number): string {
  const mins = Math.floor((now - generatedAt) / 60000);
  if (mins < 1) return "Generated just now";
  if (mins === 1) return "Generated 1 min ago";
  if (mins < 60) return `Generated ${mins} min ago`;
  return "Generated over an hour ago";
}

/**
 * Pro-only Monthly Review Narrative — a **standalone AI-accented section** on
 * `/reports`, deliberately pulled out of the period-scoped chart grid: it always
 * describes **this calendar month vs last** (fixed window, spec D3) and never
 * reads the period pills, so a self-describing "This month vs last month" label
 * removes any "is this a 3/12-month summary?" ambiguity. An explicit "Generate
 * summary" button (a deliberate, billable request) calls the read-only AI action
 * and renders 1–4 plain-language sentences. Every failure is fail-open — the
 * charts below always render regardless. Account scope arrives as a prop;
 * changing the account remounts this card (the page's Suspense key includes the
 * account), so a stale narrative can't linger across scopes.
 */
export function MonthlyReview({ accountId }: { accountId: string | undefined }) {
  const [narrative, setNarrative] = useState<MonthlyReviewNarrative | null>(null);
  const [errorNote, setErrorNote] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [isPending, startGenerating] = useTransition();
  const runRef = useRef(0);

  // Keep the "Generated N min ago" label live while a narrative is shown.
  useEffect(() => {
    if (generatedAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, [generatedAt]);

  function handleGenerate() {
    setErrorNote(null);
    const myRun = ++runRef.current;
    startGenerating(async () => {
      const res = await generateMonthlyReview({ accountId: accountId ?? null });
      if (runRef.current !== myRun) return; // discard a superseded run
      if (!res.success) {
        setErrorNote(
          res.reason === "no_match"
            ? "Not enough data yet to summarize this month."
            : res.reason === "rate_limited"
              ? "You've hit the hourly limit — try again shortly."
              : "Couldn't generate a summary right now."
        );
        setNarrative(null);
        return;
      }
      setNarrative(res.data);
      setGeneratedAt(Date.now());
      setNow(Date.now());
    });
  }

  return (
    <section className="flex flex-col rounded-xl border border-ai/25 bg-surface">
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <span className="flex size-6 items-center justify-center rounded-md bg-ai/10 text-ai">
          <Sparkles className="size-3.5" />
        </span>
        <div>
          <h2 className="text-[13px] font-medium text-ink">Monthly review</h2>
          <p className="mt-0.5 text-[11px] text-ink-3">This month vs last month</p>
        </div>
      </div>

      <div className="flex flex-1 flex-col p-4">
        {narrative ? (
          <div className="flex flex-col gap-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
              {narrative.periodLabel}
            </p>
            <ul className="flex flex-col gap-2">
              {narrative.summary.map((line, i) => (
                <li
                  key={i}
                  className="flex gap-2 text-[13px] leading-relaxed text-ink"
                >
                  <span
                    aria-hidden
                    className="mt-1.5 size-1 shrink-0 rounded-full bg-ai"
                  />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
              <p className="text-[10px] text-ink-3">
                AI-generated — figures from your data.
                {generatedAt !== null && (
                  <span className="ml-1.5 text-ink-3">
                    · {generatedLabel(generatedAt, now)}
                  </span>
                )}
              </p>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={isPending}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-ai transition-colors hover:bg-ai/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Sparkles className="size-3.5" />
                {isPending ? "Summarizing…" : "Regenerate"}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-start gap-3">
            <p className="text-[12px] text-ink-3">
              See how this month compares to last — generated by AI.
            </p>
            {errorNote && <p className="text-[12px] text-ink-2">{errorNote}</p>}
            <button
              type="button"
              onClick={handleGenerate}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-md border border-ai/30 bg-ai/10 px-2.5 py-1.5 text-[12px] font-medium text-ai transition-colors hover:bg-ai/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Sparkles className="size-3.5" />
              {isPending ? "Summarizing…" : "Generate summary"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
