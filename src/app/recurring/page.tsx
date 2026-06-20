export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { requireOnboarded } from "@/lib/auth/guards";
import { getUserAccounts } from "@/lib/db/accounts";
import { getUserCategories } from "@/lib/db/categories";
import {
  getTemplates,
  getPendingDrafts,
  generatePendingDrafts,
} from "@/lib/db/recurring";
import { AppShell } from "@/components/layout/app-shell";
import { RecurringView } from "@/components/recurring/recurring-view";

export default async function RecurringPage() {
  const session = await requireOnboarded();
  const userId = session.user.id;

  // Run the MVP "scheduler" before the parallel fetch so getPendingDrafts sees
  // freshly-created rows.
  await generatePendingDrafts(userId);

  const [templates, drafts, accounts, categories] = await Promise.all([
    getTemplates(userId),
    getPendingDrafts(userId),
    getUserAccounts(userId),
    getUserCategories(userId),
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
      {/* Re-suspend on data change after a router.refresh(). */}
      <Suspense key={`${templates.length}-${drafts.length}`}>
        <RecurringView
          templates={templates}
          drafts={drafts}
          accounts={accounts}
          categories={categories}
        />
      </Suspense>
    </AppShell>
  );
}
