/**
 * Shared cent-rounding rule. The DB stores monetary values as `Decimal(12, 2)`,
 * so every amount that reaches the database — and every cross-field money check
 * in validation — must agree on the same 2-decimal rounding. Extracted here so
 * the transaction validation (`splits` sum-to-total) and the write actions share
 * one source of the cent rule rather than each keeping a private copy.
 */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
