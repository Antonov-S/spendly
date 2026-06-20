"use client";

import { formatCurrency, formatSigned } from "@/lib/format";
import { ARIA_SUMMARY_MAX } from "@/lib/system-constants";
import type { BalancePoint } from "@/types/reports";

const VBW = 600;
const VBH = 200;
const PAD_X = 12;
const PAD_TOP = 12;
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
 * End-of-month balance per account as grouped bars (one bar per account per
 * month, in the account's color). Supports negative balances (liability
 * accounts / overdrafts) around a zero baseline — bars below zero are not
 * clamped. An account reachable only via an explicit `?account=` that is no
 * longer active (not in `activeAccountIds`) is suffixed "(archived)" in the
 * legend; the series renders identically otherwise (the user asked for it).
 */
export function AccountBalanceHistory({
  history,
  activeAccountIds,
  periodLabel,
}: {
  history: BalancePoint[];
  activeAccountIds: string[];
  periodLabel: string;
}) {
  const activeSet = new Set(activeAccountIds);
  // Every month carries the same account series; take it from the first month.
  const accounts = history[0]?.balances ?? [];
  const accountCount = accounts.length;

  const allValues = history.flatMap((p) => p.balances.map((b) => b.balance));
  const maxV = Math.max(0, ...allValues);
  const minV = Math.min(0, ...allValues);
  const span = maxV - minV || 1;

  const yFor = (value: number) => PAD_TOP + ((maxV - value) / span) * PLOT_H;
  const zeroY = yFor(0);

  const groupW = (VBW - PAD_X * 2) / history.length;
  const barW = Math.min(24, (groupW * 0.7) / Math.max(1, accountCount));

  const latest = history[history.length - 1]?.balances ?? [];
  const label = `Account balance, ${periodLabel.toLowerCase()}: ${summarize(
    latest.map((b) => `${b.name} ${formatSigned(b.balance)}`),
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
        {/* Zero baseline */}
        <line
          x1={PAD_X}
          y1={zeroY}
          x2={VBW - PAD_X}
          y2={zeroY}
          stroke="var(--color-line)"
          strokeWidth={1}
        />
        {history.map((point, i) => {
          const groupStart =
            PAD_X + groupW * i + (groupW - barW * accountCount) / 2;
          return (
            <g key={`${point.year}-${point.month}`}>
              {point.balances.map((b, j) => {
                const y = yFor(b.balance);
                const top = b.balance >= 0 ? y : zeroY;
                const height = Math.abs(y - zeroY);
                return (
                  <rect
                    key={b.accountId}
                    x={groupStart + barW * j}
                    y={top}
                    width={Math.max(0, barW - 1)}
                    height={height}
                    rx={1.5}
                    fill={b.color}
                  />
                );
              })}
              <text
                x={PAD_X + groupW * i + groupW / 2}
                y={VBH - 9}
                textAnchor="middle"
                className="fill-ink-3"
                style={{ fontSize: history.length > 6 ? 11 : 13 }}
              >
                {monthShortLabel(point.month, point.year)}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Legend carries each account's colour + its most recent balance. */}
      <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[11px] text-ink-2">
        {latest.map((account) => (
          <li key={account.accountId} className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: account.color }}
            />
            <span>
              {account.name}
              {!activeSet.has(account.accountId) && (
                <span className="text-ink-3"> (archived)</span>
              )}
            </span>
            <span className="tabular-nums text-ink-3">
              {formatCurrency(account.balance)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
