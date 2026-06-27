import "server-only";
import { prisma } from "@/lib/prisma";
import { resolveIcon } from "@/lib/icon-map";
import { resolveRolloverCarry } from "@/lib/db/budgets";
import { UNCATEGORIZED } from "@/lib/constants";
import type {
  DashboardSummary,
  TransactionRow,
  BudgetRow,
  BudgetSummary,
} from "@/types/dashboard";

function utcDateKey(d: Date): string {
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

function toDateLabel(date: Date, today: Date): string {
  const yesterday = new Date(today);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);

  if (utcDateKey(date) === utcDateKey(today)) return "Today";
  if (utcDateKey(date) === utcDateKey(yesterday)) return "Yesterday";

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export async function getDashboardSummary(
  userId: string,
  month: number,
  year: number
): Promise<DashboardSummary> {
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0));

  const accounts = await prisma.financialAccount.findMany({
    where: { userId, isArchived: false },
    select: { id: true, startingBalance: true },
  });

  const accountIds = accounts.map((a) => a.id);
  const startingBalance = accounts.reduce(
    (s, a) => s + Number(a.startingBalance),
    0
  );

  const [allTxSum, monthTxs] = await Promise.all([
    prisma.transaction.aggregate({
      where: { userId, deletedAt: null, financialAccountId: { in: accountIds } },
      _sum: { amount: true },
    }),
    prisma.transaction.findMany({
      where: {
        userId,
        deletedAt: null,
        financialAccountId: { in: accountIds },
        date: { gte: monthStart, lte: monthEnd },
      },
      select: { type: true, amount: true },
    }),
  ]);

  const totalBalance =
    startingBalance + Number(allTxSum._sum.amount ?? 0);

  const income = monthTxs
    .filter((tx) => tx.type === "INCOME")
    .reduce((s, tx) => s + Number(tx.amount), 0);

  const expenses = Math.abs(
    monthTxs
      .filter((tx) => tx.type === "EXPENSE")
      .reduce((s, tx) => s + Number(tx.amount), 0)
  );

  const cashflow = income - expenses;

  const periodLabel = new Date(year, month - 1, 1).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });

  return {
    periodLabel,
    totalBalance,
    balanceDelta: cashflow,
    income,
    expenses,
    cashflow,
  };
}

export async function getBalanceTrend(
  userId: string,
  month: number,
  year: number
): Promise<number[]> {
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const today = new Date();
  const monthEnd = new Date(Date.UTC(year, month, 0));
  const until = today < monthEnd ? today : monthEnd;

  const accounts = await prisma.financialAccount.findMany({
    where: { userId, isArchived: false },
    select: { id: true, startingBalance: true },
  });
  const accountIds = accounts.map((a) => a.id);
  const startingBalance = accounts.reduce(
    (s, a) => s + Number(a.startingBalance),
    0
  );

  const [preTxSum, monthTxs] = await Promise.all([
    prisma.transaction.aggregate({
      where: {
        userId,
        deletedAt: null,
        financialAccountId: { in: accountIds },
        date: { lt: monthStart },
      },
      _sum: { amount: true },
    }),
    prisma.transaction.findMany({
      where: {
        userId,
        deletedAt: null,
        financialAccountId: { in: accountIds },
        date: { gte: monthStart, lte: until },
      },
      select: { amount: true, date: true },
      orderBy: { date: "asc" },
    }),
  ]);

  const balanceAtMonthStart =
    startingBalance + Number(preTxSum._sum.amount ?? 0);

  const daysInRange =
    Math.ceil(
      (until.getTime() - monthStart.getTime()) / 86_400_000
    ) + 1;

  const dailySums = new Array<number>(daysInRange).fill(0);
  for (const tx of monthTxs) {
    const dayIndex = Math.floor(
      (tx.date.getTime() - monthStart.getTime()) / 86_400_000
    );
    if (dayIndex >= 0 && dayIndex < daysInRange) {
      dailySums[dayIndex] += Number(tx.amount);
    }
  }

  let running = balanceAtMonthStart;
  return dailySums.map((daySum) => {
    running += daySum;
    return running;
  });
}

