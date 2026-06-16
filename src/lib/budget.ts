import { BUDGET_THRESHOLDS, SEMANTIC_COLORS } from "@/lib/system-constants";
import type { BudgetListRow, BudgetSummary } from "@/types/dashboard";

export type BudgetState = "success" | "warning" | "danger";

/** Decimal-like value: a number, numeric string, or Prisma Decimal. */
type Numeric = number | string | { toString(): string };

/** A budget row shape from Prisma that `mapBudgetRow` can consume. */
export interface MappableBudget {
  id: string;
  amount: Numeric;
  category: {
    name: string;
    color: string;
    icon: string;
    transactions: { amount: Numeric }[];
  };
}

/** Fraction of the budget limit that has been spent (0 when no limit). */
export function budgetFraction(spent: number, limit: number): number {
  if (limit <= 0) return 0;
  return spent / limit;
}

/**
 * Map spend-to-limit ratio to a semantic state:
 * green < 60%, amber 60–<100%, red >= 100%.
 */
export function budgetState(spent: number, limit: number): BudgetState {
  const fraction = budgetFraction(spent, limit);
  if (fraction >= BUDGET_THRESHOLDS.danger) return "danger";
  if (fraction >= BUDGET_THRESHOLDS.warning) return "warning";
  return "success";
}

/** Progress bar fill width as a 0–100 percentage, clamped to the bar. */
export function budgetPercent(spent: number, limit: number): number {
  return Math.min(100, Math.max(0, budgetFraction(spent, limit) * 100));
}

/** Resolve a budget state to its semantic hex color. */
export function budgetColor(state: BudgetState): string {
  return SEMANTIC_COLORS[state];
}

/**
 * Map a budget (with its category's expense transactions) to a serializable
 * display row. `spent` is the absolute sum of the included expense amounts;
 * `icon` stays a raw name string (resolved client-side). Pure: the caller
 * supplies only EXPENSE, non-deleted, in-period transactions.
 */
export function mapBudgetRow(budget: MappableBudget): BudgetListRow {
  const spent = Math.abs(
    budget.category.transactions.reduce((s, tx) => s + Number(tx.amount), 0)
  );
  return {
    id: budget.id,
    category: {
      name: budget.category.name,
      color: budget.category.color,
      icon: budget.category.icon,
    },
    spent,
    limit: Number(budget.amount),
  };
}

/**
 * Summarize a period's budget rows. `daysLeft` is derived from `now` only when
 * `(month, year)` is the current calendar period (else `0`); `now` is injectable
 * for deterministic tests. `hasMixedCurrencies` flags a >1-currency period whose
 * summed total is therefore approximate.
 */
export function summarizeBudgets(
  rows: ReadonlyArray<{ spent: number; limit: number }>,
  currencies: string[],
  month: number,
  year: number,
  now: Date = new Date()
): BudgetSummary {
  const total = rows.reduce((s, r) => s + r.limit, 0);
  const totalSpent = rows.reduce((s, r) => s + r.spent, 0);
  const remaining = Math.max(0, total - totalSpent);

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const isCurrentPeriod =
    now.getUTCFullYear() === year && now.getUTCMonth() === month - 1;
  const daysLeft = isCurrentPeriod
    ? Math.max(0, daysInMonth - now.getUTCDate())
    : 0;

  return {
    remaining,
    total,
    daysLeft,
    categoryCount: rows.length,
    hasMixedCurrencies: new Set(currencies).size > 1,
  };
}
