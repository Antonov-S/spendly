import "server-only";
import { prisma } from "@/lib/prisma";
import { getCategorySpend } from "@/lib/db/split-spend";
import { UNCATEGORIZED } from "@/lib/constants";
import {
  periodBounds,
  monthsInRange,
  type PeriodMonths,
} from "@/lib/report-period";
import { bucketByMonth, reconstructBalanceHistory } from "@/lib/reports";
import type { CategorySlice, MonthBucket, BalancePoint } from "@/types/reports";

/** Shared fetcher input: the resolved window + the optional account scope. */
export interface ReportFetchOpts {
  months: PeriodMonths;
  accountId: string | undefined;
}

/**
 * Shared WHERE fragment: user scope + soft-delete + account scoping. Exported
 * and pure (no Prisma call) so the security-relevant rules — row-level ownership
 * (`userId` always present) and the active-vs-explicit account rule — are
 * directly unit-testable. With no `accountId` the all-accounts view excludes
 * archived accounts; an explicitly selected account is honored by id even if
 * archived (the topbar never lists it, so it's reachable only by URL). The
 * transfer-exclusion rule (`type`) lives per-fetcher, not here.
 */
export function reportTxWhere(userId: string, accountId: string | undefined) {
  return {
    userId,
    deletedAt: null,
    financialAccount: accountId
      ? { id: accountId } // explicit single account (archived OK)
      : { isArchived: false }, // all accounts → active only
  };
}

/**
 * Spending-by-category: `groupBy(categoryId)` over EXPENSE rows in the window,
 * then ONE batched `category.findMany` to resolve name/icon/color (no N+1).
 * Null/SetNull categories fall into the shared `UNCATEGORIZED` bucket; a
 * resolved-id miss (race) degrades to the same. Sorted desc by total.
 */
export async function getCategoryBreakdown(
  userId: string,
  opts: ReportFetchOpts
): Promise<CategorySlice[]> {
  const { from, to } = periodBounds(opts.months);
  // Split-aware per-category spend: a split transaction is attributed to its
  // lines, not its parent. The `null` key holds genuinely-uncategorized spend.
  const spend = await getCategorySpend(
    userId,
    { gte: from, lt: to },
    { accountFilter: reportTxWhere(userId, opts.accountId).financialAccount }
  );

  const ids = [...spend.keys()].filter((id): id is string => id !== null);
  const categories = ids.length
    ? await prisma.category.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, icon: true, color: true },
      })
    : [];
  const byId = new Map(categories.map((c) => [c.id, c]));

  return [...spend.entries()]
    .map(([categoryId, total]): CategorySlice => {
      const cat = categoryId ? byId.get(categoryId) : undefined;
      return {
        categoryId,
        name: cat?.name ?? UNCATEGORIZED.name,
        icon: cat?.icon ?? UNCATEGORIZED.icon,
        color: cat?.color ?? UNCATEGORIZED.color,
        total,
      };
    })
    .filter((s) => s.total > 0)
    .sort((a, b) => b.total - a.total);
}

/**
 * Income vs expenses per month. The canonical monthly-bucketing path — cashflow
 * derives from these same buckets (net = income − expenses), so the two never
 * drift. Excludes TRANSFER (a transfer is neither income nor spend).
 */
export async function getMonthlyComparison(
  userId: string,
  opts: ReportFetchOpts
): Promise<MonthBucket[]> {
  const now = new Date();
  const { from, to } = periodBounds(opts.months, now);
  const rows = await prisma.transaction.findMany({
    where: {
      ...reportTxWhere(userId, opts.accountId),
      type: { in: ["INCOME", "EXPENSE"] },
      date: { gte: from, lt: to },
    },
    select: { amount: true, date: true },
  });

  return bucketByMonth(
    rows.map((r) => ({ amount: Number(r.amount), date: r.date })),
    monthsInRange(opts.months, now)
  );
}

/**
 * Per-month end-of-month balance per in-scope account. Two queries (no N+1):
 * a pre-window `groupBy` baseline (`date < from`, + each `startingBalance`) and
 * one in-window `findMany`; shaped by `reconstructBalanceHistory`. INCLUDES
 * transfers — a transfer genuinely moves an account's balance. An empty scope
 * (foreign/unknown `?account=`) yields empty per-month series → the empty state.
 */
export async function getAccountBalanceHistory(
  userId: string,
  opts: ReportFetchOpts
): Promise<BalancePoint[]> {
  const now = new Date();
  const { from, to } = periodBounds(opts.months, now);
  const months = monthsInRange(opts.months, now);

  const accounts = await prisma.financialAccount.findMany({
    where: opts.accountId
      ? { userId, id: opts.accountId } // explicit (archived honored)
      : { userId, isArchived: false }, // all active
    select: { id: true, name: true, color: true, startingBalance: true },
    orderBy: { name: "asc" },
  });

  if (accounts.length === 0) {
    return months.map((m) => ({ ...m, balances: [] }));
  }

  const accountIds = accounts.map((a) => a.id);
  const [baselineSums, inWindow] = await Promise.all([
    prisma.transaction.groupBy({
      by: ["financialAccountId"],
      where: {
        userId,
        deletedAt: null,
        financialAccountId: { in: accountIds },
        date: { lt: from },
      },
      _sum: { amount: true },
    }),
    prisma.transaction.findMany({
      where: {
        userId,
        deletedAt: null,
        financialAccountId: { in: accountIds },
        date: { gte: from, lt: to },
      },
      select: { financialAccountId: true, amount: true, date: true },
    }),
  ]);

  const preByAccount = new Map(
    baselineSums.map((s) => [s.financialAccountId, Number(s._sum.amount ?? 0)])
  );

  return reconstructBalanceHistory(
    accounts.map((a) => ({
      id: a.id,
      name: a.name,
      color: a.color,
      baseline: Number(a.startingBalance) + (preByAccount.get(a.id) ?? 0),
    })),
    inWindow.map((r) => ({
      financialAccountId: r.financialAccountId,
      amount: Number(r.amount),
      date: r.date,
    })),
    months
  );
}

/**
 * In-scope transaction count for the window — the trend-gate signal. Counts ALL
 * types (income + expense + transfer): it answers "does this scope have enough
 * activity to chart," which transfers contribute to (unlike the income/expense
 * buckets, which exclude them). A `count` over `@@index([userId, date])` is cheap.
 */
export async function getReportTxCount(
  userId: string,
  opts: ReportFetchOpts
): Promise<number> {
  const { from, to } = periodBounds(opts.months);
  return prisma.transaction.count({
    where: {
      ...reportTxWhere(userId, opts.accountId),
      date: { gte: from, lt: to },
    },
  });
}

/**
 * The user's plan flag. The session only carries `user.id`, so the 12-month Pro
 * gate reads `isPro` here. Missing user (shouldn't happen behind the guard) →
 * treated as Free.
 */
export async function getReportProfile(
  userId: string
): Promise<{ isPro: boolean }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isPro: true },
  });
  return { isPro: user?.isPro ?? false };
}
