export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { getSessionOrRedirect } from "@/lib/auth/guards";
import { getUserAccounts } from "@/lib/db/accounts";
import { getBudgets, getBudgetFormData } from "@/lib/db/budgets";
import { parseMonth, parseYear } from "@/lib/budget-period";
import { AppShell } from "@/components/layout/app-shell";
import { BudgetsView } from "@/components/budgets/budgets-view";

interface BudgetsPageProps {
  searchParams: Promise<{
    month?: string;
    year?: string;
  }>;
}

export default async function BudgetsPage({ searchParams }: BudgetsPageProps) {
  const session = await getSessionOrRedirect();
  const userId = session.user.id;

  const sp = await searchParams;
  const month = parseMonth(sp.month);
  const year = parseYear(sp.year);

  // `accounts` is shell chrome (topbar selector), not budget data.
  const [{ rows, summary }, availableCategories, accounts] = await Promise.all([
    getBudgets(userId, month, year),
    getBudgetFormData(userId, month, year),
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
      {/* Re-suspend (show fresh render) whenever the period changes. */}
      <Suspense key={`${month}-${year}`}>
        <BudgetsView
          rows={rows}
          summary={summary}
          availableCategories={availableCategories}
          period={{ month, year }}
        />
      </Suspense>
    </AppShell>
  );
}
