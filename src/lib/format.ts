/** Display formatting helpers for the dashboard UI. */

/** Format a whole-euro amount as "€8,560" (no decimals, EUR-only MVP). */
export function formatCurrency(amount: number): string {
  return `€${Math.round(Math.abs(amount)).toLocaleString("en-US")}`;
}

/**
 * Format an amount to the cent as "€55.00" (EUR-only MVP). Unlike
 * `formatCurrency`, this keeps decimals — used where cent precision matters (the
 * split editor's running total and "€0.00 left" indicator), so a €0.40 remainder
 * never reads as a balanced "€0". Absolute value; callers add any sign wording.
 */
export function formatCurrencyCents(amount: number): string {
  return `€${Math.abs(amount).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Format a signed amount for ledger display: "+€3,200" for positive,
 * "−€47" (true minus sign) for negative, "€0" for zero.
 */
export function formatSigned(amount: number): string {
  if (amount > 0) return `+${formatCurrency(amount)}`;
  if (amount < 0) return `−${formatCurrency(amount)}`;
  return formatCurrency(0);
}
