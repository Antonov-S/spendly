"use client";

import { formatCurrency } from "@/lib/format";
import { SEMANTIC_COLORS, ARIA_SUMMARY_MAX } from "@/lib/system-constants";
import type { MonthBucket } from "@/types/reports";

const VBW = 600;
const VBH = 200;
const PAD_X = 12;
const PAD_TOP = 12;
const PAD_BOTTOM = 26;
const PLOT_H = VBH - PAD_TOP - PAD_BOTTOM;

/** Short month label, e.g. "Jun". UTC so it matches the bucket's calendar month. */
function monthShortLabel(month: number, year: number): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
}

function summarize(parts: string[], max: number): string {
  if (parts.length <= max) return parts.join(", ");
  return `${parts.slice(0, max).join(", ")}, and ${parts.length - max} more`;
}

/**
 * Grouped bars per month: income (green) + expenses (red). Every month from the
 * canonical range renders — zero months show as a flat (empty) column rather
 * than collapsing the axis. Real-DOM legend; `role="img"` summary on the svg.
 */
export function IncomeVsExpenses({
  monthly,
  periodLabel,
}: {
  monthly: MonthBucket[];
  periodLabel: string;
}) {
  const max = Math.max(
    1,
    ...monthly.map((m) => Math.max(m.income, m.expenses))
  );
  const groupW = (VBW - PAD_X * 2) / monthly.length;
  const barW = Math.min(28, groupW * 0.3);

  const label = `Income versus expenses, ${periodLabel.toLowerCase()}: ${summarize(
    monthly
      .filter((m) => m.income > 0 || m.expenses > 0)
      .map(
        (m) =>
          `${monthShortLabel(m.month, m.year)} income ${formatCurrency(
            m.income
          )}, expenses ${formatCurrency(m.expenses)}`
      ),
    ARIA_SUMMARY_MAX
  )}`;

  return (
    <div className="flex flex-1 flex-col gap-3">
      <svg
        viewBox={`0 0 ${VBW} ${VBH}`}
        role="img"
        aria-label={label}
        preserveAspectRatio="none"
        className="h-48 w-full"
      >
        {/* Baseline */}
        <line
          x1={PAD_X}
          y1={PAD_TOP + PLOT_H}
          x2={VBW - PAD_X}
          y2={PAD_TOP + PLOT_H}
          stroke="var(--color-line)"
          strokeWidth={1}
        />
        {monthly.map((m, i) => {
          const center = PAD_X + groupW * i + groupW / 2;
          const incomeH = (m.income / max) * PLOT_H;
          const expenseH = (m.expenses / max) * PLOT_H;
          return (
            <g key={`${m.year}-${m.month}`}>
              <rect
                x={center - barW - 1}
                y={PAD_TOP + PLOT_H - incomeH}
                width={barW}
                height={incomeH}
                rx={1.5}
                fill={SEMANTIC_COLORS.success}
              />
              <rect
                x={center + 1}
                y={PAD_TOP + PLOT_H - expenseH}
                width={barW}
                height={expenseH}
                rx={1.5}
                fill={SEMANTIC_COLORS.danger}
              />
              <text
                x={center}
                y={VBH - 9}
                textAnchor="middle"
                className="fill-ink-3"
                style={{ fontSize: monthly.length > 6 ? 11 : 13 }}
              >
                {monthShortLabel(m.month, m.year)}
              </text>
            </g>
          );
        })}
      </svg>

      <ul className="flex items-center justify-center gap-4 text-[11px] text-ink-2">
        <li className="flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: SEMANTIC_COLORS.success }}
          />
          Income
        </li>
        <li className="flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: SEMANTIC_COLORS.danger }}
          />
          Expenses
        </li>
      </ul>
    </div>
  );
}
