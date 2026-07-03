import "server-only";
import { prisma } from "@/lib/prisma";
import { getCategorySpend } from "@/lib/db/split-spend";
import { monthBounds, previousPeriod } from "@/lib/budget-period";
import { BUDGET_SUGGEST_LOOKBACK_MONTHS } from "@/lib/system-constants";
import type {
  BudgetSuggestCategory,
  BudgetSuggestInputs,
} from "@/lib/budget-suggest";

/** "July 2026" for the target period — matches the monthly-review UTC helper. */
function periodLabelFor(month: number, year: number): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Assemble the deterministic inputs for Smart Budget Suggestions for a target
 * (month, year): split-aware category spend for each of the
 * `BUDGET_SUGGEST_LOOKBACK_MONTHS` complete calendar months BEFORE the target
 * (oldest → newest), the target period's ACTIVE budget category ids (excluded —
 * archived slots stay suggestible, matching `getBudgetFormData` and revived by
 * `createBudget`'s upsert), and a name/icon/color lookup for the category ids
 * that appear.
 *
 * Budgets are not account-scoped, so spend aggregates across ALL accounts —
 * exactly what the resulting budget will measure via `getBudgets`. Per-month
 * figures are required (the rationale cites them, the spike/variability flags
 * need them), so this is one `getCategorySpend` call per lookback month — the
 * same shape `resolveRolloverCarry` already runs per walked month.
 *
 * The `null` (uncategorized) key from `getCategorySpend` is discarded: a budget
 * requires a category, so uncategorized spend can never be suggested.
 */
export async function getBudgetSuggestInputs(
  userId: string,
  month: number,
  year: number
): Promise<BudgetSuggestInputs> {
  // Walk back N complete months, then reverse to oldest → newest so the monthly
  // arrays read left-to-right in time (the order the rationale phrases).
  const periods: { month: number; year: number }[] = [];
  let cursor = previousPeriod(month, year);
  for (let i = 0; i < BUDGET_SUGGEST_LOOKBACK_MONTHS; i++) {
    periods.push(cursor);
    cursor = previousPeriod(cursor.month, cursor.year);
  }
  periods.reverse();

  const [monthlyRaw, activeBudgets] = await Promise.all([
    Promise.all(
      periods.map((p) => {
        const { monthStart, nextMonthStart } = monthBounds(p.month, p.year);
        return getCategorySpend(userId, {
          gte: monthStart,
          lt: nextMonthStart,
        });
      })
    ),
    prisma.budget.findMany({
      where: { userId, month, year, isArchived: false },
      select: { categoryId: true },
    }),
  ]);

  // Drop the uncategorized (null) key from each month.
  const monthlySpend: Map<string, number>[] = monthlyRaw.map((m) => {
    const clean = new Map<string, number>();
    for (const [id, spend] of m) {
      if (id !== null) clean.set(id, spend);
    }
    return clean;
  });

  // Resolve display attributes for every category id that appears (no N+1).
  const appearingIds = [
    ...new Set(monthlySpend.flatMap((m) => [...m.keys()])),
  ];
  const categoryRows = appearingIds.length
    ? await prisma.category.findMany({
        where: { id: { in: appearingIds }, OR: [{ userId: null }, { userId }] },
        select: { id: true, name: true, icon: true, color: true },
      })
    : [];
  const categories = new Map<string, BudgetSuggestCategory>(
    categoryRows.map((c) => [
      c.id,
      { name: c.name, icon: c.icon, color: c.color },
    ])
  );

  return {
    periodLabel: periodLabelFor(month, year),
    monthlySpend,
    budgetedCategoryIds: new Set(activeBudgets.map((b) => b.categoryId)),
    categories,
  };
}
