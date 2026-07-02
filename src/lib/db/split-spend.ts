import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Per-category EXPENSE spend for a window, correctly attributing split
 * transactions to their child lines. Returns a `Map<categoryId | null, spend>`
 * of positive magnitudes.
 *
 * Two aggregations, merged additively (no double count):
 *   (a) EXPENSE rows with NO split lines (`splits: { none: {} }`), by their own category.
 *   (b) split LINES, scoped through the parent transaction.
 * A split parent is excluded from (a) *because it has children*; its amount
 * re-enters only via (b). This is what makes double-counting structurally
 * impossible regardless of the parent's own `categoryId`.
 *
 * The `null` key aggregates genuinely-uncategorized spend (null parent category
 * in (a); a SetNull'd split category in (b)) — Reports reads it as the
 * Uncategorized bucket. Budgets/rollover pass `categoryIds` (which excludes null
 * from both queries) and only ever look up real ids, so the null key is
 * irrelevant to them.
 *
 * The date filter is passed verbatim so each caller keeps its exact window
 * (`/budgets` half-open `lt`, the dashboard inclusive `lte`) — the helper is
 * window-agnostic. Not wrapped in `$transaction`: this is display aggregation,
 * not a mutation invariant (the same freshness contract as every read fetcher).
 */
export async function getCategorySpend(
  userId: string,
  dateFilter: Prisma.TransactionWhereInput["date"],
  opts?: {
    accountFilter?: Prisma.FinancialAccountWhereInput;
    categoryIds?: string[];
  }
): Promise<Map<string | null, number>> {
  const { accountFilter, categoryIds } = opts ?? {};

  // Predicate shared by both aggregations, expressed on the parent transaction.
  const parentScope: Prisma.TransactionWhereInput = {
    userId,
    deletedAt: null,
    type: "EXPENSE",
    date: dateFilter,
    ...(accountFilter ? { financialAccount: accountFilter } : {}),
  };
  const categoryScope = categoryIds ? { categoryId: { in: categoryIds } } : {};

  const [nonSplit, splitLines] = await Promise.all([
    // (a) EXPENSE rows with no split lines, grouped by their own category.
    prisma.transaction.groupBy({
      by: ["categoryId"],
      where: { ...parentScope, splits: { none: {} }, ...categoryScope },
      _sum: { amount: true },
    }),
    // (b) split lines, scoped through the parent transaction relation.
    prisma.transactionSplit.groupBy({
      by: ["categoryId"],
      where: { transaction: parentScope, ...categoryScope },
      _sum: { amount: true },
    }),
  ]);

  const map = new Map<string | null, number>();
  const add = (
    categoryId: string | null,
    sum: Prisma.Decimal | null
  ): void => {
    const value = Math.abs(Number(sum ?? 0));
    if (value === 0) return;
    map.set(categoryId, (map.get(categoryId) ?? 0) + value);
  };
  for (const g of nonSplit) add(g.categoryId, g._sum.amount);
  for (const g of splitLines) add(g.categoryId, g._sum.amount);
  return map;
}
