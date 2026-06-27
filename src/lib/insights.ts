import { budgetProgressWithCarry } from "@/lib/budget";
import { BUDGET_AT_RISK_THRESHOLD } from "@/lib/system-constants";
import type { DashboardInsights, InsightItem } from "@/types/dashboard";

/**
 * Count budgets at or above the at-risk threshold (includes over-budget). Uses
 * the carry-aware effective limit via `budgetProgressWithCarry`, so a budget
 * whose room shrank from a rolled-in overspend can correctly trip the rail
 * (and an effective limit <= 0 counts as fully over). `carriedAmount` defaults
 * to 0, so non-rollover rows behave exactly as before.
 */
export function countAtRiskBudgets(
  rows: ReadonlyArray<{ spent: number; limit: number; carriedAmount?: number }>
): number {
  return rows.filter(
    (r) =>
      budgetProgressWithCarry(r.spent, r.limit, r.carriedAmount ?? 0).percent >=
      BUDGET_AT_RISK_THRESHOLD * 100
  ).length;
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
