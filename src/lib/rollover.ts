/**
 * Budget rollover math — pure, no Prisma, no I/O. The DB layer assembles the
 * inputs (the consecutive rollover-enabled run preceding a target month); the
 * carry arithmetic lives here so it is fully unit-testable.
 *
 * Carry accumulates across a maximal run of consecutive calendar months that
 * each have a rollover-enabled budget for the category. The first month of a
 * run has `carryIn = 0`; a gap month or a `rollover = false` month ends the run.
 */

/** One month in a category's consecutive rollover run. */
export interface RolloverPoint {
  /** The base ceiling (`Budget.amount`) for that month. */
  baseLimit: number;
  /** Absolute in-month EXPENSE spend for the category. */
  spent: number;
}

/**
 * Carry-in for a target month, given the consecutive rollover-enabled run
 * IMMEDIATELY preceding it, sorted chronologically (oldest → newest) and
 * already trimmed by the caller at the first gap / rollover-off month. Returns
 * 0 for an empty run.
 *
 * Folds the effective remainder forward: each month rolls `base + carry − spent`.
 * The running sum is left as a plain JS number — round the emitted carry once at
 * the boundary (caller's responsibility), never mid-fold.
 */
export function rolloverCarryIn(priorRun: ReadonlyArray<RolloverPoint>): number {
  let carry = 0;
  for (const p of priorRun) carry = p.baseLimit + carry - p.spent;
  return carry;
}

/** Effective ceiling = base limit + carried remainder (signed). */
export function effectiveLimit(baseLimit: number, carriedAmount: number): number {
  return baseLimit + carriedAmount;
}
