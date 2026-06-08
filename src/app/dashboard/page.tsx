export const dynamic = "force-dynamic";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { MetricStrip } from "@/components/dashboard/metric-strip";
import { TransactionsPanel } from "@/components/dashboard/transactions-panel";
import { BudgetsPanel } from "@/components/dashboard/budgets-panel";
import { GoalsWidget } from "@/components/dashboard/goals-widget";
import {
  getDashboardSummary,
  getBalanceTrend,
  getRecentTransactions,
  getBudgetsData,
  getGoals,
} from "@/lib/db/dashboard";
import { prisma } from "@/lib/prisma";

// TODO: replace with session.user.id once NextAuth is wired up
async function getDemoUserId(): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: "demo-pro@spendly.io" },
    select: { id: true },
  });
  return user.id;
}

export default async function DashboardPage() {
  const today = new Date();
  const month = today.getMonth() + 1;
  const year = today.getFullYear();

  const userId = await getDemoUserId();

  const [summary, balanceTrend, { rows: transactions, count }, { rows: budgets, summary: budgetSummary }, goals] =
    await Promise.all([
      getDashboardSummary(userId, month, year),
      getBalanceTrend(userId, month, year),
      getRecentTransactions(userId, 20),
      getBudgetsData(userId, month, year),
      getGoals(userId),
    ]);

  return (
    <DashboardShell summary={summary} balanceTrend={balanceTrend}>
      <MetricStrip summary={summary} />

      {/* Content columns: transactions (1.4fr) + budgets & goals (1fr) */}
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-[1.4fr_1fr]">
        <TransactionsPanel rows={transactions} count={count} />
        <div className="flex flex-col gap-2">
          <BudgetsPanel rows={budgets} summary={budgetSummary} />
          <GoalsWidget goals={goals} />
        </div>
      </div>
    </DashboardShell>
  );
}
