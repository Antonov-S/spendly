import { BUDGET_THRESHOLDS, SEMANTIC_COLORS } from "@/lib/system-constants";
import { formatCurrency } from "@/lib/format";
import { effectiveLimit } from "@/lib/rollover";
import type { BudgetListRow, BudgetSummary } from "@/types/dashboard";

export type BudgetState = "success" | "warning" | "danger";

/** Round a money magnitude to 2 decimals (matches the `Decimal(12,2)` column). */
export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

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

/** Carry-aware progress: state + percent computed against the effective limit. */
export interface BudgetProgress {
  effectiveLimit: number;
  state: BudgetState;
  /** 0–100, clamped. */
  percent: number;
}

/**
 * Single source of carry-aware progress. The effective limit = base + carry.
 * A carried overspend can drive the effective limit to `<= 0`; that is a
 * definitionally-over budget, so it renders danger / 100% (not the misleading
 * 0% / green that `budgetFraction(limit <= 0)` would otherwise give). Every
 * rollover-aware surface (the `/budgets` row, the dashboard panel, the at-risk
 * count) routes through this so the edge can never drift between them.
 */
export function budgetProgressWithCarry(
  spent: number,
  baseLimit: number,
  carriedAmount: number
): BudgetProgress {
  const eff = effectiveLimit(baseLimit, carriedAmount);
  if (eff <= 0) return { effectiveLimit: eff, state: "danger", percent: 100 };
  return {
    effectiveLimit: eff,
    state: budgetState(spent, eff),
    percent: budgetPercent(spent, eff),
  };
}

/**
 * Direction-worded carry copy for display — presentation only, no arithmetic.
 * Takes the already-rounded numeric carry and returns the secondary explainer
 * line; positive keeps an explicit `+` (added room), negative reads as last
 * month's overspend. Returns `""` for zero (the row renders no carry line).
 */
export function formatCarry(carriedAmount: number): string {
  if (carriedAmount > 0) return `+${formatCurrency(carriedAmount)} rolled over`;
  if (carriedAmount < 0) return `${formatCurrency(carriedAmount)} overspent last month`;
  return "";
}

/**
 * Map a budget + its precomputed period spend to a serializable display row.
 * `spent` is the absolute in-period EXPENSE total for the budget's category,
 * aggregated by the caller (DB-side `groupBy`). `limit` stays the **base**
 * ceiling — the effective limit (base + `carriedAmount`) is composed by
 * consumers. `icon` stays a raw name string (resolved client-side).
 */
export function mapBudgetRow(
  budget: MappableBudget,
  spent: number,
  rollover: boolean,
  carriedAmount: number
): BudgetListRow {
  return {
    id: budget.id,
    category: {
      name: budget.category.name,
      color: budget.category.color,
      icon: budget.category.icon,
    },
    spent,
    limit: Number(budget.amount),
    rollover,
    carriedAmount,
  };
}

/**
 * Summarize a period's budget rows. `total` and `remaining` are computed from
 * each row's **effective** limit (`limit + carriedAmount`) so the remaining
 * block reflects rolled-over room. `daysLeft` is derived from `now` only when
 * `(month, year)` is the current calendar period (else `0`); `now` is injectable
 * for deterministic tests. `hasMixedCurrencies` flags a >1-currency period whose
 * summed total is therefore approximate.
 */
export function summarizeBudgets(
  rows: ReadonlyArray<{ spent: number; limit: number; carriedAmount?: number }>,
  currencies: string[],
  month: number,
  year: number,
  now: Date = new Date()
): BudgetSummary {
  const total = rows.reduce((s, r) => s + r.limit + (r.carriedAmount ?? 0), 0);
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
