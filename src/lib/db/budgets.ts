import "server-only";
import { prisma } from "@/lib/prisma";
import { mapBudgetRow, summarizeBudgets } from "@/lib/budget";
import { monthBounds } from "@/lib/budget-period";
import type {
  BudgetEditable,
  BudgetListRow,
  BudgetSummary,
} from "@/types/dashboard";
import type { CategoryOption } from "@/types/transactions";

/**
 * Active budgets for a period with live spend + summary. Spend is derived at
 * query time (never cached): the absolute sum of EXPENSE, non-deleted
 * transactions in each budget's category within the half-open month window.
 */
export async function getBudgets(
  userId: string,
  month: number,
  year: number
): Promise<{ rows: BudgetListRow[]; summary: BudgetSummary }> {
  const { monthStart, nextMonthStart } = monthBounds(month, year);

  const budgets = await prisma.budget.findMany({
    where: { userId, month, year, isArchived: false },
    include: {
      category: { select: { name: true, color: true, icon: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // One DB-side aggregation: signed sum of in-window EXPENSE spend per category,
  // scoped to the categories that actually have a budget this period.
  const spendByCategory = await prisma.transaction.groupBy({
    by: ["categoryId"],
    where: {
      userId,
      deletedAt: null,
      type: "EXPENSE",
      date: { gte: monthStart, lt: nextMonthStart },
      categoryId: { in: budgets.map((b) => b.categoryId) },
    },
    _sum: { amount: true },
  });

  const spentMap = new Map<string, number>(
    spendByCategory.map((g) => [g.categoryId!, Math.abs(Number(g._sum.amount ?? 0))])
  );

  const rows = budgets.map((b) => mapBudgetRow(b, spentMap.get(b.categoryId) ?? 0));
  const currencies = budgets.map((b) => b.currency);
  return { rows, summary: summarizeBudgets(rows, currencies, month, year) };
}

/** Editable pre-fill for a single active budget, scoped to the owner. */
export async function getBudgetForEdit(
  userId: string,
  id: string
): Promise<BudgetEditable | null> {
  const budget = await prisma.budget.findFirst({
    where: { id, userId, isArchived: false },
    select: { id: true, categoryId: true, amount: true, month: true, year: true },
  });
  if (!budget) return null;
  return {
    id: budget.id,
    categoryId: budget.categoryId,
    amount: Number(budget.amount),
    month: budget.month,
    year: budget.year,
  };
}

/**
 * Categories available to budget for the period: system + user categories that
 * have no **active** budget this month. Archived slots reappear here and are
 * revived (not duplicated) by `createBudget`.
 */
export async function getBudgetFormData(
  userId: string,
  month: number,
  year: number
): Promise<CategoryOption[]> {
  const [categories, activeBudgets] = await Promise.all([
    prisma.category.findMany({
      where: { OR: [{ userId: null }, { userId }] },
      select: { id: true, name: true, color: true, icon: true },
      orderBy: { name: "asc" },
    }),
    prisma.budget.findMany({
      where: { userId, month, year, isArchived: false },
      select: { categoryId: true },
    }),
  ]);

  const taken = new Set(activeBudgets.map((b) => b.categoryId));
  return categories.filter((c) => !taken.has(c.id));
}
