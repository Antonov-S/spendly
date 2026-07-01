export const dynamic = "force-dynamic";

export const metadata = { title: "Transactions" };

import { Suspense } from "react";
import { requireOnboarded } from "@/lib/auth/guards";
import { getUserAccounts } from "@/lib/db/accounts";
import { getUserCategories } from "@/lib/db/categories";
import { getUserTags } from "@/lib/db/tags";
import { getDeletedTransactionCount } from "@/lib/db/transactions";
import { getSidebarUser } from "@/lib/db/profile";
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
    tag?: string;
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
  const tagIds = sp.tag?.split(",").filter(Boolean);
  const filters: TransactionFilters = {
    type: parseType(sp.type),
    from: parseDateParam(sp.from),
    to: parseDateParam(sp.to),
    categoryIds: categoryIds?.length ? categoryIds : undefined,
    tagIds: tagIds?.length ? tagIds : undefined,
    accountId: sp.account || undefined,
    q: sp.q?.trim() || undefined,
  };

  const hasActiveFilters = Boolean(
    filters.type ||
      filters.from ||
      filters.to ||
      filters.categoryIds ||
      filters.tagIds ||
      filters.accountId ||
      filters.q
  );

  const [accounts, categories, tags, sidebarUser, deletedCount] =
    await Promise.all([
      getUserAccounts(userId),
      getUserCategories(userId),
      getUserTags(userId),
      getSidebarUser(userId),
      getDeletedTransactionCount(userId),
    ]);

  const nowMs = Date.now();

  return (
    <AppShell
      accounts={accounts}
      user={sidebarUser}
    >
      <TransactionsHeader deletedCount={deletedCount} />
      <FilterBar categories={categories} tags={tags} />

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
