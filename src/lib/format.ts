/** Display formatting helpers for the dashboard UI. */

/** Format a whole-dollar amount as "$8,560" (no decimals, USD display). */
export function formatCurrency(amount: number): string {
  return `$${Math.round(Math.abs(amount)).toLocaleString("en-US")}`;
}

/**
 * Format a signed amount for ledger display: "+$3,200" for positive,
 * "−$47" (true minus sign) for negative, "$0" for zero.
 */
export function formatSigned(amount: number): string {
  if (amount > 0) return `+${formatCurrency(amount)}`;
  if (amount < 0) return `−${formatCurrency(amount)}`;
  return formatCurrency(0);
}
