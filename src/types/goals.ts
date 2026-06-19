/**
 * Serializable goal shapes for the client `/goals` view. Prisma `Decimal`
 * columns are converted to `number` in the DB fetchers (every figure is
 * `Decimal(12,2)`, far inside `Number.MAX_SAFE_INTEGER`), so nothing here
 * carries a non-serializable value across the server→client boundary.
 */

/** A single contribution (or withdrawal) row in the contribution drawer. */
export interface ContributionRow {
  id: string;
  /** Signed: negative = withdrawal. */
  amount: number;
  /** "YYYY-MM-DD" calendar date (UTC parts of the stored `@db.Date`). */
  date: string;
  note: string | null;
}

/** A goal card on the `/goals` page (full dataset, includes its contributions). */
export interface GoalCard {
  id: string;
  name: string;
  /** Hex accent color cycled by index. */
  color: string;
  saved: number;
  target: number;
  /** "YYYY-MM-DD" or null when no target date is set. */
  targetDate: string | null;
  isCompleted: boolean;
  /** Past target date, not complete, still short of target. */
  overdue: boolean;
  contributions: ContributionRow[];
}

/** Editable shape for pre-filling the goal form drawer on edit. */
export interface EditableGoal {
  id: string;
  name: string;
  targetAmount: number;
  /** "YYYY-MM-DD" or null. */
  targetDate: string | null;
}
