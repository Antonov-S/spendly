/**
 * Calendar-period helpers for the `/budgets` page. A "period" is a
 * `{ month, year }` pair (month is 1–12). Pure and deterministic — `now` is
 * injectable so the current-period defaults are testable.
 */

/** A budgeting period: 1-based month + full year. */
export interface BudgetPeriod {
  month: number;
  year: number;
}

/** The current calendar period from `now` (defaults to the real clock). */
export function currentPeriod(now: Date = new Date()): BudgetPeriod {
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

/**
 * Parse a `?month=` param to a valid 1–12 month, falling back to the current
 * month on anything out of range or unparseable.
 */
export function parseMonth(value: string | undefined, now: Date = new Date()): number {
  const n = Number(value);
  if (Number.isInteger(n) && n >= 1 && n <= 12) return n;
  return currentPeriod(now).month;
}

/**
 * Parse a `?year=` param to a valid year (matching the Zod schema bounds),
 * falling back to the current year on anything invalid.
 */
export function parseYear(value: string | undefined, now: Date = new Date()): number {
  const n = Number(value);
  if (Number.isInteger(n) && n >= 2020 && n <= 2100) return n;
  return currentPeriod(now).year;
}

/**
 * Half-open UTC bounds for a period: `[monthStart, nextMonthStart)`. Used to
 * filter `@db.Date` transactions into the month. December wraps to January of
 * the following year.
 */
export function monthBounds(
  month: number,
  year: number
): { monthStart: Date; nextMonthStart: Date } {
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const nextMonthStart = new Date(Date.UTC(year, month, 1));
  return { monthStart, nextMonthStart };
}
