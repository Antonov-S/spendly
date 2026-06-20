export const dynamic = "force-dynamic";

import { requireOnboarded } from "@/lib/auth/guards";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { MetricStrip } from "@/components/dashboard/metric-strip";
import { TransactionsPanel } from "@/components/dashboard/transactions-panel";
import { BudgetsPanel } from "@/components/dashboard/budgets-panel";
import { GoalsWidget } from "@/components/dashboard/goals-widget";
import { InsightsStrip } from "@/components/dashboard/insights-strip";
import { DashboardZeroState } from "@/components/dashboard/dashboard-zero-state";
import {
  getDashboardSummary,
  getBalanceTrend,
  getRecentTransactions,
  getBudgetsData,
} from "@/lib/db/dashboard";
import { getGoalsSummary } from "@/lib/db/goals";
import { getUserAccounts } from "@/lib/db/accounts";
import { getPendingDraftCount } from "@/lib/db/recurring";
import { countAtRiskBudgets, buildInsightItems } from "@/lib/insights";

export default async function DashboardPage() {
  const session = await requireOnboarded();

  const today = new Date();
  const month = today.getMonth() + 1;
  const year = today.getFullYear();

  const userId = session.user.id;

  const [summary, balanceTrend, { rows: transactions, count }, { rows: budgets, summary: budgetSummary }, goals, accounts, pendingDraftCount] =
    await Promise.all([
      getDashboardSummary(userId, month, year),
      getBalanceTrend(userId, month, year),
      getRecentTransactions(userId, 20),
      getBudgetsData(userId, month, year),
      getGoalsSummary(userId),
      getUserAccounts(userId),
      getPendingDraftCount(userId),
    ]);

  const insightItems = buildInsightItems({
    atRiskBudgetCount: countAtRiskBudgets(budgets),
    pendingDraftCount,
    overdueGoalCount: goals.filter((g) => g.overdue).length,
  });

  return (
    <DashboardShell
      summary={summary}
      balanceTrend={balanceTrend}
      accounts={accounts}
      user={{
        name: session.user.name ?? null,
        email: session.user.email ?? null,
        image: session.user.image ?? null,
      }}
    >
      {/* Defensive zero-account fallback. The onboarding guard normally keeps
          this unreachable; this branch keys purely off locally-fetched accounts
          (not the guard) so a guard bypass / nav race never renders an empty
          seed-shaped shell as if it were real. */}
      {accounts.length === 0 ? (
        <DashboardZeroState />
      ) : (
        <>
          <MetricStrip summary={summary} />

          <InsightsStrip items={insightItems} />

          {/* Content columns: transactions (1.4fr) + budgets & goals (1fr) */}
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-[1.4fr_1fr]">
            <TransactionsPanel rows={transactions} count={count} />
            <div className="flex flex-col gap-2">
              <BudgetsPanel rows={budgets} summary={budgetSummary} />
              <GoalsWidget goals={goals} />
            </div>
          </div>
        </>
      )}
    </DashboardShell>
  );
}
