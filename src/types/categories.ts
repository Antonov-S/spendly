/**
 * A user-owned category row for the `/settings` manage list, with usage counts
 * that drive both the "used by …" line and the delete-impact dialog. Counts
 * scope to user-visible rows (non-deleted transactions, active budgets, active
 * templates) — see `getManageableCategories`. System categories are never
 * `ManageableCategory`s (they're immutable and excluded from the manage view).
 */
export interface ManageableCategory {
  id: string;
  name: string;
  /** Raw Lucide icon name (resolved at render time via `resolveIcon`). */
  icon: string;
  /** Hex accent color. */
  color: string;
  /** Non-deleted transactions referencing this category (→ Uncategorized on delete). */
  transactionCount: number;
  /** Active (non-archived) budgets referencing this category (→ deleted on delete). */
  budgetCount: number;
  /** Active (non-paused) recurring templates referencing this category (→ Uncategorized on delete). */
  recurringCount: number;
}

/** Editable shape used to pre-fill the category drawer in edit mode. */
export interface EditableCategory {
  id: string;
  name: string;
  /** Raw Lucide icon name. */
  icon: string;
  /** Hex accent color. */
  color: string;
}
