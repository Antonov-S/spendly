import { budgetProgressWithCarry } from "@/lib/budget";
import { BUDGET_AT_RISK_THRESHOLD } from "@/lib/system-constants";
import type { DashboardInsights, InsightItem } from "@/types/dashboard";

/**
 * Carry-aware risk classification for one budget row. Single source of the
 * at-risk threshold rule — `countAtRiskBudgets` (the strip's aggregate) and the
 * notification builder (§8, per-row severity) both route through this, so the
 * threshold can never drift between the two surfaces. Three-way: `"over"` at
 * carry-aware `percent >= 100`, `"at-risk"` at `>= BUDGET_AT_RISK_THRESHOLD`,
 * else `null`. `budgetProgressWithCarry` owns the `effectiveLimit <= 0 → 100%`
 * edge and NaN-safe percent, so malformed/zero-limit rows classify as `null`.
 * `carriedAmount` defaults to 0 → non-rollover rows behave exactly as before.
 */
export function budgetRiskLevel(row: {
  spent: number;
  limit: number;
  carriedAmount?: number;
}): "over" | "at-risk" | null {
  const { percent } = budgetProgressWithCarry(
    row.spent,
    row.limit,
    row.carriedAmount ?? 0
  );
  if (percent >= 100) return "over";
  if (percent >= BUDGET_AT_RISK_THRESHOLD * 100) return "at-risk";
  return null;
}

/**
 * Count budgets at or above the at-risk threshold (includes over-budget).
 * Delegates to `budgetRiskLevel` so the rule stays defined once; `!== null`
 * preserves the old `percent >= 80` semantics exactly (an `"over"` row still
 * counts in the aggregate).
 */
export function countAtRiskBudgets(
  rows: ReadonlyArray<{ spent: number; limit: number; carriedAmount?: number }>
): number {
  return rows.filter((r) => budgetRiskLevel(r) !== null).length;
}

/**
 * Build the ordered, non-empty pill list from the three counts. A count of 0
 * produces no pill — so the strip renders nothing when everything is calm
 * (the component returns null on an empty array). Order is fixed:
 * budgets → drafts → goals.
 */
export function buildInsightItems(insights: DashboardInsights): InsightItem[] {
  const items: InsightItem[] = [];

  if (insights.atRiskBudgetCount > 0) {
    items.push({
      key: "budgets",
      label: `${insights.atRiskBudgetCount} ${plural(insights.atRiskBudgetCount, "budget")} at risk`,
      href: "/budgets",
      tone: "warning",
    });
  }
  if (insights.pendingDraftCount > 0) {
    items.push({
      key: "drafts",
      label: `${insights.pendingDraftCount} recurring ${plural(insights.pendingDraftCount, "draft")} pending`,
      href: "/recurring",
      tone: "info",
    });
  }
  if (insights.overdueGoalCount > 0) {
    items.push({
      key: "goals",
      label: `${insights.overdueGoalCount} overdue ${plural(insights.overdueGoalCount, "goal")}`,
      href: "/goals",
      tone: "warning",
    });
  }

  return items;
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}
