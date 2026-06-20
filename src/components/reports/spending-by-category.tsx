"use client";

import { formatCurrency } from "@/lib/format";
import { ARIA_SUMMARY_MAX } from "@/lib/system-constants";
import type { CategorySlice } from "@/types/reports";

const R = 52; // donut radius (viewBox units)
const STROKE = 18; // ring thickness
const C = 2 * Math.PI * R;

/** "A, B, C, and N more" — caps the screen-reader summary length. */
function summarize(parts: string[], max: number): string {
  if (parts.length <= max) return parts.join(", ");
  return `${parts.slice(0, max).join(", ")}, and ${parts.length - max} more`;
}

/**
 * Dependency-free donut + real-DOM legend. Each slice is a stroked arc using its
 * own category color; the legend (real text, not SVG) lists name, amount, and
 * share. The root `<svg>` is `role="img"` with a data-summarizing label, so the
 * decorative arcs are not separately announced.
 */
export function SpendingByCategory({
  slices,
  periodLabel,
}: {
  slices: CategorySlice[];
  periodLabel: string;
}) {
  const total = slices.reduce((s, c) => s + c.total, 0);

  const label = `Spending by category, ${periodLabel.toLowerCase()}: ${summarize(
    slices.map((s) => `${s.name} ${formatCurrency(s.total)}`),
    ARIA_SUMMARY_MAX
  )}`;

  let offset = 0;

  return (
    <div className="flex flex-1 flex-col items-center gap-4 sm:flex-row sm:items-center">
      <svg
        viewBox="0 0 140 140"
        role="img"
        aria-label={label}
        className="h-36 w-36 shrink-0 -rotate-90"
      >
        {slices.map((slice) => {
          const fraction = total > 0 ? slice.total / total : 0;
          const dash = fraction * C;
          const seg = (
            <circle
              key={slice.categoryId ?? "uncategorized"}
              cx={70}
              cy={70}
              r={R}
              fill="none"
              stroke={slice.color}
              strokeWidth={STROKE}
              strokeDasharray={`${dash} ${C - dash}`}
              strokeDashoffset={-offset}
            />
          );
          offset += dash;
          return seg;
        })}
      </svg>

      <ul className="flex w-full flex-col gap-1.5">
        {slices.map((slice) => {
          const pct = total > 0 ? Math.round((slice.total / total) * 100) : 0;
          return (
            <li
              key={slice.categoryId ?? "uncategorized"}
              className="flex items-center gap-2 text-[12px]"
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: slice.color }}
              />
              <span className="min-w-0 flex-1 truncate text-ink-2">
                {slice.name}
              </span>
              <span className="shrink-0 tabular-nums text-ink">
                {formatCurrency(slice.total)}
              </span>
              <span className="w-9 shrink-0 text-right tabular-nums text-ink-3">
                {pct}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
