/**
 * Pure aggregation helpers for `/reports`. DB-free so they unit-test without a
 * Prisma mock (same discipline as `summarizeBudgets` / `mapBudgetRow`): the
 * fetchers do the `findMany`/`groupBy`, these shape the result. Dates are
 * `@db.Date` (UTC midnight) — bucket by their UTC month/year.
 */
import { REPORTS_MIN_TRANSACTIONS, SEMANTIC_COLORS } from "@/lib/system-constants";
import type { MonthBucket, BalancePoint } from "@/types/reports";

/** Account series with no explicit color fall back to neutral grey. */
const FALLBACK_ACCOUNT_COLOR = SEMANTIC_COLORS.neutral;

/** Stable key for a `{ month, year }` bucket. */
function monthKey(month: number, year: number): string {
  return `${year}-${month}`;
}

/**
 * Bucket signed transaction rows into the canonical month list, summing income
 * (amount > 0) and expenses (abs of amount < 0) per month. Months with no rows
 * yield `{ income: 0, expenses: 0 }`. Rows outside the month list are ignored.
 * Used by income-vs-expenses AND cashflow (net = income − expenses).
 */
export function bucketByMonth(
  rows: { amount: number; date: Date }[],
  months: { month: number; year: number }[]
): MonthBucket[] {
  const buckets = new Map<string, MonthBucket>();
  for (const { month, year } of months) {
    buckets.set(monthKey(month, year), { month, year, income: 0, expenses: 0 });
  }

  for (const row of rows) {
    const key = monthKey(row.date.getUTCMonth() + 1, row.date.getUTCFullYear());
    const bucket = buckets.get(key);
    if (!bucket) continue;
    if (row.amount > 0) bucket.income += row.amount;
    else if (row.amount < 0) bucket.expenses += -row.amount;
  }

  return months.map((m) => buckets.get(monthKey(m.month, m.year))!);
}

/**
 * Reconstruct each account's end-of-month balance across the window. Each
 * account starts at its pre-window `baseline` (startingBalance + sum of every
 * non-deleted tx strictly before the window); we then walk the months oldest→
 * newest, adding that month's net per account to get the running figure. Pure —
 * the fetcher supplies the baseline and the in-window rows. Negative balances
 * are preserved (no clamp).
 */
export function reconstructBalanceHistory(
  accounts: { id: string; name: string; color: string | null; baseline: number }[],
  inWindowRows: { financialAccountId: string; amount: number; date: Date }[],
  months: { month: number; year: number }[]
): BalancePoint[] {
  // Per-account, per-month net: `${accountId}|${year}-${month}` → sum.
  const netByAccountMonth = new Map<string, number>();
  for (const row of inWindowRows) {
    const key = `${row.financialAccountId}|${monthKey(
      row.date.getUTCMonth() + 1,
      row.date.getUTCFullYear()
    )}`;
    netByAccountMonth.set(key, (netByAccountMonth.get(key) ?? 0) + row.amount);
  }

  const running = new Map(accounts.map((a) => [a.id, a.baseline]));

  return months.map(({ month, year }) => ({
    month,
    year,
    balances: accounts.map((account) => {
      const net =
        netByAccountMonth.get(`${account.id}|${monthKey(month, year)}`) ?? 0;
      const balance = (running.get(account.id) ?? 0) + net;
      running.set(account.id, balance);
      return {
        accountId: account.id,
        name: account.name,
        color: account.color ?? FALLBACK_ACCOUNT_COLOR,
        balance,
      };
    }),
  }));
}

/** Spending-by-category renders as soon as any expense exists. */
export function hasCategoryData(categories: { total: number }[]): boolean {
  return categories.some((c) => c.total > 0);
}

/**
 * True when at least one month carries a non-empty account series. Checks
 * `balances`, not `history.length` — `monthsInRange` always yields ≥ 1 month so
 * a length check would be trivially true. The real "nothing to show" case is an
 * empty `?account=` scope, where the months exist but every series is empty.
 */
export function hasBalanceData(history: BalancePoint[]): boolean {
  return history.some((p) => p.balances.length > 0);
}

/** Trend charts (income/expense, cashflow) need volume to be meaningful. */
export function hasEnoughForTrends(txCount: number): boolean {
  return txCount >= REPORTS_MIN_TRANSACTIONS;
}

/** "Add 15 more transactions to see spending trends" — count clamped at ≥ 0. */
export function trendNudgeCopy(txCount: number): string {
  const remaining = Math.max(0, REPORTS_MIN_TRANSACTIONS - txCount);
  return `Add ${remaining} more transactions to see spending trends`;
}
