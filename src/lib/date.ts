/**
 * Calendar-date helpers for the `<input type="date">` value format ("YYYY-MM-DD").
 *
 * Spendly stores dates as `@db.Date` (UTC midnight, no time/zone). Two distinct
 * conversions are needed and must not be confused:
 *  - Stored dates → input string: read **UTC** parts (`toDateInputValue`).
 *  - "Today" for a fresh form: read the user's **local** parts so their calendar
 *    day is used, not server UTC (`todayDateInputValue`).
 */

/** Zero-pad a month/day number to two digits. */
function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Format a stored `@db.Date` value as "YYYY-MM-DD" using its UTC parts. */
export function toDateInputValue(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(
    date.getUTCDate()
  )}`;
}

/** Today's **local** calendar date as "YYYY-MM-DD" (no UTC shift). */
export function todayDateInputValue(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate()
  )}`;
}

/** Parse a "YYYY-MM-DD" string to a calendar date at UTC midnight. */
export function dateInputToUtc(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
