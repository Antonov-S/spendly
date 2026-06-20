export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { requireOnboarded } from "@/lib/auth/guards";
import { getUserAccounts } from "@/lib/db/accounts";
import {
  getCategoryBreakdown,
  getMonthlyComparison,
  getAccountBalanceHistory,
  getReportTxCount,
  getReportProfile,
} from "@/lib/db/reports";
import { parsePeriod, resolveEffectivePeriod } from "@/lib/report-period";
import { AppShell } from "@/components/layout/app-shell";
import { ReportsView } from "@/components/reports/reports-view";

interface ReportsPageProps {
  searchParams: Promise<{
    period?: string;
    account?: string;
  }>;
}

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const session = await requireOnboarded();
  const userId = session.user.id;

  const sp = await searchParams;

  // `isPro` isn't on the session — read it from the DB. The plan gates which
  // window we even query: a Free 12m request is clamped to 3m here (the 12-month
  // query never runs for Free), and `clamped` drives the upgrade banner.
  const { isPro } = await getReportProfile(userId);
  const requested = parsePeriod(sp.period);
  const { effective, clamped } = resolveEffectivePeriod(requested, isPro);

  const accountId = sp.account || undefined;
  const opts = { months: effective.months, accountId };

  // `accounts` is shell chrome (topbar selector) + the active-account set the
  // balance legend uses to flag an explicitly-selected archived account.
  const [categories, monthly, balanceHistory, txCount, accounts] =
    await Promise.all([
      getCategoryBreakdown(userId, opts),
      getMonthlyComparison(userId, opts),
      getAccountBalanceHistory(userId, opts),
      getReportTxCount(userId, opts),
      getUserAccounts(userId),
    ]);

  return (
    <AppShell
      accounts={accounts}
      user={{
        name: session.user.name ?? null,
        email: session.user.email ?? null,
        image: session.user.image ?? null,
      }}
    >
      {/* Re-suspend (show fresh render) whenever the period or account changes. */}
      <Suspense key={`${effective.param}-${accountId ?? "all"}`}>
        <ReportsView
          categories={categories}
          monthly={monthly}
          balanceHistory={balanceHistory}
          txCount={txCount}
          effective={effective}
          clamped={clamped}
          isPro={isPro}
          activeAccountIds={accounts.map((a) => a.id)}
        />
      </Suspense>
    </AppShell>
  );
}
