import { BUDGET_THRESHOLDS, SEMANTIC_COLORS } from "@/lib/system-constants";

export type BudgetState = "success" | "warning" | "danger";

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
