export const dynamic = "force-dynamic";

export const metadata = { title: "Transactions" };

import { Suspense } from "react";
import { requireOnboarded } from "@/lib/auth/guards";
import { getUserAccounts } from "@/lib/db/accounts";
import { getUserCategories } from "@/lib/db/categories";
import { parseDateParam, parseType } from "@/lib/transactions";
import { AppShell } from "@/components/layout/app-shell";
import { TransactionsHeader } from "@/components/transactions/transactions-header";
import { FilterBar } from "@/components/transactions/filter-bar";
import { FeedSection } from "@/components/transactions/feed-section";
import { FeedSkeleton } from "@/components/transactions/feed-skeleton";
import type { TransactionFilters } from "@/types/transactions";

interface TransactionsPageProps {
  searchParams: Promise<{
    type?: string;
    from?: string;
    to?: string;
    category?: string;
    account?: string;
    q?: string;
  }>;
}

export default async function TransactionsPage({
  searchParams,
}: TransactionsPageProps) {
  const session = await requireOnboarded();
  const userId = session.user.id;

  const sp = await searchParams;

  const categoryIds = sp.category?.split(",").filter(Boolean);
  const filters: TransactionFilters = {
    type: parseType(sp.type),
    from: parseDateParam(sp.from),
    to: parseDateParam(sp.to),
    categoryIds: categoryIds?.length ? categoryIds : undefined,
    accountId: sp.account || undefined,
    q: sp.q?.trim() || undefined,
  };

  const hasActiveFilters = Boolean(
    filters.type ||
      filters.from ||
      filters.to ||
      filters.categoryIds ||
      filters.accountId ||
      filters.q
  );

  const [accounts, categories] = await Promise.all([
    getUserAccounts(userId),
    getUserCategories(userId),
  ]);

  const nowMs = Date.now();

  return (
    <AppShell
      accounts={accounts}
      user={{
        name: session.user.name ?? null,
        email: session.user.email ?? null,
        image: session.user.image ?? null,
      }}
    >
      <TransactionsHeader />
      <FilterBar categories={categories} />

      {/* Re-suspend (show skeleton) whenever the filters change. */}
      <Suspense key={JSON.stringify(sp)} fallback={<FeedSkeleton />}>
        <FeedSection
          userId={userId}
          filters={filters}
          hasActiveFilters={hasActiveFilters}
          nowMs={nowMs}
        />
      </Suspense>
    </AppShell>
  );
}
