/**
 * Period helpers for the `/reports` page. A "period" is one of three fixed
 * month-spans (this month / last 3 / last 12). Pure and deterministic — `now`
 * is injectable so bounds and the current-window default are testable. Mirrors
 * the UTC half-open `[from, to)` math in `budget-period.ts`.
 */
import { REPORT_PERIOD_OPTIONS } from "@/lib/constants";
import { REPORTS_FREE_MAX_MONTHS } from "@/lib/system-constants";

/** Count of calendar months a window spans, including the current one. */
export type PeriodMonths = 1 | 3 | 12;

/** A resolved report window: its month count plus its URL/display metadata. */
export interface ReportPeriod {
  months: PeriodMonths;
  /** URL param value, e.g. "3m". */
  param: string;
  /** Display label, e.g. "Last 3 months". */
  label: string;
}

/** The default window ("This month") when `?period=` is missing or unknown. */
const DEFAULT_OPTION = REPORT_PERIOD_OPTIONS[0];

function toPeriod(option: (typeof REPORT_PERIOD_OPTIONS)[number]): ReportPeriod {
  return {
    months: option.months as PeriodMonths,
    param: option.param,
    label: option.label,
  };
}

/** Parse `?period=` → a ReportPeriod. Defaults to the 1-month window. */
export function parsePeriod(value: string | undefined): ReportPeriod {
  const option = REPORT_PERIOD_OPTIONS.find((o) => o.param === value);
  return toPeriod(option ?? DEFAULT_OPTION);
}

/**
 * Half-open UTC bounds for the window: `[from, to)`.
 *  - `from` = start of the month `(months - 1)` before the current month.
 *  - `to`   = start of the *next* month (so the current month is fully included).
 * `Date.UTC` handles the year wrap (e.g. months crossing a January boundary).
 */
export function periodBounds(
  months: PeriodMonths,
  now: Date = new Date()
): { from: Date; to: Date } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const from = new Date(Date.UTC(y, m - (months - 1), 1));
  const to = new Date(Date.UTC(y, m + 1, 1));
  return { from, to };
}

/**
 * Ordered `{ month, year }` buckets spanning the window, oldest→newest. Length
 * === `months`. Drives the per-month charts' x-axis so zero-activity months
 * still render a labelled empty column rather than collapsing the window.
 */
export function monthsInRange(
  months: PeriodMonths,
  now: Date = new Date()
): { month: number; year: number }[] {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const buckets: { month: number; year: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - i, 1));
    buckets.push({ month: d.getUTCMonth() + 1, year: d.getUTCFullYear() });
  }
  return buckets;
}

/** Free tier is capped at REPORTS_FREE_MAX_MONTHS (3); Pro unlocks 12. */
export function isPeriodAllowed(months: PeriodMonths, isPro: boolean): boolean {
  return months <= REPORTS_FREE_MAX_MONTHS || isPro;
}

/**
 * Resolve the *effective* window to query from the *requested* one and the
 * user's plan — the business-critical Free 12m→3m clamp as a pure unit. Returns
 * the window to fetch plus a `clamped` flag that drives the upgrade banner and
 * the "highlight the effective pill" rule, so the page never re-derives the gate.
 */
export function resolveEffectivePeriod(
  requested: ReportPeriod,
  isPro: boolean
): { effective: ReportPeriod; clamped: boolean } {
  if (isPeriodAllowed(requested.months, isPro)) {
    return { effective: requested, clamped: false };
  }
  return { effective: parsePeriod("3m"), clamped: true };
}
