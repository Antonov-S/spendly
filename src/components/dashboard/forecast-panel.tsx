import { formatCurrency, formatSigned } from "@/lib/format";
import { SEMANTIC_COLORS } from "@/lib/system-constants";
import type { ForecastResult } from "@/lib/forecast";

/**
 * Dashboard cash-flow forecast card (cash-flow-forecast spec §8). Server
 * component (no interactivity) — renders the projected end-of-day balance over
 * the horizon as a small dependency-free SVG plus a load-bearing facts row.
 *
 * Hidden entirely when there is nothing to project (`eventCount === 0`): a flat
 * line is decoration ("never UI without backing function"). The dashed stroke
 * is the one visual cue that this is a projection, not history (the hero
 * sparkline beside it is solid). Color stays strictly semantic: neutral grey
 * for the projected path, `danger` only for the portion below zero — the one
 * state a guess can honestly signal.
 */

const VBW = 520;
const VBH = 132;
const PAD_X = 10;
const PAD_TOP = 12;
const PAD_BOTTOM = 12;
const PLOT_TOP = PAD_TOP;
const PLOT_BOTTOM = VBH - PAD_BOTTOM;
const PLOT_H = PLOT_BOTTOM - PLOT_TOP;

/** Short "Jun 28" UTC date for annotations. */
function shortDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Signed-aware money: "−€240" for negatives, "€240" otherwise (no leading +). */
function money(value: number): string {
  return value < 0 ? formatSigned(value) : formatCurrency(value);
}

export function ForecastPanel({ forecast }: { forecast: ForecastResult }) {
  const { points, low, end, eventCount } = forecast;

  // Nothing scheduled inside the window → no card (spec §8, D7).
  if (eventCount === 0) return null;

  const horizonDays = points.length - 1;
  const startBalance = points[0].balance;
  const values = points.map((p) => p.balance);
  const hasNegative = values.some((v) => v < 0);

  // Vertical range. Include 0 when any point dips below it so the zero baseline
  // is on-chart; pad so the line never glues to an edge.
  let hi = Math.max(...values);
  let lo = Math.min(...values);
  if (hasNegative) {
    hi = Math.max(hi, 0);
    lo = Math.min(lo, 0);
  }
  const span = hi - lo || 1;
  const padV = span * 0.08;
  hi += padV;
  lo -= padV;

  const yFor = (v: number) =>
    PLOT_TOP + ((hi - v) / (hi - lo)) * PLOT_H;
  const xFor = (i: number) =>
    PAD_X + (i / (points.length - 1)) * (VBW - PAD_X * 2);

  const linePoints = points.map((p, i) => `${xFor(i)},${yFor(p.balance)}`);
  const line = linePoints.join(" ");

  const zeroY = yFor(0);
  const baseY = hasNegative ? zeroY : PLOT_BOTTOM;
  const areaPath =
    `M ${xFor(0)},${baseY} ` +
    linePoints.map((pt) => `L ${pt}`).join(" ") +
    ` L ${xFor(points.length - 1)},${baseY} Z`;

  // Screen-reader summary — the same figures the facts row shows in the DOM.
  const label = `Projected balance over the next ${horizonDays} days: from ${money(
    startBalance
  )} to ${money(end.balance)}, lowest ${money(low.balance)} around ${shortDate(
    low.date
  )}`;

  const delta = end.balance - startBalance;

  return (
    <section className="flex flex-col rounded-xl border border-line bg-surface">
      {/* Header */}
      <div className="flex flex-col gap-0.5 px-4 py-3.5">
        <h2 className="text-[13px] font-medium text-ink">Projected balance</h2>
        <p className="text-[11px] text-ink-3">
          Next {horizonDays} days · assumes scheduled items are confirmed
        </p>
      </div>

      {/* Chart */}
      <div className="border-t border-line px-4 pt-4">
        <svg
          viewBox={`0 0 ${VBW} ${VBH}`}
          role="img"
          aria-label={label}
          preserveAspectRatio="none"
          className="h-32 w-full"
        >
          {hasNegative && (
            <defs>
              <clipPath id="forecast-above-zero">
                <rect x={0} y={0} width={VBW} height={zeroY} />
              </clipPath>
              <clipPath id="forecast-below-zero">
                <rect x={0} y={zeroY} width={VBW} height={VBH - zeroY} />
              </clipPath>
            </defs>
          )}

          {/* Neutral path (whole chart, or clipped to the above-zero band). */}
          <g
            clipPath={hasNegative ? "url(#forecast-above-zero)" : undefined}
            aria-hidden="true"
          >
            <path d={areaPath} fill={SEMANTIC_COLORS.neutral} fillOpacity={0.08} />
            <polyline
              points={line}
              fill="none"
              stroke={SEMANTIC_COLORS.neutral}
              strokeWidth={2}
              strokeDasharray="5 4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>

          {/* Danger path — only the portion below the zero baseline. */}
          {hasNegative && (
            <g clipPath="url(#forecast-below-zero)" aria-hidden="true">
              <path
                d={areaPath}
                fill={SEMANTIC_COLORS.danger}
                fillOpacity={0.1}
              />
              <polyline
                points={line}
                fill="none"
                stroke={SEMANTIC_COLORS.danger}
                strokeWidth={2}
                strokeDasharray="5 4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          )}

          {/* Zero baseline (only when the path crosses it). */}
          {hasNegative && (
            <line
              x1={PAD_X}
              y1={zeroY}
              x2={VBW - PAD_X}
              y2={zeroY}
              stroke="var(--color-line)"
              strokeWidth={1}
              aria-hidden="true"
            />
          )}

          {/* "Today" dot on points[0]. */}
          <circle
            cx={xFor(0)}
            cy={yFor(startBalance)}
            r={3}
            fill={SEMANTIC_COLORS.neutral}
            aria-hidden="true"
          />
        </svg>
      </div>

      {/* Facts row — the load-bearing content; the chart illustrates it. */}
      <div className="flex items-center justify-between gap-2 px-4 py-3.5 text-[12px]">
        <span className="text-ink-2">
          Lowest:{" "}
          <span
            className={`tabular-nums ${low.balance < 0 ? "text-danger" : "text-ink"}`}
          >
            {money(low.balance)}
          </span>
          <span className="text-ink-3"> · around {shortDate(low.date)}</span>
        </span>
        <span className="text-ink-2">
          In {horizonDays} days:{" "}
          <span
            className={`tabular-nums ${end.balance < 0 ? "text-danger" : "text-ink"}`}
          >
            {money(end.balance)}
          </span>
          <span className="text-ink-3"> ({formatSigned(delta)})</span>
        </span>
      </div>
    </section>
  );
}
