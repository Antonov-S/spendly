"use client";

import { Plus, Trash2 } from "lucide-react";
import { CategoryPickerField } from "@/components/categories/category-picker-field";
import { formatCurrencyCents } from "@/lib/format";
import { assignRemainder, splitRemaining, type SplitDraft } from "@/lib/split";
import { SPLIT_MAX_LINES, SPLIT_MIN_LINES } from "@/lib/system-constants";
import { cn } from "@/lib/utils";
import type { CategoryOption } from "@/types/transactions";

interface SplitEditorProps {
  categories: CategoryOption[];
  /** The transaction total the lines must sum to (positive magnitude). */
  total: number;
  splits: SplitDraft[];
  onChange: (next: SplitDraft[]) => void;
}

/**
 * The split editor: a list of category + amount + note lines with a live running
 * total and a one-click "Distribute remaining". All the sum/remainder logic lives
 * in `src/lib/split.ts` (unit-tested); this component only renders and wires it.
 */
export function SplitEditor({
  categories,
  total,
  splits,
  onChange,
}: SplitEditorProps) {
  const remaining = splitRemaining(total, splits);
  const balanced = remaining === 0;

  const update = (i: number, patch: Partial<SplitDraft>) =>
    onChange(splits.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const addLine = () => {
    if (splits.length >= SPLIT_MAX_LINES) return;
    onChange([...splits, { categoryId: "", amount: 0, note: "" }]);
  };
  const removeLine = (i: number) =>
    onChange(splits.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      {splits.map((line, i) => (
        <div key={i} className="rounded-lg border border-line bg-app p-2">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <CategoryPickerField
                categories={categories}
                value={line.categoryId}
                onChange={(id) => update(i, { categoryId: id })}
                emptyLabel="Pick a category…"
                allowCreate={false}
              />
            </div>
            <div className="flex w-24 shrink-0 items-center rounded-lg border border-line bg-app px-2">
              <span className="text-[12px] text-ink-3">€</span>
              <input
                inputMode="decimal"
                value={line.amount ? String(line.amount) : ""}
                onChange={(e) =>
                  update(i, { amount: Number(e.target.value) || 0 })
                }
                placeholder="0.00"
                aria-label="Split amount"
                className="w-full bg-transparent py-1.5 pl-1 text-[13px] text-ink outline-none placeholder:text-ink-3"
              />
            </div>
            <button
              type="button"
              onClick={() => removeLine(i)}
              disabled={splits.length <= SPLIT_MIN_LINES}
              aria-label="Remove split line"
              className="shrink-0 rounded-md p-1.5 text-ink-3 transition-colors hover:bg-surface-2 hover:text-danger disabled:cursor-not-allowed disabled:opacity-30"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
          <input
            type="text"
            value={line.note}
            onChange={(e) => update(i, { note: e.target.value })}
            placeholder="Note (optional)"
            aria-label="Split note"
            className="mt-1.5 w-full rounded-md border border-line bg-app px-2 py-1 text-[12px] text-ink outline-none placeholder:text-ink-3"
          />
        </div>
      ))}

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={addLine}
          disabled={splits.length >= SPLIT_MAX_LINES}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] font-medium text-info transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="size-3.5" />
          Add split
        </button>
        <span className="text-[10px] text-ink-3">Max {SPLIT_MAX_LINES} lines</span>
      </div>

      {/* Running total + remainder indicator + one-click distribute. */}
      <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2">
        <span className="text-[12px] text-ink-2">
          {formatCurrencyCents(total)} total ·{" "}
          <span className={cn(balanced ? "text-success" : "text-warning")}>
            {balanced
              ? "balanced ✓"
              : remaining > 0
                ? `${formatCurrencyCents(remaining)} left`
                : `${formatCurrencyCents(remaining)} over`}
          </span>
        </span>
        {!balanced && (
          <button
            type="button"
            onClick={() => onChange(assignRemainder(total, splits))}
            className="shrink-0 rounded-md border border-line px-2 py-1 text-[11px] font-medium text-ink-2 transition-colors hover:bg-app"
          >
            Distribute remaining
          </button>
        )}
      </div>
    </div>
  );
}
