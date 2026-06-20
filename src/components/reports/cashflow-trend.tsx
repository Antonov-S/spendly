"use client";

import { formatSigned } from "@/lib/format";
import { SEMANTIC_COLORS, ARIA_SUMMARY_MAX } from "@/lib/system-constants";
import type { MonthBucket } from "@/types/reports";

const VBW = 600;
const VBH = 200;
const PAD_X = 16;
const PAD_TOP = 14;
const PAD_BOTTOM = 26;
const PLOT_H = VBH - PAD_TOP - PAD_BOTTOM;

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
 * Monthly net cashflow as a single polyline over a zero baseline (surplus above,
 * deficit below). Per-point dots are green when ≥ 0, red when negative, so the
 * sign reads without relying on position alone. Reuses the `Sparkline`-style
 * point mapping, scaled up with month labels and a zero gridline.
 */
export function CashflowTrend({
  monthly,
  periodLabel,
}: {
  monthly: MonthBucket[];
  periodLabel: string;
}) {
  const nets = monthly.map((m) => m.income - m.expenses);
  const max = Math.max(0, ...nets);
  const min = Math.min(0, ...nets);
  const span = max - min || 1;

  const yFor = (value: number) =>
    PAD_TOP + ((max - value) / span) * PLOT_H;
  const xFor = (i: number) =>
    monthly.length === 1
      ? VBW / 2
      : PAD_X + (i / (monthly.length - 1)) * (VBW - PAD_X * 2);

  const zeroY = yFor(0);
  const points = nets.map((net, i) => [xFor(i), yFor(net)] as const);
  const line = points.map(([x, y]) => `${x},${y}`).join(" ");

  // Summarize the months that actually have movement (skip flat €0 months) so
  // the screen-reader label leads with the meaningful figures.
  const activeSummary = monthly
    .map((m, i) => ({ m, net: nets[i] }))
    .filter(({ net }) => net !== 0)
    .map(({ m, net }) => `${monthShortLabel(m.month, m.year)} ${formatSigned(net)}`);
  const label = `Net cashflow, ${periodLabel.toLowerCase()}: ${
    activeSummary.length > 0
      ? summarize(activeSummary, ARIA_SUMMARY_MAX)
      : "no movement yet"
  }`;

  return (
    <div className="flex flex-1 flex-col gap-3">
      <svg
        viewBox={`0 0 ${VBW} ${VBH}`}
        role="img"
        aria-label={label}
        preserveAspectRatio="none"
        className="h-48 w-full"
      >
        {/* Zero baseline */}
        <line
          x1={PAD_X}
          y1={zeroY}
          x2={VBW - PAD_X}
          y2={zeroY}
          stroke="var(--color-line)"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
        {monthly.length > 1 && (
          <polyline
            points={line}
            fill="none"
            stroke={SEMANTIC_COLORS.info}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {points.map(([x, y], i) => (
          <g key={`${monthly[i].year}-${monthly[i].month}`}>
            <circle
              cx={x}
              cy={y}
              r={3}
              fill={nets[i] >= 0 ? SEMANTIC_COLORS.success : SEMANTIC_COLORS.danger}
            />
            <text
              x={x}
              y={VBH - 9}
              textAnchor="middle"
              className="fill-ink-3"
              style={{ fontSize: monthly.length > 6 ? 11 : 13 }}
            >
              {monthShortLabel(monthly[i].month, monthly[i].year)}
            </text>
          </g>
        ))}
      </svg>

      <ul className="flex items-center justify-center gap-4 text-[11px] text-ink-2">
        <li className="flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: SEMANTIC_COLORS.success }}
          />
          Surplus
        </li>
        <li className="flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: SEMANTIC_COLORS.danger }}
          />
          Deficit
        </li>
      </ul>
    </div>
  );
}
