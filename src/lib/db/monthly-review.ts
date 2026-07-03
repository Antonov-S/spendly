import "server-only";
import { prisma } from "@/lib/prisma";
import { getCategorySpend } from "@/lib/db/split-spend";
import { getBudgets } from "@/lib/db/budgets";
import { reportTxWhere } from "@/lib/db/reports";
import { currentPeriod, previousPeriod, monthBounds } from "@/lib/budget-period";
import type { ReviewInputs } from "@/lib/reports-review";

/** Signed-amount groupBy rows → `{ income, expenses }` (expenses as a positive magnitude). */
function totalsFromGrouped(
  grouped: { type: string; _sum: { amount: unknown } }[]
): { income: number; expenses: number } {
  let income = 0;
  let expenses = 0;
  for (const g of grouped) {
    const value = Number(g._sum.amount ?? 0);
    if (g.type === "INCOME") income += value;
    else if (g.type === "EXPENSE") expenses += Math.abs(value);
  }
  return { income, expenses };
}

/** "July 2026" for the given period — the month the narrative describes. */
function periodLabelFor(month: number, year: number): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Assemble the deterministic inputs for the Monthly Review Narrative for the
 * active account scope: two months of split-aware category spend + income/
 * expense totals + the current month's budgets. The window is fixed
 * month-over-month (this calendar month vs last, spec D3) — it does NOT read the
 * Reports period pills. Account scope follows `reportTxWhere` exactly (all
 * accounts → active only; explicit `?account=` honored even if archived). Spend
 * reuses `getCategorySpend` so a split transaction is attributed to its lines
 * exactly as everywhere else, and budget spend reuses `getBudgets` (rollover- &
 * split-aware) — so the narrative never drifts from the charts or /budgets bars.
 */
export async function getMonthlyReviewInputs(
  userId: string,
  accountId: string | undefined
): Promise<ReviewInputs> {
  const cur = currentPeriod();
  const prev = previousPeriod(cur.month, cur.year);
  const curBounds = monthBounds(cur.month, cur.year);
  const prevBounds = monthBounds(prev.month, prev.year);

  // Same account-scope rule as every Reports fetcher.
  const scope = reportTxWhere(userId, accountId);
  const accountFilter = scope.financialAccount;
  const curWindow = { gte: curBounds.monthStart, lt: curBounds.nextMonthStart };
  const prevWindow = { gte: prevBounds.monthStart, lt: prevBounds.nextMonthStart };

  const [currentSpend, priorSpend, curGrouped, prevGrouped, budgetData] =
    await Promise.all([
      getCategorySpend(userId, curWindow, { accountFilter }),
      getCategorySpend(userId, prevWindow, { accountFilter }),
      prisma.transaction.groupBy({
        by: ["type"],
        where: { ...scope, type: { in: ["INCOME", "EXPENSE"] }, date: curWindow },
        _sum: { amount: true },
      }),
      prisma.transaction.groupBy({
        by: ["type"],
        where: { ...scope, type: { in: ["INCOME", "EXPENSE"] }, date: prevWindow },
        _sum: { amount: true },
      }),
      getBudgets(userId, cur.month, cur.year),
    ]);

  // Resolve names for every category id that appears in either month (no N+1).
  const ids = [
    ...new Set(
      [...currentSpend.keys(), ...priorSpend.keys()].filter(
        (id): id is string => id !== null
      )
    ),
  ];
  const categories = ids.length
    ? await prisma.category.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true },
      })
    : [];
  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));

  return {
    currentSpend,
    priorSpend,
    currentTotals: totalsFromGrouped(curGrouped),
    priorTotals: totalsFromGrouped(prevGrouped),
    budgets: budgetData.rows,
    categoryNames,
    periodLabel: periodLabelFor(cur.month, cur.year),
  };
}
