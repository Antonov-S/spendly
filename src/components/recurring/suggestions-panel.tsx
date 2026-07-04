"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Repeat, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { muteRecurringSuggestion } from "@/actions/recurring";
import { formatCadence } from "@/lib/recurring";
import { formatCurrencyCents } from "@/lib/format";
import type { RecurringSuggestion } from "@/lib/recurring-suggest";

/**
 * "Suggested templates" panel on `/recurring` (subscription-detection §9.1).
 * Lists regular charges the deterministic engine noticed — merchant, cadence,
 * median amount, occurrence evidence — each offering **Create template**
 * (pre-fills the existing drawer, unsaved) and **Dismiss**. Plain surface, NO
 * `--color-ai` accent: this is heuristic math, not an AI affordance. Renders
 * nothing when empty — silence means nothing to act on.
 *
 * `onCreate` opens the drawer pre-filled; the accept-side mute is fired by the
 * parent on save-success (§9.3). Dismiss fires the mute directly here.
 */
export function SuggestionsPanel({
  suggestions,
  onCreate,
}: {
  suggestions: RecurringSuggestion[];
  onCreate: (suggestion: RecurringSuggestion) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  if (suggestions.length === 0) return null;

  function handleDismiss(suggestion: RecurringSuggestion) {
    startTransition(async () => {
      const res = await muteRecurringSuggestion({
        merchantKey: suggestion.merchantKey,
        outcome: "dismissed",
        cadence: suggestion.cadence,
      });
      if (!res.success) {
        toast.error(res.error ?? "Could not dismiss the suggestion.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <section className="flex flex-col rounded-xl border border-line bg-surface">
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <span className="flex size-6 items-center justify-center rounded-md bg-surface-2 text-ink-2">
          <Repeat className="size-3.5" />
        </span>
        <div>
          <h2 className="text-[13px] font-medium text-ink">Suggested templates</h2>
          <p className="mt-0.5 text-[11px] text-ink-3">
            Regular charges we noticed — you confirm each one
          </p>
        </div>
      </div>

      <ul className="flex flex-col divide-y divide-line px-4">
        {suggestions.map((s) => (
          <li
            key={`${s.type}-${s.merchantKey}`}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-[13px] font-medium text-ink">
                  {s.name}
                </span>
                <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-ink-3">
                  {formatCadence(s.cadence)}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[11px] text-ink-3">
                {formatCurrencyCents(s.amount)} · {evidence(s)}
              </p>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onCreate(s)}
                className="inline-flex items-center gap-1 rounded-md bg-success px-2.5 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90"
              >
                <Plus className="size-3.5" />
                Create template
              </button>
              <button
                type="button"
                onClick={() => handleDismiss(s)}
                disabled={isPending}
                aria-label={`Dismiss ${s.name} suggestion`}
                className="flex size-7 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-50"
              >
                <X className="size-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "4 charges · last Jun 15" — occurrence count + newest charge date (UTC). */
function evidence(s: RecurringSuggestion): string {
  const noun = s.occurrenceCount === 1 ? "charge" : "charges";
  const last = s.lastDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `${s.occurrenceCount} ${noun} · last ${last}`;
}