export async function getRecentTransactions(
  userId: string,
  limit = 20
): Promise<{ rows: TransactionRow[]; count: number }> {
  const today = new Date();
  const monthStart = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)
  );
  const monthEnd = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)
  );

  // Exclude transactions on archived accounts — they're gone from every other
  // active view (hero balance, metric strip, /transactions), so the recent feed
  // must match. Mirrors the `isArchived: false` scoping in the summary fetchers.
  const [txs, count] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        userId,
        deletedAt: null,
        financialAccount: { isArchived: false },
      },
      orderBy: { date: "desc" },
      take: limit,
      include: {
        category: { select: { name: true, color: true, icon: true } },
        financialAccount: { select: { name: true } },
      },
    }),
    prisma.transaction.count({
      where: {
        userId,
        deletedAt: null,
        financialAccount: { isArchived: false },
        date: { gte: monthStart, lte: monthEnd },
      },
    }),
  ]);

  const rows: TransactionRow[] = txs.map((tx) => ({
    id: tx.id,
    type: tx.type,
    description: tx.merchant ?? tx.note ?? "Transaction",
    category: tx.category
      ? {
          name: tx.category.name,
          color: tx.category.color,
          icon: resolveIcon(tx.category.icon),
        }
      : {
          name: UNCATEGORIZED.name,
          color: UNCATEGORIZED.color,
          icon: resolveIcon(UNCATEGORIZED.icon),
        },
    dateLabel: toDateLabel(tx.date, today),
    account: tx.financialAccount.name,
    amount: Number(tx.amount),
    isIncome: tx.type === "INCOME",
  }));

  return { rows, count };
}

export async function getBudgetsData(
  userId: string,
  month: number,
  year: number
): Promise<{ rows: BudgetRow[]; summary: BudgetSummary }> {
  const today = new Date();
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0));

  const budgets = await prisma.budget.findMany({
    where: { userId, month, year, isArchived: false },
    include: {
      category: { select: { name: true, color: true, icon: true } },
    },
  });

  // One DB-side aggregation: signed sum of in-window EXPENSE spend per category,
  // scoped to the categories that actually have a budget this period.
  const spendByCategory = await prisma.transaction.groupBy({
    by: ["categoryId"],
    where: {
      userId,
      deletedAt: null,
      type: "EXPENSE",
      date: { gte: monthStart, lte: monthEnd },
      categoryId: { in: budgets.map((b) => b.categoryId) },
    },
    _sum: { amount: true },
  });

  const spentMap = new Map<string, number>(
    spendByCategory.map((g) => [g.categoryId!, Math.abs(Number(g._sum.amount ?? 0))])
  );

  // Same carry resolution as the /budgets page so the two surfaces agree.
  const rolloverIds = budgets.filter((b) => b.rollover).map((b) => b.categoryId);
  const carryMap = await resolveRolloverCarry(userId, month, year, rolloverIds);

  const rows: BudgetRow[] = budgets.map((budget) => ({
    id: budget.id,
    category: {
      name: budget.category.name,
      color: budget.category.color,
      icon: resolveIcon(budget.category.icon),
    },
    spent: spentMap.get(budget.categoryId) ?? 0,
    limit: Number(budget.amount),
    rollover: budget.rollover,
    carriedAmount: budget.rollover ? (carryMap.get(budget.categoryId) ?? 0) : 0,
  }));

  // Totals use the EFFECTIVE limit (base + carry) so the panel reflects rollover.
  const total = rows.reduce((s, r) => s + r.limit + r.carriedAmount, 0);
  const totalSpent = rows.reduce((s, r) => s + r.spent, 0);
  const remaining = Math.max(0, total - totalSpent);

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const currentDay =
    today.getUTCFullYear() === year && today.getUTCMonth() === month - 1
      ? today.getUTCDate()
      : daysInMonth;
  const daysLeft = Math.max(0, daysInMonth - currentDay);

  return {
    rows,
    summary: {
      remaining,
      total,
      daysLeft,
      categoryCount: rows.length,
      hasMixedCurrencies: new Set(budgets.map((b) => b.currency)).size > 1,
    },
  };
}
