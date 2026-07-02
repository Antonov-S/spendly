import "server-only";
import { prisma } from "@/lib/prisma";
import { getCategorySpend } from "@/lib/db/split-spend";
import { mapBudgetRow, roundMoney, summarizeBudgets } from "@/lib/budget";
import { monthBounds, previousPeriod } from "@/lib/budget-period";
import { rolloverCarryIn, type RolloverPoint } from "@/lib/rollover";
import { ROLLOVER_MAX_LOOKBACK_MONTHS } from "@/lib/system-constants";
import type {
  BudgetEditable,
  BudgetListRow,
  BudgetSummary,
} from "@/types/dashboard";
import type { CategoryOption } from "@/types/transactions";

/**
 * Carry-in per category for `(month, year)`, derived from the consecutive
 * rollover-enabled run immediately preceding it. Only the categories passed in
 * `rolloverCategoryIds` (the target period's rollover-on budgets) are resolved;
 * every other category is absent from the map (carry = 0).
 *
 * Walks back month-by-month from the previous period (bounded by
 * `ROLLOVER_MAX_LOOKBACK_MONTHS`), trimming a category's run at the first gap or
 * rollover-off month, then folds each run chronologically via `rolloverCarryIn`.
 *
 * CONTRACT: every value in the returned map is already rounded to 2 decimals —
 * callers consume it as-is and never re-round. Side-effect-free in
 * `(userId, month, year, rolloverCategoryIds)` (a `cache()` wrapper would be a
 * drop-in if a second caller ever needed per-request dedupe).
 */
export async function resolveRolloverCarry(
  userId: string,
  month: number,
  year: number,
  rolloverCategoryIds: string[]
): Promise<Map<string, number>> {
  // Non-rollover users (and rollover-off periods) pay zero extra queries.
  if (rolloverCategoryIds.length === 0) return new Map();

  // Per-category run, collected newest → oldest as we walk back.
  const runs = new Map<string, RolloverPoint[]>(
    rolloverCategoryIds.map((id) => [id, []])
  );
  // Categories still inside an unbroken run (drop them at the first break).
  let active = new Set(rolloverCategoryIds);

  let cursor = previousPeriod(month, year);
  for (let step = 0; step < ROLLOVER_MAX_LOOKBACK_MONTHS && active.size > 0; step++) {
    const ids = [...active];
    const { monthStart, nextMonthStart } = monthBounds(cursor.month, cursor.year);

    const [budgets, spentByCategory] = await Promise.all([
      prisma.budget.findMany({
        where: {
          userId,
          month: cursor.month,
          year: cursor.year,
          rollover: true,
          isArchived: false,
          categoryId: { in: ids },
        },
        select: { categoryId: true, amount: true },
      }),
      // Split-aware: a prior month's spend that was split must still count
      // against that month's budget when carried forward.
      getCategorySpend(
        userId,
        { gte: monthStart, lt: nextMonthStart },
        { categoryIds: ids }
      ),
    ]);

    const baseByCategory = new Map(
      budgets.map((b) => [b.categoryId, Number(b.amount)])
    );

    // A category survives this step only if it had a rollover-on budget here;
    // otherwise its run broke and it leaves the active set.
    const next = new Set<string>();
    for (const id of ids) {
      const baseLimit = baseByCategory.get(id);
      if (baseLimit === undefined) continue; // run broke — stop walking this one
      runs.get(id)!.push({ baseLimit, spent: spentByCategory.get(id) ?? 0 });
      next.add(id);
    }
    active = next;

    cursor = previousPeriod(cursor.month, cursor.year);
  }

  const carry = new Map<string, number>();
  for (const id of rolloverCategoryIds) {
    const run = runs.get(id)!;
    if (run.length === 0) continue;
    // Collected newest → oldest; fold chronologically (oldest → newest).
    const chronological = [...run].reverse();
    carry.set(id, roundMoney(rolloverCarryIn(chronological)));
  }
  return carry;
}

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

  // Split-aware per-category EXPENSE spend for the window, scoped to the
  // categories that actually have a budget this period (a split transaction is
  // attributed to its lines, not its parent — see getCategorySpend).
  const spentMap = await getCategorySpend(
    userId,
    { gte: monthStart, lt: nextMonthStart },
    { categoryIds: budgets.map((b) => b.categoryId) }
  );

  const rolloverIds = budgets.filter((b) => b.rollover).map((b) => b.categoryId);
  const carryMap = await resolveRolloverCarry(userId, month, year, rolloverIds);

  const rows = budgets.map((b) =>
    mapBudgetRow(
      b,
      spentMap.get(b.categoryId) ?? 0,
      b.rollover,
      b.rollover ? (carryMap.get(b.categoryId) ?? 0) : 0
    )
  );
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
    select: {
      id: true,
      categoryId: true,
      amount: true,
      month: true,
      year: true,
      rollover: true,
    },
  });
  if (!budget) return null;
  return {
    id: budget.id,
    categoryId: budget.categoryId,
    amount: Number(budget.amount),
    month: budget.month,
    year: budget.year,
    rollover: budget.rollover,
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
