export const dynamic = "force-dynamic";

export const metadata = { title: "Budgets" };

import { Suspense } from "react";
import { requireOnboarded } from "@/lib/auth/guards";
import { getUserAccounts } from "@/lib/db/accounts";
import { getBudgets, getBudgetFormData } from "@/lib/db/budgets";
import { getAiProfile } from "@/lib/db/ai";
import { getSidebarUser } from "@/lib/db/profile";
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
  const session = await requireOnboarded();
  const userId = session.user.id;

  const sp = await searchParams;
  const month = parseMonth(sp.month);
  const year = parseYear(sp.year);

  // `accounts` is shell chrome (topbar selector), not budget data.
  const [{ rows, summary }, availableCategories, accounts, sidebarUser, { isPro }] =
    await Promise.all([
      getBudgets(userId, month, year),
      getBudgetFormData(userId, month, year),
      getUserAccounts(userId),
      getSidebarUser(userId),
      getAiProfile(userId),
    ]);

  return (
    <AppShell
      accounts={accounts}
      user={sidebarUser}
    >
      {/* Re-suspend (show fresh render) whenever the period changes. */}
      <Suspense key={`${month}-${year}`}>
        <BudgetsView
          rows={rows}
          summary={summary}
          availableCategories={availableCategories}
          period={{ month, year }}
          isPro={isPro}
        />
      </Suspense>
    </AppShell>
  );
}
