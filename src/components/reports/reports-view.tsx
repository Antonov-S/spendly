"use client";

import { useAppShell } from "@/components/layout/app-shell";
import { ChartCard } from "@/components/reports/chart-card";
import { ChartEmptyState } from "@/components/reports/chart-empty-state";
import { PeriodSelector } from "@/components/reports/period-selector";
import { UpgradePrompt } from "@/components/reports/upgrade-prompt";
import { SpendingByCategory } from "@/components/reports/spending-by-category";
import { IncomeVsExpenses } from "@/components/reports/income-vs-expenses";
import { CashflowTrend } from "@/components/reports/cashflow-trend";
import { AccountBalanceHistory } from "@/components/reports/account-balance-history";
import {
  hasCategoryData,
  hasBalanceData,
  hasEnoughForTrends,
  trendNudgeCopy,
} from "@/lib/reports";
import type { ReportData } from "@/types/reports";

interface ReportsViewProps extends ReportData {
  /** Active (non-archived) account ids — drives the balance legend's "(archived)" suffix. */
  activeAccountIds: string[];
}

/**
 * Reports coordinator: header + period selector, the optional Free-tier upgrade
 * banner, and a responsive 2×2 chart grid. Each chart gates **individually** —
 * the two trend charts hold out for `REPORTS_MIN_TRANSACTIONS`, while category
 * and balance render on data presence — so a sparse account still shows a real
 * pie + balance chart while only the trend cards nudge.
 */
export function ReportsView({
  categories,
  monthly,
  balanceHistory,
  txCount,
  effective,
  clamped,
  isPro,
  activeAccountIds,
}: ReportsViewProps) {
  const { openDrawer } = useAppShell();
  const enoughForTrends = hasEnoughForTrends(txCount);
  const periodLabel = effective.label;

  return (
    <>
      <header className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-[20px] font-medium leading-none text-ink">
            Reports
          </h1>
          <p className="mt-1.5 text-[12px] text-ink-3">
            How your money moved over time
          </p>
        </div>
        <div className="ml-auto">
          <PeriodSelector effective={effective} isPro={isPro} />
        </div>
      </header>

      {clamped && <UpgradePrompt />}

      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard title="Spending by category" subtitle={periodLabel}>
          {hasCategoryData(categories) ? (
            <SpendingByCategory slices={categories} periodLabel={periodLabel} />
          ) : (
            <ChartEmptyState
              message="Add an expense to see your spending breakdown."
              actionLabel="Add transaction"
              onAction={() => openDrawer()}
            />
          )}
        </ChartCard>

        <ChartCard title="Income vs expenses" subtitle={periodLabel}>
          {enoughForTrends ? (
            <IncomeVsExpenses monthly={monthly} periodLabel={periodLabel} />
          ) : (
            <ChartEmptyState
              message={trendNudgeCopy(txCount)}
              actionLabel="Add transaction"
              onAction={() => openDrawer()}
            />
          )}
        </ChartCard>

        <ChartCard title="Cashflow trend" subtitle={periodLabel}>
          {enoughForTrends ? (
            <CashflowTrend monthly={monthly} periodLabel={periodLabel} />
          ) : (
            <ChartEmptyState
              message={trendNudgeCopy(txCount)}
              actionLabel="Add transaction"
              onAction={() => openDrawer()}
            />
          )}
        </ChartCard>

        <ChartCard title="Account balance" subtitle={periodLabel}>
          {hasBalanceData(balanceHistory) ? (
            <AccountBalanceHistory
              history={balanceHistory}
              activeAccountIds={activeAccountIds}
              periodLabel={periodLabel}
            />
          ) : (
            <ChartEmptyState message="No accounts in this view." />
          )}
        </ChartCard>
      </div>
    </>
  );
}
